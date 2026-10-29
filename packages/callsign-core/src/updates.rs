// SPDX-License-Identifier: GPL-3.0-only
// Updates, fetched by the credential core (QGD-FRM-0019, QGD-SEC-0020).
//
// Two requests and no others. The feed, from the one address the register
// names, small and never redirected. And a download, from a host the register
// names, followed through redirects only while every hop is one of them,
// written to a file as it arrives and accepted only when its SHA-256 is the
// one the feed gave. A host is trusted to deliver bytes, never to say what
// they are: a mirror that sends something else is refused, the same as a
// broken download.
//
// The register is built in (data/update-sources.json), so nothing outside this
// process can widen where it goes. Which update to take, and when, is main's
// decision; it hands over a URL and a sum it read from the feed, and gets a
// path back.
use crate::validation::reference_tls_config;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

type CoreResult<T> = std::result::Result<T, &'static str>;

const SOURCES: &str = include_str!("../../../data/update-sources.json");

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sources {
    feed: String,
    feed_signature: String,
    feed_key: crate::feed_signature::FeedKey,
    download_hosts: Vec<String>,
    max_feed_bytes: u64,
    max_signature_bytes: u64,
    max_download_bytes: u64,
}

fn sources() -> CoreResult<Sources> {
    let sources: Sources = serde_json::from_str(SOURCES).map_err(|_| "The update register could not be read.")?;
    if !sources.feed.starts_with("https://") || sources.feed_signature != format!("{}.asc", sources.feed) {
        return Err("The update register could not be read.");
    }
    Ok(sources)
}

// `github.com` is that host; `*.qso-graph.io` is any name under it, and not
// the domain itself. Compared lower-cased, as DNS does.
pub(crate) fn host_allowed(host: &str, patterns: &[String]) -> bool {
    let host = host.to_ascii_lowercase();
    if host.is_empty() || host.ends_with('.') { return false; }
    patterns.iter().any(|pattern| match pattern.strip_prefix("*.") {
        Some(domain) => host.len() > domain.len() + 1 && host.ends_with(&format!(".{domain}")),
        None => host == *pattern,
    })
}

fn allowed_url(url: &reqwest::Url, patterns: &[String]) -> bool {
    url.scheme() == "https"
        && url.username().is_empty() && url.password().is_none()
        && url.port().is_none()
        && url.host_str().is_some_and(|host| host_allowed(host, patterns))
}

// The file name main asks for, in the release's own form: it names the
// version and the platform, and it is never a path.
pub(crate) fn valid_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("qso-graph-desktop-") else { return false };
    name.len() <= 120
        && (rest.ends_with(".exe") || rest.ends_with(".AppImage") || rest.ends_with("-mac-arm64.zip"))
        && rest.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
        && !rest.contains("..")
}

pub(crate) fn valid_sum(sum: &str) -> bool {
    sum.len() == 64 && sum.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn client(redirect: reqwest::redirect::Policy, timeout: Duration) -> CoreResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .use_preconfigured_tls(reference_tls_config()?)
        .https_only(true).no_proxy().redirect(redirect)
        .connect_timeout(Duration::from_secs(10)).timeout(timeout)
        .user_agent(crate::AGENT)
        .build().map_err(|_| "Secure client is unavailable.")
}

// The feed is two requests, one after the other (the feed, then its
// signature), each allowed this long. The callsign service's deadline for the
// whole is set past both (packages/callsigns/deadlines.ts, which a test reads
// against these two numbers).
const FEED_TIMEOUT_SECS: u64 = 30;
const FEED_REQUESTS: u64 = 2;
// Both requests at their ceiling still end inside the service's 75 s deadline.
const _: () = assert!(FEED_TIMEOUT_SECS * FEED_REQUESTS < 75);

// One small file from one address, never redirected, no larger than `limit`.
fn fetch_small(url: &str, limit: u64) -> CoreResult<Vec<u8>> {
    let response = client(reqwest::redirect::Policy::none(), Duration::from_secs(FEED_TIMEOUT_SECS))?
        .get(url).send().map_err(|_| "The update feed could not be reached.")?;
    if !response.status().is_success() { return Err("The update feed refused the request."); }
    if response.content_length().is_some_and(|length| length > limit) {
        return Err("The update feed is larger than this product will read.");
    }
    let mut body = Vec::new();
    response.take(limit + 1).read_to_end(&mut body).map_err(|_| "The update feed could not be read.")?;
    if body.len() as u64 > limit { return Err("The update feed is larger than this product will read."); }
    Ok(body)
}

