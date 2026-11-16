// SPDX-License-Identifier: GPL-3.0-or-later
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
// So: the same client the credential tests use (validation.rs): FIPS
// provider, roots, TLS 1.3 only, HTTPS-only, no proxy, no redirect. It allowed
// TLS 1.2 until #213, because adif.org.uk offers nothing newer; ADIF's archive
// now comes from QSO Graph's copy, unmodified and checked against the same
// SHA-256, and every source the register names offers TLS 1.3. The caller
// passes a URL it read from the register and gets bytes back.
use crate::politeness::{self, Gate, Outcome};
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
    // Not asked (#79): the source rests until then, in ms since the epoch.
    pub resting_until: Option<f64>,
}

fn resting(until: Option<std::time::Instant>) -> Fetched {
    Fetched {
        fresh: false,
        body: Vec::new(),
        etag: None,
        last_modified: None,
        resting_until: until.map(politeness::epoch_ms),
    }
}

fn header(response: &reqwest::blocking::Response, name: &str) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        // A validator is echoed back on the next request, so it is bounded
        // and stripped of anything that is not a header value.
        .filter(|value| value.len() <= 256 && !value.chars().any(char::is_control))
        .map(|value| value.to_string())
}

pub fn fetch(url: &str, etag: Option<&str>, last_modified: Option<&str>) -> CoreResult<Fetched> {
    // The register says where; this says only that it must be HTTPS. A URL
    // that is not is refused here as well as in the caller.
    if !url.starts_with("https://") {
        return Err("Reference data is fetched over HTTPS only.");
    }
    // No credential in the URL: reqwest would send userinfo as Basic auth, and
    // a reference fetch never carries one.
    let parsed = reqwest::Url::parse(url).map_err(|_| "That is not a reference source address.")?;
    // Checked on the parsed address too, which is the one that is fetched (code scanning's
    // rust/non-https-url; the client below refuses anything else as well).
    if parsed.scheme() != "https" {
        return Err("Reference data is fetched over HTTPS only.");
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("A reference source address may not carry a user name or password.");
    }
    // Its floor, and any wait the server asked for, before anything is sent:
    // nothing outside this process can ask more often (#79).
    if let Gate::Resting(until) = politeness::gate(url)? {
        return Ok(resting(Some(until)));
    }

    let client = reqwest::blocking::Client::builder()
        .use_preconfigured_tls(tls_config()?)
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .user_agent(crate::AGENT)
        .build()
        .map_err(|_| "Secure client is unavailable.")?;

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
        let asked = politeness::retry_after(
            response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok()),
        );
        return Ok(resting(politeness::record(url, Outcome::Busy(asked))));
    }
    politeness::record(url, Outcome::Answered);
    if status.as_u16() == 304 {
        return Ok(Fetched {
            fresh: false,
            body: Vec::new(),
            etag: None,
            last_modified: None,
            resting_until: None,
        });
    }
    if !status.is_success() {
        return Err("The reference source refused the request.");
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY)
    {
        return Err("The reference source sent more than this product will read.");
    }

    let etag = header(&response, "etag");
    let last_modified = header(&response, "last-modified");
    let mut body = Vec::new();
    // Read with its own bound, because a declared length is a claim.
    response
        .take(MAX_BODY + 1)
        .read_to_end(&mut body)
        .map_err(|_| "The reference source could not be read.")?;
    if body.len() as u64 > MAX_BODY {
        return Err("The reference source sent more than this product will read.");
    }
    Ok(Fetched {
        fresh: true,
        body,
        etag,
        last_modified,
        resting_until: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_anything_that_is_not_https() {
        // The scheme check is before the client is built, so this needs no
        // network to assert.
        for url in [
            "http://adif.org.uk/x.zip",
            "file:///etc/passwd",
            "ftp://example.invalid/x",
        ] {
            assert!(fetch(url, None, None).is_err(), "{url} should be refused");
        }
    }

    #[test]
    fn the_reference_client_is_fips_and_tls13_only() {
        // The credential client's own config: the FIPS provider, and TLS 1.3
        // alone, since every reference source offers it (#213).
        let config = tls_config().expect("the TLS config must build");
        assert!(
            config.fips(),
            "the reference fetch must use the FIPS provider"
        );
        assert_eq!(crate::validation::offered_versions(config), vec![2, 3, 4]);
    }

    // Network, so not in the ordinary run: cargo test -- --ignored.
    // ADIF's archive, from the address the register names, over TLS 1.3.
    #[test]
    #[ignore]
    fn reaches_adif_s_archive_on_the_copy() {
        let register: serde_json::Value =
            serde_json::from_str(include_str!("../../../data/reference-sources.json")).unwrap();
        let url = register["adif"]["source"]["url"].as_str().unwrap();
        let fetched = fetch(url, None, None).expect("the copy must be reachable over TLS 1.3");
        assert!(fetched.fresh && fetched.body.len() > 1_000_000);
    }

    #[test]
    fn refuses_a_url_carrying_a_user_name_or_password() {
        for url in [
            "https://user:secret@adif.org.uk/x.zip",
            "https://user@adif.org.uk/x.zip",
            "https://:secret@adif.org.uk/x.zip",
            "https://us%65r:s%65cret@adif.org.uk/x.zip",
        ] {
            assert!(fetch(url, None, None).is_err(), "{url} should be refused");
        }
    }
}
