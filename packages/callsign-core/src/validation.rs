// SPDX-License-Identifier: GPL-3.0-only
use crate::{CoreResult, Credentials};
use std::io::Read;
use std::sync::Arc;
use std::time::Duration;
use zeroize::Zeroizing;

const MAX_BODY: u64 = 64 * 1024;
pub fn supported(provider: &str) -> bool { matches!(provider, "qrz" | "qrz_logbook" | "clublog" | "hamqth" | "eqsl" | "lotw") }

// For anything that carries a credential: TLS 1.3 only, with one named
// exception (credential_tls_config).
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

// For public reference data, which carries no credential, and for eQSL's login
// (credential_tls_config): TLS 1.3, or TLS 1.2 where a source offers nothing newer (adif.org.uk offers only 1.2).
// Still the FIPS provider, so 1.2 means ECDHE with AES-GCM on P-256 or P-384
// and Extended Master Secret required (NIST SP 800-52r2); config.fips() is
// checked as it is above (QGD-SEC-0020).
pub fn reference_tls_config() -> CoreResult<rustls::ClientConfig> {
    let provider = rustls::crypto::aws_lc_rs::default_provider();
    if !provider.fips() { return Err("Secure client is unavailable."); }
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(provider))
        .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12]).map_err(|_| "Secure client is unavailable.")?
        .with_root_certificates(roots).with_no_client_auth();
    if !config.fips() { return Err("Secure client is unavailable."); }
    Ok(config)
}

// The supported_versions extension (43) of the ClientHello a config sends, read
// by walking the hello's own structure: no connection is opened. For tests.
#[cfg(test)]
pub(crate) fn offered_versions(config: rustls::ClientConfig) -> Vec<u8> {
    let mut client = rustls::ClientConnection::new(Arc::new(config), "example.invalid".try_into().unwrap()).unwrap();
    let mut hello = Vec::new();
    client.write_tls(&mut hello).unwrap();
    // Record header 5, handshake header 4, version 2, random 32.
    let mut position = 5 + 4 + 2 + 32;
    position += 1 + hello[position] as usize;
    let cipher_length = u16::from_be_bytes([hello[position], hello[position + 1]]) as usize;
    position += 2 + cipher_length;
    position += 1 + hello[position] as usize;
    let extensions_length = u16::from_be_bytes([hello[position], hello[position + 1]]) as usize;
    position += 2;
    let end = position + extensions_length;
    while position < end {
        let kind = u16::from_be_bytes([hello[position], hello[position + 1]]);
        let length = u16::from_be_bytes([hello[position + 2], hello[position + 3]]) as usize;
        position += 4;
        if kind == 43 { return hello[position..position + length].to_vec(); }
        position += length;
    }
    panic!("the ClientHello carries no supported_versions extension");
}

// Every service signs in with a username but the two whose credential is a key
// of its own: QRZ Logbook's API key and Club Log's token.
// The TLS a service's credential connection may use. TLS 1.3, but for eQSL,
// whose www.eqsl.cc offers nothing newer than TLS 1.2 (checked 2026-11-01:
// ECDHE-RSA-AES256-GCM-SHA384, Extended Master Secret yes). Its login gets the
// same FIPS-mode TLS 1.2 reference data may use: ECDHE with AES-GCM on P-256
// or P-384, Extended Master Secret required (NIST SP 800-52r2). eQSL only,
// until eQSL updates its service. The exception
// is this one service by its id, never a host or a prefix; every other
// credential stays TLS 1.3 only (QGD-SEC-0020).
pub(crate) fn credential_tls_config(provider: &str) -> CoreResult<rustls::ClientConfig> {
    if provider == "eqsl" { reference_tls_config() } else { tls_config() }
}

// This minute in UTC, as LoTW's qso_qslsince takes it (YYYY-MM-DD HH:MM:00).
fn now_utc_minute() -> String {
    let seconds = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or_default();
    chrono::DateTime::from_timestamp(seconds, 0).map(|t| t.format("%Y-%m-%d %H:%M:00").to_string()).unwrap_or_else(|| "1970-01-01 00:00:00".into())
}

// The services whose answer is decided from its start: LoTW's ADIF header.
fn reads_prefix_only(provider: &str) -> bool { provider == "lotw" }

pub(crate) fn needs_username(provider: &str) -> bool { !matches!(provider, "qrz_logbook" | "clublog") }