// When the newest feed this copy accepted was signed. A feed signed earlier is
// refused, so an old feed that was genuinely signed cannot be served again to
// offer an old release (#128). It is beside the callsign files, not in
// updates/, which the updater empties after every update; and a version's
// snapshot never keeps it and going back never restores it (packages/main/
// snapshots.ts names it), so returning to an earlier version cannot wind it
// back.
pub(crate) const FEED_SEEN: &str = "feed-signed.txt";

pub(crate) fn accept_signed_at(directory: &Path, signed: i64) -> CoreResult<()> {
    let path = directory.join(FEED_SEEN);
    let seen = fs::read_to_string(&path).ok().and_then(|text| text.trim().parse::<i64>().ok());
    if seen.is_some_and(|seen| signed < seen) {
        return Err("The update feed is older than one this copy has already seen, so it was not used.");
    }
    if seen != Some(signed) {
        fs::create_dir_all(directory).map_err(|_| "The update feed could not be recorded.")?;
        let partial = directory.join(format!("{FEED_SEEN}.part"));
        fs::write(&partial, signed.to_string()).map_err(|_| "The update feed could not be recorded.")?;
        fs::rename(&partial, &path).map_err(|_| "The update feed could not be recorded.")?;
    }
    Ok(())
}

/// The feed, as bytes, once its signature is the release key's and it is no
/// older than the newest this copy has accepted. Main reads what it says.
pub fn fetch_feed(directory: &Path) -> CoreResult<Vec<u8>> {
    let sources = sources()?;
    let body = fetch_small(&sources.feed, sources.max_feed_bytes)?;
    let signature = fetch_small(&sources.feed_signature, sources.max_signature_bytes)
        .map_err(|_| "The update feed has no signature that could be fetched, so it was not used.")?;
    let signed = crate::feed_signature::verify(&body, &signature, &sources.feed_key)?;
    accept_signed_at(directory, signed)?;
    Ok(body)
}

