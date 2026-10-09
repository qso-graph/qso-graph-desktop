// SPDX-License-Identifier: GPL-3.0-only
use crate::{CoreResult, Credentials, selected_secret};
use std::io::Read;
use std::sync::Arc;
use std::time::Duration;
use zeroize::Zeroizing;

const MAX_BODY: u64 = 64 * 1024;
pub fn supported(provider: &str) -> bool { matches!(provider, "qrz" | "qrz_logbook") }

pub fn tls_config() -> CoreResult<rustls::ClientConfig> {
    let provider = rustls::crypto::aws_lc_rs::default_provider();
    if !provider.fips() { return Err("Secure client is unavailable."); }
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(provider))
        .with_protocol_versions(&[&rustls::version::TLS13]).map_err(|_| "Secure client is unavailable.")?
        .with_root_certificates(roots).with_no_client_auth();
    if !config.fips() { return Err("Secure client is unavailable."); }
    Ok(config)
}

pub fn test(provider: &str, creds: &Credentials, preference: Option<&str>) -> CoreResult<&'static str> {
    let secret = selected_secret(provider, creds, preference)?;
    let username = creds.username.as_deref().filter(|s| !s.is_empty()).ok_or("No username is stored.")?;
    let client = reqwest::blocking::Client::builder().use_preconfigured_tls(tls_config()?)
        .https_only(true).no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(12))
        .user_agent("QGDesktop/0.0.0-preview.1").build().map_err(|_| "Secure client is unavailable.")?;
    // Fixed destinations and POST bodies: no credentials in URLs. The caller
    // sees a fixed outcome only, never response bodies, session keys or errors.
    let request = match provider {
        "qrz" => client.post("https://xmldata.qrz.com/xml/current/")
            .form(&[("username", username), ("password", secret), ("agent", "QGDesktop/0.0.0-preview.1")]),
        "qrz_logbook" => client.post("https://logbook.qrz.com/api")
            .form(&[("KEY", secret), ("ACTION", "STATUS")]),
        _ => return Ok("unsupported"),
    };
    let response = match request.send() { Ok(response) => response, Err(_) => return Ok("network-error") };
    let code = response.status().as_u16();
    if code == 429 { return Ok("rate-limited"); }
    if code == 401 || code == 403 { return Ok("rejected"); }
    if !response.status().is_success() { return Ok("network-error"); }
    if response.content_length().is_some_and(|length| length > MAX_BODY) { return Ok("invalid-response"); }
    let mut body = Zeroizing::new(Vec::new());
    if response.take(MAX_BODY + 1).read_to_end(&mut body).is_err() { return Ok("network-error"); }
    if body.len() as u64 > MAX_BODY { return Ok("invalid-response"); }
    let text = match std::str::from_utf8(&body) { Ok(text) => text, Err(_) => return Ok("invalid-response") };
    Ok(parse_response(provider, text))
}

fn parse_response(provider: &str, body: &str) -> &'static str {
    match provider {
        "qrz" => {
            let Ok(doc) = roxmltree::Document::parse(body) else { return "invalid-response"; };
            let root = doc.root_element();
            if root.tag_name().name() != "QRZDatabase" || root.tag_name().namespace() != Some("http://xmldata.qrz.com") { return "invalid-response"; }
            let sessions: Vec<_> = root.children().filter(|n| n.is_element() && n.tag_name().name() == "Session").collect();
            if sessions.len() != 1 { return "invalid-response"; }
            let fields: Vec<_> = sessions[0].children().filter(|n| n.is_element()).collect();
            if fields.iter().any(|n| n.tag_name().name() == "Error" && n.text().is_some_and(|s| !s.trim().is_empty())) { return "rejected"; }
            let keys: Vec<_> = fields.iter().filter(|n| n.tag_name().name() == "Key").collect();
            if keys.len() == 1 && keys[0].text().is_some_and(|s| !s.trim().is_empty()) { "success" } else { "invalid-response" }
        }
        "qrz_logbook" => {
            let results: Vec<_> = body.split('&').filter_map(|part| part.strip_prefix("RESULT=")).collect();
            if results.len() != 1 { return "invalid-response"; }
            match results[0].trim() { "OK" => "success", "FAIL" | "AUTH" => "rejected", _ => "invalid-response" }
        }
        _ => "unsupported",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn response_oracles_and_secret_echoes_are_not_results() {
        let login = r#"<QRZDatabase xmlns="http://xmldata.qrz.com"><Session><Key>synthetic-session-key</Key></Session></QRZDatabase>"#;
        assert_eq!(parse_response("qrz", login), "success");
        assert_eq!(parse_response("qrz", r#"<QRZDatabase xmlns="http://xmldata.qrz.com"><Session><Error>synthetic echoed secret</Error><Key>key</Key></Session></QRZDatabase>"#), "rejected");
        assert_eq!(parse_response("qrz", "<html><Key>key</Key></html>"), "invalid-response");
        assert_eq!(parse_response("qrz", r#"<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///tmp/secret">]><QRZDatabase/>"#), "invalid-response");
        assert_eq!(parse_response("qrz_logbook", "RESULT=OK&ACTION=STATUS&COUNT=0"), "success");
        assert_eq!(parse_response("qrz_logbook", "RESULT=FAIL&REASON=synthetic echoed secret"), "rejected");
        assert_eq!(parse_response("qrz_logbook", "RESULT=AUTH"), "rejected");
        assert_eq!(parse_response("qrz_logbook", "RESULT=FAIL&RESULT=OK"), "invalid-response");
        assert_eq!(parse_response("qrz_logbook", "<html>RESULT=OK</html>"), "invalid-response");
    }
    #[test]
    fn secure_client_requires_fips_crypto_and_only_tls13() {
        let config = tls_config().unwrap();
        assert!(config.fips());
        // Inspect the offered versions in a real ClientHello, without any
        // connection or credential. Only TLS 1.3 may be advertised.
        let mut client = rustls::ClientConnection::new(Arc::new(config), "example.invalid".try_into().unwrap()).unwrap();
        let mut hello = Vec::new();
        client.write_tls(&mut hello).unwrap();
        let mut position = 5 + 4 + 2 + 32;
        position += 1 + hello[position] as usize;
        let cipher_length = u16::from_be_bytes([hello[position], hello[position + 1]]) as usize;
        position += 2 + cipher_length;
        position += 1 + hello[position] as usize;
        let extensions_length = u16::from_be_bytes([hello[position], hello[position + 1]]) as usize;
        position += 2;
        let end = position + extensions_length;
        let mut found = false;
        while position < end {
            let kind = u16::from_be_bytes([hello[position], hello[position + 1]]);
            let length = u16::from_be_bytes([hello[position + 2], hello[position + 3]]) as usize;
            position += 4;
            if kind == 43 { assert_eq!(&hello[position..position + length], &[2, 3, 4]); found = true; }
            position += length;
        }
        assert!(found);
    }
}