// The secret a service takes: the API key (QRZ Logbook's key, Club Log's
// token) or the password, by the service and never by a saved preference.
// Every registered service takes exactly one kind, so a preference could only
// send the wrong one: with Password preferred, Club Log's test sent an old
// password as the token. The preference stays the core's
// for require_credential, and the screen offers it only for a service that
// takes both.
pub(crate) fn service_secret<'a>(provider: &str, creds: &'a Credentials) -> Option<&'a str> {
    let secret = if crate::key_first(provider) { creds.api_key.as_deref() } else { creds.password.as_deref() };
    secret.filter(|s| !s.is_empty())
}

pub fn test(provider: &str, creds: &Credentials) -> CoreResult<&'static str> {
    let secret = service_secret(provider, creds).ok_or("No credential this service takes is stored.")?;
    // QRZ Logbook's key and Club Log's token stand alone; every other service
    // signs in with a username (#8, #11).
    let username = creds.username.as_deref().filter(|s| !s.is_empty());
    if needs_username(provider) && username.is_none() { return Err("No username is stored."); }
    let client = reqwest::blocking::Client::builder().use_preconfigured_tls(credential_tls_config(provider)?)
        .https_only(true).no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(12))
        .user_agent(crate::HTTP_AGENT).build().map_err(|_| "Secure client is unavailable.")?;
    // Fixed destinations. The caller sees a fixed outcome only, never response
    // bodies, session keys, tokens or errors.
    //
    // A credential goes in a POST body or a header wherever the service takes
    // one there. eQSL and LoTW document theirs only as query strings (#9, #12),
    // so for those two the password is in the URL, and the URL is protected:
    // HTTPS only, no proxy, no redirect followed (a Location could carry it on),
    // every reqwest::Error dropped unread rather than formatted (its Display
    // names the URL), only this crate's own tracing events logged (corelog),
    // and nothing of the response shown, because eQSL's pages have been seen to
    // echo the request (eqsl-mcp).
    let request = match provider {
        "qrz" => client.post("https://xmldata.qrz.com/xml/current/")
            .form(&[("username", username.unwrap_or_default()), ("password", secret), ("agent", crate::AGENT)]),
        "qrz_logbook" => client.post("https://logbook.qrz.com/api")
            .form(&[("KEY", secret), ("ACTION", "STATUS")]),
        // Club Log's token, in the Authorization header and nowhere else. The
        // account's own usage: read-only, and it names no callsign (#11). One
        // day rather than the default thirty, so the reply stays small; it
        // also carries the last hundred requests, which nothing here reads.
        // Club Log's stated limit: 60 requests a minute and 1,000 a UTC day per
        // account, however many tokens it holds; 429 with Retry-After beyond
        // it (clublog.org/support/knowledgebase/rest-api/, read 2026-11-01).
        // A test is one request, sent only when the operator presses Test.
        "clublog" => client.get("https://clublog.org/api/v1/me/usage?days=1")
            .bearer_auth(secret).header(reqwest::header::ACCEPT, "application/json"),
        // HamQTH's API v2: the password in a JSON POST body, "never in a URL"
        // (hamqth.com/developers, read 2026-11-01). The token it returns is
        // checked and thrown away; nothing more is asked (#10). No limit is
        // stated for login, but several wrong passwords and it refuses logins
        // for a while with 429 and Retry-After, which is why a test is one
        // request, sent only when the operator presses Test.
        //
        // Serialized straight from the borrowed strings, with no JSON value in
        // between holding a copy, into a buffer that is wiped if it is not
        // sent. The buffer is then moved, not copied, into the request; what
        // reqwest does with it from there is reqwest's, as QRZ's form is.
        "hamqth" => {
            #[derive(serde::Serialize)]
            struct Login<'a> { callsign: &'a str, password: &'a str }
            let mut body = Zeroizing::new(serde_json::to_vec(&Login { callsign: username.unwrap_or_default(), password: secret })
                .map_err(|_| "Secure client is unavailable.")?);
            client.post("https://www.hamqth.com/api/v2/login")
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(reqwest::header::ACCEPT, "application/json")
                .body(std::mem::take(&mut *body))
        }
        // eQSL: the date of the account's last upload, which reads no inbox and
        // changes nothing; eqsl-mcp's eqsl_last_upload makes the same call. eQSL
        // asks programs not to mass-download inboxes, so the inbox is not the
        // test. No limit is stated: one request, when the operator presses Test.
        "eqsl" => client.get("https://www.eqsl.cc/qslcard/DisplayLastUploadDate.cfm")
            .query(&[("UserName", username.unwrap_or_default()), ("Password", secret)]),
        // LoTW: lotwreport.adi asked for confirmations since this minute, the
        // query lotw-mcp's query_confirmations makes against real logins,
        // narrowed to now. qso_qslsince takes a time (KI7MT's reply: "QSL RX
        // SINCE: 2026-11-01 00:00:00 (user supplied value)"), so the answer is
        // the ADIF header and almost never a record, however many QSOs were
        // confirmed today: the decision is <eoh>, which ADIF puts before any
        // record, never the answer's size. A refused login
        // answers with an HTML page
        // (lotw.arrl.org/lotw-help/developer-query-qsos-qsls, read 2026-11-01).
        // It was asked without qso_query until KI7MT's tests (2026-11-01) got
        // neither, twice, with a correct login: that shape is in no client we
        // know of, so it is not used. "Each query is an HTTP GET string." The
        // username is LoTW's own, which is not always the call. No limit is
        // stated: one request, when the operator presses Test.
        "lotw" => client.get("https://lotw.arrl.org/lotwuser/lotwreport.adi")
            .query(&[("login", username.unwrap_or_default()), ("password", secret),
                ("qso_query", "1"), ("qso_qsl", "yes"), ("qso_qslsince", now_utc_minute().as_str())]),
        _ => return Ok("unsupported"),
    };
    let response = match request.send() { Ok(response) => response, Err(_) => return Ok("network-error") };
    let code = response.status().as_u16();
    if code == 429 { return Ok("rate-limited"); }
    if code == 401 || code == 403 { return Ok("rejected"); }
    if !response.status().is_success() { return Ok("network-error"); }
    // Kept for the shape line below: the content type a service sent, cut short
    // and plain. Never the body.
    let content_type: String = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("")
        .chars().filter(|c| c.is_ascii_alphanumeric() || "/;=-. ".contains(*c)).take(64).collect();
    // LoTW's answer to an accepted login is an ADIF file whose header, ending
    // <eoh>, comes first. Without qso_query it holds no QSO records, but it can
    // still carry every confirmation: KI7MT's test (2026-11-01) got neither an
    // HTML refusal nor a header within 64 KB. So for LoTW only the first 64 KB
    // is read and decided on, and the rest is never downloaded: the response
    // is dropped, which closes the connection.
    let prefix_only = reads_prefix_only(provider);
    if !prefix_only && response.content_length().is_some_and(|length| length > MAX_BODY) { return Ok("invalid-response"); }
    let mut body = Zeroizing::new(Vec::new());
    let limit = if prefix_only { MAX_BODY } else { MAX_BODY + 1 };
    if response.take(limit).read_to_end(&mut body).is_err() { return Ok("network-error"); }
    if body.len() as u64 > MAX_BODY { return Ok("invalid-response"); }
    // A prefix can end inside a character; what is looked for is ASCII.
    let text: Zeroizing<String> = if prefix_only { Zeroizing::new(String::from_utf8_lossy(&body).into_owned()) }
        else { match std::str::from_utf8(&body) { Ok(text) => Zeroizing::new(text.to_owned()), Err(_) => return Ok("invalid-response") } };
    let outcome = parse_response(provider, &text);
    // An answer this product could not read is described by its shape alone, so
    // the next one can be told apart without anyone seeing it: how long, what
    // type, and whether it held an ADIF header or an HTML tag. No byte of the
    // body is logged; it can echo the request, password included (#12: LoTW
    // answered a correct login twice with neither).
    if outcome == "invalid-response" {
        tracing::info!(provider = %provider, bytes = body.len(), content_type = %content_type,
            has_eoh = contains_ignoring_case(&text, "<eoh>"), has_html = contains_ignoring_case(&text, "<html"),
            empty = text.trim().is_empty(), "credential test answer not understood");
    }
    Ok(outcome)
}

