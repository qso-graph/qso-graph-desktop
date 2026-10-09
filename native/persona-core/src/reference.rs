// SPDX-License-Identifier: GPL-3.0-only
// Fetching reference data, from the credential core.
//
// It is here because KI7MT decided it is (D-18, D-31): **all of the app's
// outbound HTTPS goes through the Rust core**, because Electron's own
// networking is BoringSSL and not the validated module — "without that, the
// FIPS claim would be false for most traffic". D-31 puts credentials *and all
// outbound HTTPS* in this one utility process.
//
// The first version of the reference loader used Node's `fetch` from the
// engine process. It worked, and it was wrong: Electron's TLS stack, not
// rustls over AWS-LC in FIPS mode, and no TLS 1.3 floor. Nothing about the
// data it carries is secret — ADIF's archive and POTA's park list are public
// files — but the decision is not about secrecy. It is that there is one TLS
// stack in this product and a claim that rests on it.
//
// So: the same client the credential tests use (validation.rs), same
// preconfigured TLS, same HTTPS-only, same no-proxy, same no-redirect. The
// caller passes a URL it read from the register and gets bytes back.
use crate::validation::tls_config;
use std::io::Read;
use std::time::Duration;

type CoreResult<T> = std::result::Result<T, &'static str>;

// POTA's park list is 9.4 MB and ADIF's archive 1.7 MB. The bound is what a
// damaged or hostile server can make this allocate, and it is checked against
// the declared length and again while reading, because a server can declare
// one length and send another.
const MAX_BODY: u64 = 32 * 1024 * 1024;

pub struct Fetched {
    // False when the server answered 304: nothing changed, and `body` is
    // empty. The two are different answers and the caller acts on both
    // (QGD-REF-0010).
    pub fresh: bool,
    pub body: Vec<u8>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

fn header(response: &reqwest::blocking::Response, name: &str) -> Option<String> {
    response.headers().get(name)
        .and_then(|value| value.to_str().ok())
        // A validator is echoed back on the next request, so it is bounded
        // and stripped of anything that is not a header value.
        .filter(|value| value.len() <= 256 && !value.chars().any(char::is_control))
        .map(|value| value.to_string())
}

pub fn fetch(url: &str, etag: Option<&str>, last_modified: Option<&str>) -> CoreResult<Fetched> {
    // The register says where; this says only that it must be HTTPS. A URL
    // that is not is refused here as well as in the caller.
    if !url.starts_with("https://") { return Err("Reference data is fetched over HTTPS only."); }

    let client = reqwest::blocking::Client::builder()
        .use_preconfigured_tls(tls_config()?)
        .https_only(true).no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(120))
        .user_agent("QGDesktop/0.0.0-preview.1")
        .build().map_err(|_| "Secure client is unavailable.")?;

    let mut request = client.get(url);
    // Asked with both where both are known: a server honouring either
    // answers 304 and sends nothing, which is the point of asking
    // (QGD-REF-0010).
    if let Some(etag) = etag.filter(|value| !value.is_empty() && value.len() <= 256) {
        request = request.header("If-None-Match", etag);
    }
    if let Some(since) = last_modified.filter(|value| !value.is_empty() && value.len() <= 256) {
        request = request.header("If-Modified-Since", since);
    }

    let response = request.send().map_err(|_| "The reference source could not be reached.")?;
    if response.status().as_u16() == 304 {
        return Ok(Fetched { fresh: false, body: Vec::new(), etag: None, last_modified: None });
    }
    if !response.status().is_success() { return Err("The reference source refused the request."); }
    if response.content_length().is_some_and(|length| length > MAX_BODY) {
        return Err("The reference source sent more than this product will read.");
    }

    let etag = header(&response, "etag");
    let last_modified = header(&response, "last-modified");
    let mut body = Vec::new();
    // Read with its own bound, because a declared length is a claim.
    response.take(MAX_BODY + 1).read_to_end(&mut body)
        .map_err(|_| "The reference source could not be read.")?;
    if body.len() as u64 > MAX_BODY {
        return Err("The reference source sent more than this product will read.");
    }
    Ok(Fetched { fresh: true, body, etag, last_modified })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_anything_that_is_not_https() {
        // The scheme check is before the client is built, so this needs no
        // network to assert.
        for url in ["http://adif.org.uk/x.zip", "file:///etc/passwd", "ftp://example.invalid/x"] {
            assert!(fetch(url, None, None).is_err(), "{url} should be refused");
        }
    }

    #[test]
    fn the_client_is_the_one_the_credential_tests_use() {
        // Same preconfigured TLS: FIPS provider, TLS 1.3 only. tls_config
        // itself refuses to build if the provider is not in FIPS mode, so
        // this failing means the whole crypto posture has moved.
        let config = tls_config().expect("the core's TLS config must build");
        assert!(config.fips(), "the reference fetch must use the FIPS provider");
    }
}
