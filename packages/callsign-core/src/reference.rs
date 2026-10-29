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
// rustls over AWS-LC in FIPS mode. Nothing about the
// data it carries is secret — ADIF's archive and POTA's park list are public
// files — but the decision is not about secrecy. It is that there is one TLS
// stack in this product and a claim that rests on it.
//
// So: the same FIPS provider and roots the credential tests use
// (validation.rs), same HTTPS-only, same no-proxy, same no-redirect. One
// difference: TLS 1.2 is allowed beside 1.3, because adif.org.uk offers only
// 1.2 and a 1.3-only client never reached it; a credential is never sent this
// way (reference_tls_config). The caller passes a URL it read from the
// register and gets bytes back.
use crate::politeness::{self, Gate, Outcome};
use crate::validation::reference_tls_config;
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
    // Not asked (#79): the source rests until then, in ms since the epoch.
    pub resting_until: Option<f64>,
}

fn resting(until: Option<std::time::Instant>) -> Fetched {
    Fetched { fresh: false, body: Vec::new(), etag: None, last_modified: None, resting_until: until.map(politeness::epoch_ms) }
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
    // No credential in the URL: reqwest would send userinfo as Basic auth, and
    // this client may use TLS 1.2, which a credential never does.
    let parsed = reqwest::Url::parse(url).map_err(|_| "That is not a reference source address.")?;
    // Checked on the parsed address too, which is the one that is fetched (code scanning's
    // rust/non-https-url; the client below refuses anything else as well).
    if parsed.scheme() != "https" { return Err("Reference data is fetched over HTTPS only."); }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("A reference source address may not carry a user name or password.");
    }
    // Its floor, and any wait the server asked for, before anything is sent:
    // nothing outside this process can ask more often (#79).
    if let Gate::Resting(until) = politeness::gate(url)? { return Ok(resting(Some(until))); }

    let client = reqwest::blocking::Client::builder()
        .use_preconfigured_tls(reference_tls_config()?)
        .https_only(true).no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(120))
        .user_agent(crate::AGENT)
        .build().map_err(|_| "Secure client is unavailable.")?;

    let mut request = client.get(parsed);
    // Asked with both where both are known: a server honouring either
    // answers 304 and sends nothing, which is the point of asking
    // (QGD-REF-0010).
    if let Some(etag) = etag.filter(|value| !value.is_empty() && value.len() <= 256) {
        request = request.header("If-None-Match", etag);
    }
    if let Some(since) = last_modified.filter(|value| !value.is_empty() && value.len() <= 256) {
        request = request.header("If-Modified-Since", since);
    }

    let response = match request.send() {
        Ok(response) => response,
        Err(_) => {
            politeness::record(url, Outcome::Unreachable);
            return Err("The reference source could not be reached.");
        }
    };
    let status = response.status();
    // Busy or failing: left alone for as long as it asks, or a backoff (#79).
    if status.as_u16() == 429 || status.is_server_error() {
        let asked = politeness::retry_after(response.headers().get("retry-after").and_then(|value| value.to_str().ok()));
        return Ok(resting(politeness::record(url, Outcome::Busy(asked))));
    }
    politeness::record(url, Outcome::Answered);
    if status.as_u16() == 304 {
        return Ok(Fetched { fresh: false, body: Vec::new(), etag: None, last_modified: None, resting_until: None });
    }
    if !status.is_success() { return Err("The reference source refused the request."); }
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
    Ok(Fetched { fresh: true, body, etag, last_modified, resting_until: None })
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
    fn the_reference_client_is_fips_and_offers_only_approved_suites() {
        // TLS 1.3, or 1.2 for a source that offers nothing newer, and still
        // the FIPS provider: reference_tls_config refuses to build otherwise.
        let config = reference_tls_config().expect("the reference TLS config must build");
        assert!(config.fips(), "the reference fetch must use the FIPS provider");
        // TLS 1.3 and 1.2, exactly: without 1.2, adif.org.uk cannot be reached.
        assert_eq!(crate::validation::offered_versions(config.clone()), vec![4, 3, 4, 3, 3]);
        // Every suite it can offer is TLS 1.3, or TLS 1.2 ECDHE with AES-GCM.
        for suite in &config.crypto_provider().cipher_suites {
            let name = format!("{:?}", suite.suite());
            assert!(name.starts_with("TLS13_AES_") || (name.starts_with("TLS_ECDHE_") && name.contains("_AES_") && name.contains("_GCM_")),
                "{name} is not an approved suite");
        }
        // Key exchange on the NIST curves (or their post-quantum hybrids), never X25519 alone.
        for group in &config.crypto_provider().kx_groups {
            let name = format!("{:?}", group.name());
            assert!(name != "X25519", "{name} is not FIPS-approved");
        }
    }

    // Network, so not in the ordinary run: cargo test -- --ignored.
    // adif.org.uk offers only TLS 1.2, which the 1.3-only client could not
    // reach; ADIF's definitions never loaded in a packaged build until this.
    #[test]
    #[ignore]
    fn reaches_a_tls12_only_source() {
        let fetched = fetch("https://adif.org.uk/317/ADIF_317_resources_2026_03_22.zip", None, None).expect("adif.org.uk must be reachable");
        assert!(fetched.fresh && fetched.body.len() > 1_000_000);
    }

    #[test]
    fn refuses_a_url_carrying_a_user_name_or_password() {
        for url in ["https://user:secret@adif.org.uk/x.zip", "https://user@adif.org.uk/x.zip",
                    "https://:secret@adif.org.uk/x.zip", "https://us%65r:s%65cret@adif.org.uk/x.zip"] {
            assert!(fetch(url, None, None).is_err(), "{url} should be refused");
        }
    }
}