// A lookup: act with the operator's stored credential and return what the
// service answered (QGD-APP-0007).
//
// The secret never leaves this process. An application names a callsign, a
// service and an operation; what comes back is the service's answer.
//
// QGD-PII-0007, and the distinction KI7MT drew: QRZ's response carries a street
// address, an email address and sometimes a telephone number, and **showing
// those to the operator for a lookup they asked for is QRZ being the source**,
// the same as reading them on QRZ's own site. So they are returned. What the
// rule governs is keeping and passing on — nothing here is logged, cached or
// written to disk, and only named radio fields may ever be persisted by a
// caller.
pub enum Looked {
    Found(Vec<(String, String)>),
    Nothing(&'static str),
}

// What an application may ask for. One operation today; a name rather than a
// free string so a new one is a decision somebody makes.
pub fn known_operation(provider: &str, operation: &str) -> bool {
    matches!((provider, operation), ("qrz", "lookup"))
}

// A callsign arrives from an application. Bounded and plain, so it cannot be a
// query of its own making. Portable prefixes and suffixes are ordinary, so the
// slash is allowed.
pub fn plain_callsign(callsign: &str) -> bool {
    !callsign.is_empty()
        && callsign.len() <= 32
        && callsign.chars().all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '-')
}

const MAX_FIELDS: usize = 64;
const MAX_FIELD_LEN: usize = 256;