/// Downloads `url` to `<directory>/updates/<name>`, checked against `sum`,
/// and returns the path. Any earlier download in that folder is removed
/// first: one update is kept at a time.
pub fn download(directory: &Path, url: &str, sum: &str, name: &str) -> CoreResult<PathBuf> {
    let sources = sources()?;
    if !valid_name(name) { return Err("That is not an update file name."); }
    if !valid_sum(sum) { return Err("That is not an update checksum."); }
    let parsed = reqwest::Url::parse(url).map_err(|_| "That is not an update address.")?;
    if !allowed_url(&parsed, &sources.download_hosts) { return Err("Updates are downloaded only from the hosts this product names."); }

    let hosts = sources.download_hosts.clone();
    let redirect = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 { attempt.error("too many redirects") }
        else if allowed_url(attempt.url(), &hosts) { attempt.follow() }
        else { attempt.stop() }
    });
    // Two hours: 400 MB on a slow line, which a ham at a park may have.
    let mut response = client(redirect, Duration::from_secs(2 * 60 * 60))?
        .get(parsed).send().map_err(|_| "The update could not be reached.")?;
    if response.status().is_redirection() { return Err("Updates are downloaded only from the hosts this product names."); }
    if !response.status().is_success() { return Err("The update download was refused."); }
    if response.content_length().is_some_and(|length| length > sources.max_download_bytes) {
        return Err("The update is larger than this product will download.");
    }

    let folder = directory.join("updates");
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).map_err(|_| "The update could not be saved.")?;
    let partial = folder.join(format!("{name}.part"));
    let finished = folder.join(name);
    let result = (|| {
        let mut file = File::create(&partial).map_err(|_| "The update could not be saved.")?;
        let mut digest = aws_lc_rs::digest::Context::new(&aws_lc_rs::digest::SHA256);
        let mut buffer = vec![0u8; 64 * 1024];
        let mut total: u64 = 0;
        loop {
            let read = response.read(&mut buffer).map_err(|_| "The update download was interrupted.")?;
            if read == 0 { break; }
            total += read as u64;
            if total > sources.max_download_bytes { return Err("The update is larger than this product will download."); }
            digest.update(&buffer[..read]);
            file.write_all(&buffer[..read]).map_err(|_| "The update could not be saved.")?;
        }
        file.sync_all().map_err(|_| "The update could not be saved.")?;
        let got: String = digest.finish().as_ref().iter().map(|byte| format!("{byte:02x}")).collect();
        if got != sum { return Err("The update did not match its checksum, so it was not kept."); }
        fs::rename(&partial, &finished).map_err(|_| "The update could not be saved.")?;
        Ok(finished.clone())
    })();
    if result.is_err() { let _ = fs::remove_file(&partial); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patterns() -> Vec<String> { sources().unwrap().download_hosts }

    #[test]
    fn the_register_names_the_release_key_and_its_numbers_are_that_key() {
        let sources = sources().unwrap();
        assert_eq!(sources.feed_key.fingerprint, "E4EC9751F1AA66AB2BA508EF041096B9A6EBD256");
        assert_eq!(sources.feed_signature, "https://updates.qso-graph.io/desktop.json.asc");
        // The built-in numbers are that key's: they reproduce its fingerprint.
        let key = &sources.feed_key;
        assert_eq!(crate::feed_signature::fingerprint_of(key), crate::feed_signature::hex(&key.fingerprint));
    }

    #[test]
    fn an_older_feed_than_one_already_accepted_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        accept_signed_at(dir.path(), 1_800_000_000).unwrap();
        accept_signed_at(dir.path(), 1_800_000_000).unwrap(); // the same feed again
        accept_signed_at(dir.path(), 1_800_000_100).unwrap(); // a newer one
        assert!(accept_signed_at(dir.path(), 1_800_000_050).is_err());
        assert_eq!(fs::read_to_string(dir.path().join(FEED_SEEN)).unwrap(), "1800000100");
    }


    #[test]
    fn the_register_builds_in_and_names_an_https_feed() {
        let sources = sources().unwrap();
        assert!(sources.feed.starts_with("https://updates.qso-graph.io/"));
        assert!(sources.max_download_bytes >= 200 * 1024 * 1024);
    }

    #[test]
    fn only_the_named_hosts_are_allowed() {
        let patterns = patterns();
        for host in ["github.com", "GitHub.com", "release-assets.githubusercontent.com", "dl.qso-graph.io",
                     "dl.qso-graph.com", "mirror.qso-graph.org", "downloads.sourceforge.net", "netix.dl.sourceforge.net"] {
            assert!(host_allowed(host, &patterns), "{host} should be allowed");
        }
        for host in ["qso-graph.io", "evilqso-graph.io", "github.com.evil.example", "api.github.com.",
                     "gist.github.com", "dl.qso-graph.net", "dl.sourceforge.net", "example.com", ""] {
            assert!(!host_allowed(host, &patterns), "{host} should be refused");
        }
    }

    #[test]
    fn a_url_must_be_https_with_no_login_or_port() {
        let patterns = patterns();
        let ok = |url: &str| allowed_url(&reqwest::Url::parse(url).unwrap(), &patterns);
        assert!(ok("https://github.com/qso-graph/qso-graph-desktop/releases/download/v0.1.0/x.exe"));
        assert!(!ok("http://github.com/x.exe"));
        assert!(!ok("https://user:pass@github.com/x.exe"));
        assert!(!ok("https://github.com:8443/x.exe"));
    }

    #[test]
    fn names_and_sums_are_checked_before_anything_is_fetched() {
        assert!(valid_name("qso-graph-desktop-0.1.1-win-x64.exe"));
        assert!(valid_name("qso-graph-desktop-0.1.1-linux-x86_64.AppImage"));
        assert!(valid_name("qso-graph-desktop-0.1.1-mac-arm64.zip"));
        for name in ["../qso-graph-desktop-0.1.1-win-x64.exe", "qso-graph-desktop-../../x.exe",
                     "qso-graph-desktop-0.1.1-linux-x64.zip", "other-0.1.1.exe", "qso-graph-desktop-0.1.1/x.exe"] {
            assert!(!valid_name(name), "{name} should be refused");
        }
        assert!(valid_sum(&"a".repeat(64)));
        assert!(!valid_sum(&"A".repeat(64)) && !valid_sum("abc"));
        let directory = std::env::temp_dir();
        let sum = "0".repeat(64);
        assert!(download(&directory, "https://example.com/qso-graph-desktop-0.1.1-win-x64.exe", &sum,
                         "qso-graph-desktop-0.1.1-win-x64.exe").is_err());
        assert!(download(&directory, "https://github.com/x", "nope", "qso-graph-desktop-0.1.1-win-x64.exe").is_err());
    }
}