pub fn lookup(
    provider: &str,
    creds: &Credentials,
    operation: &str,
    callsign: &str,
) -> CoreResult<Looked> {
    if !known_operation(provider, operation) { return Ok(Looked::Nothing("unsupported")); }
    if !plain_callsign(callsign) { return Ok(Looked::Nothing("invalid-request")); }

    let secret = service_secret(provider, creds).ok_or("No password is stored.")?;
    let username = creds.username.as_deref().filter(|s| !s.is_empty()).ok_or("No username is stored.")?;
    let client = reqwest::blocking::Client::builder().use_preconfigured_tls(tls_config()?)
        .https_only(true).no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(12))
        .user_agent(crate::HTTP_AGENT).build().map_err(|_| "Secure client is unavailable.")?;

    // 1. Sign in. Same fixed destination and POST body as the credential test.
    let login = match client.post("https://xmldata.qrz.com/xml/current/")
        .form(&[("username", username), ("password", secret), ("agent", crate::AGENT)])
        .send() { Ok(response) => response, Err(_) => return Ok(Looked::Nothing("network-error")) };
    let body = match read_bounded(login) { Ok(body) => body, Err(reason) => return Ok(Looked::Nothing(reason)) };
    let text = match std::str::from_utf8(&body) { Ok(text) => text, Err(_) => return Ok(Looked::Nothing("invalid-response")) };
    let key = match session_key(text) { Some(key) => key, None => return Ok(Looked::Nothing(parse_response(provider, text))) };

    // 2. Ask. POSTed, not in the query string: a session key is a credential
    //    for the rest of its life and this project puts none in a URL.
    let asked = match client.post("https://xmldata.qrz.com/xml/current/")
        .form(&[("s", key.as_str()), ("callsign", callsign), ("agent", crate::AGENT)])
        .send() { Ok(response) => response, Err(_) => return Ok(Looked::Nothing("network-error")) };
    let body = match read_bounded(asked) { Ok(body) => body, Err(reason) => return Ok(Looked::Nothing(reason)) };
    let text = match std::str::from_utf8(&body) { Ok(text) => text, Err(_) => return Ok(Looked::Nothing("invalid-response")) };
    Ok(read_callsign_fields(text))
}

fn read_bounded(response: reqwest::blocking::Response) -> std::result::Result<Zeroizing<Vec<u8>>, &'static str> {
    let code = response.status().as_u16();
    if code == 429 { return Err("rate-limited"); }
    if code == 401 || code == 403 { return Err("rejected"); }
    if !response.status().is_success() { return Err("network-error"); }
    if response.content_length().is_some_and(|length| length > MAX_BODY) { return Err("invalid-response"); }
    let mut body = Zeroizing::new(Vec::new());
    if response.take(MAX_BODY + 1).read_to_end(&mut body).is_err() { return Err("network-error"); }
    if body.len() as u64 > MAX_BODY { return Err("invalid-response"); }
    Ok(body)
}

// The one Session/Key, by the same rules parse_response applies: exactly one
// Session, no Error with text in it, exactly one non-empty Key.
fn session_key(body: &str) -> Option<Zeroizing<String>> {
    let doc = roxmltree::Document::parse(body).ok()?;
    let root = doc.root_element();
    if root.tag_name().name() != "QRZDatabase" || root.tag_name().namespace() != Some("http://xmldata.qrz.com") { return None; }
    let sessions: Vec<_> = root.children().filter(|n| n.is_element() && n.tag_name().name() == "Session").collect();
    if sessions.len() != 1 { return None; }
    let fields: Vec<_> = sessions[0].children().filter(|n| n.is_element()).collect();
    if fields.iter().any(|n| n.tag_name().name() == "Error" && n.text().is_some_and(|s| !s.trim().is_empty())) { return None; }
    let keys: Vec<_> = fields.iter().filter(|n| n.tag_name().name() == "Key").collect();
    if keys.len() != 1 { return None; }
    keys[0].text().map(str::trim).filter(|s| !s.is_empty()).map(|s| Zeroizing::new(s.to_string()))
}

// The Callsign element's own children, as they were sent. Bounded in count and
// in length, because this is a response from somewhere else.
fn read_callsign_fields(body: &str) -> Looked {
    let Ok(doc) = roxmltree::Document::parse(body) else { return Looked::Nothing("invalid-response"); };
    let root = doc.root_element();
    if root.tag_name().name() != "QRZDatabase" || root.tag_name().namespace() != Some("http://xmldata.qrz.com") {
        return Looked::Nothing("invalid-response");
    }
    // A session error on the second call means the key stopped working.
    let sessions: Vec<_> = root.children().filter(|n| n.is_element() && n.tag_name().name() == "Session").collect();
    for session in &sessions {
        for field in session.children().filter(|n| n.is_element() && n.tag_name().name() == "Error") {
            let text = field.text().unwrap_or("").trim().to_ascii_lowercase();
            if text.is_empty() { continue; }
            // "Not found" is an answer, not a failure.
            return Looked::Nothing(if text.contains("not found") { "not-found" } else { "rejected" });
        }
    }
    let found: Vec<_> = root.children().filter(|n| n.is_element() && n.tag_name().name() == "Callsign").collect();
    if found.len() != 1 { return Looked::Nothing("not-found"); }
    let mut fields = Vec::new();
    for field in found[0].children().filter(|n| n.is_element()) {
        if fields.len() >= MAX_FIELDS { break; }
        let name = field.tag_name().name();
        if name.is_empty() || name.len() > 32 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') { continue; }
        let Some(value) = field.text().map(str::trim).filter(|s| !s.is_empty()) else { continue; };
        if value.len() > MAX_FIELD_LEN || value.chars().any(char::is_control) { continue; }
        fields.push((name.to_ascii_lowercase(), value.to_string()));
    }
    if fields.is_empty() { return Looked::Nothing("invalid-response"); }
    Looked::Found(fields)
}

// A case-blind search that copies nothing, for a reply that may hold a secret.
fn contains_ignoring_case(haystack: &str, needle: &str) -> bool {
    haystack.as_bytes().windows(needle.len()).any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

// A page's text with its tags taken out, into a buffer wiped when dropped.
fn page_text(body: &str) -> Zeroizing<String> {
    let mut text = Zeroizing::new(String::with_capacity(body.len()));
    let mut in_tag = false;
    for c in body.chars() {
        match c { '<' => { in_tag = true; text.push(' '); } '>' => in_tag = false, _ if !in_tag => text.push(c), _ => {} }
    }
    text
}

// Whether some word of the text is a date: three parts joined by one kind of
// separator (- or /), one of them a year from 1990 to 2099, the others a day,
// a month number or a month's name. 2026-03-01, 01-Mar-2026, 03/01/2026.
fn names_a_date(text: &str) -> bool {
    const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    text.split(|c: char| c.is_whitespace() || c == ',').any(|word| {
        ['-', '/'].iter().any(|&separator| {
            let parts: Vec<&str> = word.split(separator).collect();
            if parts.len() != 3 { return false; }
            let year = |p: &str| p.len() == 4 && p.parse::<u32>().is_ok_and(|y| (1990..=2099).contains(&y));
            let small = |p: &str| (1..=2).contains(&p.len()) && p.parse::<u32>().is_ok_and(|n| (1..=31).contains(&n));
            let month = |p: &str| small(p) || MONTHS.iter().any(|m| p.len() >= 3 && p[..3].eq_ignore_ascii_case(m));
            (year(parts[0]) && month(parts[1]) && small(parts[2])) || (small(parts[0]) && month(parts[1]) && year(parts[2]))
        })
    })
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
        // 200 with a JSON object that is not Club Log's error shape. A refused
        // token is 401 and never reaches here; Club Log asks that it is not
        // retried, and it is not: a test runs once, when the operator asks.
        // A token in the reply, non-empty. It is read into a String of our own
        // and zeroized there; nothing keeps it.
        // A token in the reply, non-empty. Read into a Zeroizing String, which
        // wipes it when dropped, on the error path too: serde_json allocates the
        // field before it finds trailing input, and drops it then (found in review).
        "hamqth" => {
            #[derive(serde::Deserialize)]
            struct Login { token: Zeroizing<String> }
            match serde_json::from_str::<Login>(body) {
                Ok(login) if !login.token.trim().is_empty() => "success",
                Ok(_) | Err(_) => "invalid-response",
            }
        }
        // eQSL's reply is a short HTML page, and eQSL does not document it
        // (Programming.cfm describes the call, not its answer). A refusal says
        // "Error" (eqsl-mcp reads it the same way) or "No such". An answer is
        // the date of the last upload, so success needs a date in the page's
        // text, not merely a digit: a digit alone passed a maintenance page's
        // <h1> (found in review). Anything else is an answer we do not know.
        // The page may echo the request, password included, so it is searched
        // where it lies and copied only into a buffer that is wiped.
        "eqsl" => {
            if contains_ignoring_case(body, "error") || contains_ignoring_case(body, "no such") { "rejected" }
            else if names_a_date(&page_text(body)) { "success" }
            else { "invalid-response" }
        }
        // LoTW: ADIF's end-of-header tag is an accepted login; an HTML page
        // without one is LoTW's explanation of a refusal (ARRL: "the absence of
        // an ADIF end of header tag can be used to detect this outcome").
        "lotw" => {
            if contains_ignoring_case(body, "<eoh>") { "success" }
            else if contains_ignoring_case(body, "<html") { "rejected" }
            else { "invalid-response" }
        }
        "clublog" => match serde_json::from_str::<serde_json::Value>(body) {
            Ok(serde_json::Value::Object(fields)) if !fields.contains_key("error") => "success",
            Ok(serde_json::Value::Object(_)) => "rejected",
            _ => "invalid-response",
        },
        _ => "unsupported",
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_qrz_s_lookup_needs_a_username_and_the_logbook_s_key_stands_alone() {
        // #8: the register gives QRZ Logbook one field, its API key.
        assert!(needs_username("qrz"));
        assert!(!needs_username("qrz_logbook"));
        // #11: Club Log's token stands alone too, and can be tested.
        assert!(!needs_username("clublog"));
        assert!(supported("clublog"));
        // #9, #10, #12: each signs in with a username, and each can be tested.
        for provider in ["eqsl", "hamqth", "lotw"] {
            assert!(needs_username(provider), "{provider}");
            assert!(supported(provider), "{provider}");
        }
    }

    #[test]
    fn the_agent_is_the_application_s_real_version() {
        // #129: never the placeholder, always package.json's version.
        let manifest: serde_json::Value = serde_json::from_str(include_str!("../../../package.json")).unwrap();
        assert_eq!(crate::AGENT, format!("QGDesktop/{}", manifest["version"].as_str().unwrap()));
        assert!(!crate::AGENT.contains("0.0.0"));
        // Club Log bans an agent it cannot map to its owner (#11).
        assert_eq!(crate::HTTP_AGENT, format!("{} (+https://qso-graph.io)", crate::AGENT));
    }

    use super::*;
    // QGD-APP-0014 and QGD-PII-0007, at the parser.
    //
    // A live successful lookup needs a real QRZ credential, which no automated
    // suite has — the same reason the credential tests never sign in for real.
    // So the end-to-end gate reaches the "missing credential" answer and
    // stops, and the parsing of a successful response is established here,
    // deterministically, from a fixture.
    //
    // Found in review: without this, removing the lookup implementation
    // altogether still left the exit gate passing.
    #[test]
    fn a_successful_lookup_is_read_and_shown_in_full() {
        let body = r#"<QRZDatabase xmlns="http://xmldata.qrz.com"><Callsign>
            <call>W1AW</call><fname>ARRL HQ</fname><name>OPERATORS CLUB</name>
            <grid>FN31pr</grid><country>United States</country><dxcc>291</dxcc>
            <cqzone>5</cqzone><ituzone>8</ituzone><class>C</class>
            <addr1>225 Main St</addr1><addr2>Newington</addr2>
            <email>w1aw@arrl.org</email><phone>860-594-0200</phone>
            <lotw>1</lotw><eqsl>1</eqsl>
        </Callsign></QRZDatabase>"#;
        let Looked::Found(fields) = read_callsign_fields(body) else {
            panic!("a well-formed answer must be read")
        };
        let by_name: std::collections::BTreeMap<_, _> = fields.into_iter().collect();
        assert_eq!(by_name.get("call").map(String::as_str), Some("W1AW"));
        assert_eq!(by_name.get("grid").map(String::as_str), Some("FN31pr"));
        assert_eq!(by_name.get("dxcc").map(String::as_str), Some("291"));
        assert_eq!(by_name.get("class").map(String::as_str), Some("C"));
        // Shown, not stripped. Showing what QRZ returns for
        // a lookup the operator asked for is QRZ being the source, the same as
        // reading it on QRZ's own site. What QGD-PII-0007 governs is keeping
        // and passing on, which is the caller's rule — nothing here persists.
        assert_eq!(by_name.get("addr1").map(String::as_str), Some("225 Main St"));
        assert_eq!(by_name.get("email").map(String::as_str), Some("w1aw@arrl.org"));
        assert_eq!(by_name.get("phone").map(String::as_str), Some("860-594-0200"));
    }

    #[test]
    fn a_lookup_that_found_nothing_is_an_answer_not_a_failure() {
        let missing = r#"<QRZDatabase xmlns="http://xmldata.qrz.com"><Session><Error>Not found: NOSUCH</Error><Key>k</Key></Session></QRZDatabase>"#;
        assert!(matches!(read_callsign_fields(missing), Looked::Nothing("not-found")));
        let dead = r#"<QRZDatabase xmlns="http://xmldata.qrz.com"><Session><Error>Session Timeout</Error></Session></QRZDatabase>"#;
        assert!(matches!(read_callsign_fields(dead), Looked::Nothing("rejected")));
        // No Callsign element at all, and nothing said about why.
        let empty = r#"<QRZDatabase xmlns="http://xmldata.qrz.com"><Session><Key>k</Key></Session></QRZDatabase>"#;
        assert!(matches!(read_callsign_fields(empty), Looked::Nothing("not-found")));
        // Not QRZ's document, and an entity-expansion attempt.
        assert!(matches!(
            read_callsign_fields("<html><call>W1AW</call></html>"),
            Looked::Nothing("invalid-response")
        ));
        assert!(matches!(
            read_callsign_fields(r#"<!DOCTYPE x [<!ENTITY s SYSTEM "file:///etc/passwd">]><QRZDatabase/>"#),
            Looked::Nothing("invalid-response")
        ));
    }

    #[test]
    fn a_lookup_bounds_what_someone_else_sent() {
        let long = "x".repeat(300);
        let body = format!(
            r#"<QRZDatabase xmlns="http://xmldata.qrz.com"><Callsign><call>W1AW</call><bio>{long}</bio></Callsign></QRZDatabase>"#
        );
        let Looked::Found(fields) = read_callsign_fields(&body) else { panic!("should be read") };
        let names: Vec<_> = fields.iter().map(|(name, _)| name.as_str()).collect();
        assert!(names.contains(&"call"));
        // Over the length bound: dropped rather than passed on to a screen.
        assert!(!names.contains(&"bio"), "an over-long value must be dropped");
    }

    #[test]
    fn a_control_character_cannot_reach_a_field_at_all() {
        // Written after the test above asserted the wrong thing. XML forbids a
        // raw control character, so roxmltree refuses the whole document and
        // the field-level check never sees one — which is a stronger guarantee
        // than the check, not a weaker one. The check stays as defence in
        // depth; this records why it cannot be exercised through XML.
        let control = char::from(7u8);
        let body = format!(
            r#"<QRZDatabase xmlns="http://xmldata.qrz.com"><Callsign><call>a{control}b</call></Callsign></QRZDatabase>"#
        );
        assert!(matches!(read_callsign_fields(&body), Looked::Nothing("invalid-response")));
    }

    #[test]
    fn a_request_this_product_will_not_send_is_refused_without_a_credential() {
        // The pair the core checks before it reads anything (QGD-CRD-0009): an
        // operation it does not perform, or a callsign it will not send, needs
        // no credential to refuse.
        assert!(known_operation("qrz", "lookup"));
        for (provider, operation) in [("qrz", "delete"), ("eqsl", "lookup"), ("qrz_logbook", "lookup")] {
            assert!(!known_operation(provider, operation), "{provider}/{operation} must not be an operation");
        }
        assert!(plain_callsign("W1AW"));
        assert!(plain_callsign("KI7MT/P4"));
        assert!(plain_callsign("W1AW-1"));
        let too_long = "x".repeat(33);
        for bad in ["", "!", "W1AW ", "W1AW&callsign=X", "<script>", too_long.as_str()] {
            assert!(!plain_callsign(bad), "{bad:?} must not be sent");
        }
    }

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
        assert_eq!(parse_response("clublog", r#"{"allowance":{"minute":60,"day":1000}}"#), "success");
        assert_eq!(parse_response("clublog", r#"{"error":{"code":"unauthorized","message":"synthetic echoed secret","details":null}}"#), "rejected");
        assert_eq!(parse_response("clublog", "[]"), "invalid-response");
        assert_eq!(parse_response("clublog", "<html>ok</html>"), "invalid-response");
        assert_eq!(parse_response("hamqth", r#"{"token":"synthetic-token","expiresIn":3600}"#), "success");
        assert_eq!(parse_response("hamqth", r#"{"token":"  ","expiresIn":3600}"#), "invalid-response");
        assert_eq!(parse_response("hamqth", r#"{"type":"about:blank","detail":"synthetic echoed secret"}"#), "invalid-response");
        assert_eq!(parse_response("eqsl", "<html><body>Your last upload was 01-Mar-2026 12:00 UTC</body></html>"), "success");
        assert_eq!(parse_response("eqsl", "<html><body>Error: No such Username/Password found synthetic echoed secret</body></html>"), "rejected");
        assert_eq!(parse_response("eqsl", "<html><body>No such Username</body></html>"), "rejected");
        assert_eq!(parse_response("eqsl", "<html><body>Welcome</body></html>"), "invalid-response");
        // Found in review: a digit is not a date.
        assert_eq!(parse_response("eqsl", "<html><body><h1>Temporarily unavailable</h1></body></html>"), "invalid-response");
        assert_eq!(parse_response("eqsl", "<html><body>Login page. Copyright 2026 eQSL.cc</body></html>"), "invalid-response");
        assert_eq!(parse_response("eqsl", "<html><body>2026-03-01 12:00:00</body></html>"), "success");
        assert_eq!(parse_response("eqsl", "<p>Last upload: 03/01/2026</p>"), "success");
        // HamQTH: trailing input after a token is refused, and the token wiped on the way.
        assert_eq!(parse_response("hamqth", r#"{"token":"synthetic-token","expiresIn":3600} garbage"#), "invalid-response");
        assert_eq!(parse_response("lotw", "ARRL Logbook of the World Status Report\n<PROGRAMID:4>LoTW\n<eoh>\n"), "success");
        assert_eq!(parse_response("lotw", "<html><head><title>Logbook of the World</title></head><body><b>Username/password incorrect</b></body></html>"), "rejected");
        assert_eq!(parse_response("lotw", "something else"), "invalid-response");
        // #12, KI7MT's test: an accepted login whose file runs past 64 KB is
        // decided from its header, cut wherever the read stopped.
        let big = format!("ARRL Logbook of the World Status Report\n<PROGRAMID:4>LoTW\n<eoh>\n{}", "<CALL:4>W1AW<QSL_RCVD:1>Y<eor>\n".repeat(4000));
        let cut = &big[..MAX_BODY as usize];
        assert_eq!(parse_response("lotw", cut), "success");
        assert!(reads_prefix_only("lotw"));
        // This minute, the shape qso_qslsince takes with a time.
        let now = now_utc_minute();
        assert_eq!(now.len(), 19, "{now}");
        assert!(now.chars().enumerate().all(|(at, c)| match at { 4 | 7 => c == '-', 10 => c == ' ', 13 | 16 => c == ':', _ => c.is_ascii_digit() }), "{now}");
        assert!(now.ends_with(":00"), "{now}");
        // A real reply, 2026-11-01: an accepted
        // login with no records. The decision is <eoh>, wherever records follow.
        let real = "ARRL Logbook of the World Status Report\nGenerated at 2026-11-01 23:15:15\nfor w1aw\nQuery:\n    QSL ONLY: YES\nQSL RX SINCE: 2026-11-01 00:00:00 (user supplied value)\n\n<PROGRAMID:4>LoTW\n<APP_LoTW_NUMREC:1>0\n\n<eoh>\n\n<APP_LoTW_EOF>\n";
        assert_eq!(parse_response("lotw", real), "success");
        for provider in ["qrz", "qrz_logbook", "eqsl", "hamqth", "clublog"] { assert!(!reads_prefix_only(provider), "{provider}"); }
    }
    #[test]
    fn secure_client_requires_fips_crypto_and_only_tls13() {
        let config = tls_config().unwrap();
        assert!(config.fips());
        // Only TLS 1.3 may be advertised to anything carrying a credential.
        assert_eq!(offered_versions(config), vec![2, 3, 4]);
    }

    #[test]
    fn only_eqsl_s_login_may_use_tls_1_2() {
        // www.eqsl.cc offers TLS 1.2 and nothing newer, so
        // its login alone gets FIPS-mode TLS 1.2; every other credential is
        // TLS 1.3 only (QGD-SEC-0020). A second service on 1.2 is a decision,
        // and this test is where it shows.
        let eqsl = credential_tls_config("eqsl").unwrap();
        assert!(eqsl.fips());
        assert_eq!(offered_versions(eqsl), vec![4, 3, 4, 3, 3]);
        for provider in ["qrz", "qrz_logbook", "lotw", "hamqth", "clublog", "EQSL", "eqsl.cc", "unknown"] {
            let config = credential_tls_config(provider).unwrap();
            assert_eq!(offered_versions(config), vec![2, 3, 4], "{provider} must be TLS 1.3 only");
        }
    }
}
