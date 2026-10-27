// SPDX-License-Identifier: GPL-3.0-only
// How often each source may be asked (#79, KI7MT 2026-10-26), enforced here.
//
// Every reference and extension request goes through this process (D-18,
// D-31), so this is the one place a floor cannot be stepped around: not by a
// manifest's refresh, a Refresh button, or Settings' Update. The floors are in
// the two source registers, beside each URL, with the provider's stated limit
// or our judgement and its reason (CLAUDE.md: rate limiting). They are
// compiled in, as the update register is (updates.rs), so nothing outside this
// process can loosen them.
//
// A request inside its floor is not sent: the caller is told until when the
// source is resting, and says so where the operator sees it. A server that
// answers 429 or 5xx is left alone for as long as its Retry-After asks (at most
// a day), or for a backoff that doubles from a minute to an hour; so is one
// that cannot be reached. The times are kept for this run of the application:
// restarting it is a deliberate act, and each list's own 24-hour window is
// already kept with the list.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const EXTENSION_SOURCES: &str = include_str!("../../../data/extension-sources.json");
const REFERENCE_SOURCES: &str = include_str!("../../../data/reference-sources.json");

// What a server can ask for in Retry-After, and the backoff's bounds.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(24 * 60 * 60);
const FIRST_BACKOFF: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Floor {
    // The URL, or for a template (`.../location/parks/{code}`) what comes before
    // its first `{`: each URL it makes is asked on its own.
    prefix: String,
    template: bool,
    min: Duration,
}

impl Floor {
    fn matches(&self, url: &str) -> bool {
        if self.template { url.starts_with(&self.prefix) && url.len() > self.prefix.len() } else { url == self.prefix }
    }
}

fn floor(url: &str, seconds: u64) -> Floor {
    match url.find('{') {
        Some(at) => Floor { prefix: url[..at].to_string(), template: true, min: Duration::from_secs(seconds) },
        None => Floor { prefix: url.to_string(), template: false, min: Duration::from_secs(seconds) },
    }
}

fn seconds(politeness: &serde_json::Value, key: &str) -> Option<u64> {
    politeness.get(key)?.get("minSeconds")?.as_u64().filter(|value| *value > 0)
}

// Every https:// string under `value`, which is how the reference register
// holds a group's URLs (`sources.parks.url`, `source.urls.location`, ...).
fn urls(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(text) if text.starts_with("https://") => out.push(text.clone()),
        serde_json::Value::Array(items) => items.iter().for_each(|item| urls(item, out)),
        serde_json::Value::Object(map) => map.values().for_each(|item| urls(item, out)),
        _ => {}
    }
}

// The floors the registers give, or an error naming the first source that has
// none: a source with no floor is a register mistake, refused at build and
// test time rather than asked without one.
pub(crate) fn floors_from(extension: &str, reference: &str) -> Result<Vec<Floor>, String> {
    let extension: serde_json::Value = serde_json::from_str(extension).map_err(|_| "extension-sources.json is not JSON".to_string())?;
    let reference: serde_json::Value = serde_json::from_str(reference).map_err(|_| "reference-sources.json is not JSON".to_string())?;
    let mut out = Vec::new();
    let polite = &extension["politeness"];
    for (id, url) in extension["sources"].as_object().ok_or("extension-sources.json has no sources")? {
        let url = url.as_str().ok_or_else(|| format!("source {id} is not a URL"))?;
        let min = seconds(polite, id).ok_or_else(|| format!("extension source {id} has no politeness.minSeconds"))?;
        out.push(floor(url, min));
    }
    let polite = &reference["politeness"];
    for group in ["adif", "pota", "sota", "activations"] {
        let mut found = Vec::new();
        urls(&reference[group], &mut found);
        if found.is_empty() { return Err(format!("reference group {group} has no URL")); }
        let min = seconds(polite, group).ok_or_else(|| format!("reference group {group} has no politeness.minSeconds"))?;
        out.extend(found.iter().map(|url| floor(url, min)));
    }
    Ok(out)
}

fn floors() -> &'static [Floor] {
    static FLOORS: OnceLock<Vec<Floor>> = OnceLock::new();
    // A register without a floor fails the core's own tests (below), so an
    // empty table here means nothing is asked, never that everything may be.
    FLOORS.get_or_init(|| floors_from(EXTENSION_SOURCES, REFERENCE_SOURCES).unwrap_or_default())
}

#[derive(Default)]
struct Entry {
    last: Option<Instant>,
    not_before: Option<Instant>,
    failures: u32,
}

#[derive(Debug, PartialEq)]
pub(crate) enum Gate {
    Go,
    // Not asked: the source rests until then.
    Resting(Instant),
}

pub(crate) enum Outcome {
    Answered,
    // 429 or 5xx, with the Retry-After it gave, if it gave one in seconds.
    Busy(Option<Duration>),
    Unreachable,
}

#[derive(Default)]
pub(crate) struct Ledger {
    entries: HashMap<String, Entry>,
}

impl Ledger {
    pub(crate) fn gate(&mut self, floors: &[Floor], url: &str, now: Instant) -> Result<Gate, &'static str> {
        let floor = floors.iter().find(|floor| floor.matches(url)).ok_or("That is not a source this product asks.")?;
        let entry = self.entries.entry(url.to_string()).or_default();
        if let Some(until) = entry.not_before.filter(|until| *until > now) { return Ok(Gate::Resting(until)); }
        if let Some(until) = entry.last.map(|last| last + floor.min).filter(|until| *until > now) { return Ok(Gate::Resting(until)); }
        // Counted from the asking, whatever the answer: a source that fails
        // fast is not asked again any sooner.
        entry.last = Some(now);
        Ok(Gate::Go)
    }

    // The wait in force afterwards, if any. A wait is only ever lengthened: two requests to one source
    // can be out at once (the timeout outlasts the shortest floor), and whichever answers last must not
    // shorten a wait the other was told, by a shorter Retry-After, a backoff, or by succeeding.
    pub(crate) fn record(&mut self, url: &str, outcome: Outcome, now: Instant) -> Option<Instant> {
        let entry = self.entries.entry(url.to_string()).or_default();
        let wait = match outcome {
            Outcome::Answered => { entry.failures = 0; None }
            Outcome::Busy(Some(asked)) => {
                entry.failures = entry.failures.saturating_add(1);
                Some(asked.min(MAX_RETRY_AFTER))
            }
            Outcome::Busy(None) | Outcome::Unreachable => {
                entry.failures = entry.failures.saturating_add(1);
                let doublings = entry.failures.saturating_sub(1).min(16);
                Some(FIRST_BACKOFF.saturating_mul(1u32 << doublings).min(MAX_BACKOFF))
            }
        };
        let in_force = entry.not_before.filter(|until| *until > now);
        entry.not_before = match (in_force, wait.map(|wait| now + wait)) {
            (Some(held), Some(asked)) => Some(held.max(asked)),
            (held, asked) => held.or(asked),
        };
        entry.not_before
    }
}

fn ledger() -> &'static Mutex<Ledger> {
    static LEDGER: OnceLock<Mutex<Ledger>> = OnceLock::new();
    LEDGER.get_or_init(|| Mutex::new(Ledger::default()))
}

pub(crate) fn gate(url: &str) -> Result<Gate, &'static str> {
    ledger().lock().map_err(|_| "The source schedule is unavailable.")?.gate(floors(), url, Instant::now())
}

pub(crate) fn record(url: &str, outcome: Outcome) -> Option<Instant> {
    ledger().lock().ok()?.record(url, outcome, Instant::now())
}

// An Instant as milliseconds since the epoch, for the window to show.
pub(crate) fn epoch_ms(at: Instant) -> f64 {
    let now = Instant::now();
    let wall = if at >= now { SystemTime::now() + (at - now) } else { SystemTime::now() - (now - at) };
    wall.duration_since(UNIX_EPOCH).map(|since| since.as_millis() as f64).unwrap_or(0.0)
}

// Retry-After in seconds. An HTTP date is not read: the backoff stands in for
// it, which is never shorter than a minute.
pub(crate) fn retry_after(value: Option<&str>) -> Option<Duration> {
    value?.trim().parse::<u64>().ok().map(Duration::from_secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> Vec<Floor> { floors_from(EXTENSION_SOURCES, REFERENCE_SOURCES).expect("every source has a floor") }

    #[test]
    fn every_registered_source_has_a_floor() {
        let floors = table();
        assert!(floors.iter().any(|floor| floor.prefix == "https://api.pota.app/spot/activator" && floor.min == Duration::from_secs(60)));
        assert!(floors.iter().any(|floor| floor.prefix == "https://api.pota.app/location/parks/" && floor.template));
        // A FLOOR assertion (how stale an answer may be before the source is asked again), not spacing
        // (the gap between two calls in a burst): no source is asked more than once a minute, whatever
        // asks. Widening a spacing gap to 60 s from this line would be reading it wrong.
        assert!(floors.iter().all(|floor| floor.min >= Duration::from_secs(60)), "no source is asked more than once a minute");
    }

    #[test]
    fn a_source_without_a_floor_is_a_register_mistake() {
        let extension = r#"{"sources":{"x":"https://example.org/x"},"politeness":{}}"#;
        assert!(floors_from(extension, REFERENCE_SOURCES).unwrap_err().contains("extension source x"));
    }

    #[test]
    fn inside_its_floor_a_source_is_not_asked() {
        let floors = table();
        let mut ledger = Ledger::default();
        let t0 = Instant::now();
        let spots = "https://api.pota.app/spot/activator";
        assert_eq!(ledger.gate(&floors, spots, t0), Ok(Gate::Go));
        ledger.record(spots, Outcome::Answered, t0);
        // Pressed again ten seconds later: not asked, resting until a minute after the first.
        assert_eq!(ledger.gate(&floors, spots, t0 + Duration::from_secs(10)), Ok(Gate::Resting(t0 + Duration::from_secs(60))));
        assert_eq!(ledger.gate(&floors, spots, t0 + Duration::from_secs(60)), Ok(Gate::Go));
    }

    #[test]
    fn each_url_a_template_makes_has_its_own_floor() {
        let floors = table();
        let mut ledger = Ledger::default();
        let t0 = Instant::now();
        assert_eq!(ledger.gate(&floors, "https://api.pota.app/location/parks/US-WA", t0), Ok(Gate::Go));
        assert_eq!(ledger.gate(&floors, "https://api.pota.app/location/parks/US-OR", t0), Ok(Gate::Go));
        assert!(matches!(ledger.gate(&floors, "https://api.pota.app/location/parks/US-WA", t0), Ok(Gate::Resting(_))));
    }

    #[test]
    fn a_url_no_register_names_is_refused() {
        let mut ledger = Ledger::default();
        assert!(ledger.gate(&table(), "https://example.org/anything", Instant::now()).is_err());
        assert!(ledger.gate(&table(), "https://api.pota.app/location/parks/", Instant::now()).is_err(), "a template with nothing filled in");
    }

    #[test]
    fn a_429s_retry_after_is_honoured_and_capped_at_a_day() {
        let floors = table();
        let mut ledger = Ledger::default();
        let t0 = Instant::now();
        let spots = "https://api.pota.app/spot/activator";
        ledger.gate(&floors, spots, t0).unwrap();
        ledger.record(spots, Outcome::Busy(Some(Duration::from_secs(300))), t0);
        assert_eq!(ledger.gate(&floors, spots, t0 + Duration::from_secs(120)), Ok(Gate::Resting(t0 + Duration::from_secs(300))));
        assert_eq!(ledger.gate(&floors, spots, t0 + Duration::from_secs(300)), Ok(Gate::Go));
        assert_eq!(ledger.record(spots, Outcome::Busy(Some(Duration::from_secs(7 * 24 * 3600))), t0), Some(t0 + MAX_RETRY_AFTER));
    }

    #[test]
    fn failures_back_off_from_a_minute_doubling_to_an_hour() {
        let mut ledger = Ledger::default();
        let t0 = Instant::now();
        let url = "https://api.pota.app/spot/activator";
        let waits: Vec<u64> = (0..9).map(|_| (ledger.record(url, Outcome::Unreachable, t0).unwrap() - t0).as_secs()).collect();
        assert_eq!(waits, vec![60, 120, 240, 480, 960, 1920, 3600, 3600, 3600]);
        // An answer resets the count; the wait already in force stands until it ends.
        ledger.record(url, Outcome::Answered, t0);
        let later = t0 + Duration::from_secs(3601);
        assert_eq!((ledger.record(url, Outcome::Busy(None), later).unwrap() - later).as_secs(), 60, "an answer resets the backoff");
    }

    // Two requests to one source can be out at once: the request timeout (120 s) is longer than the
    // shortest floor (POTA spots, 60 s). Whichever answers last must not shorten a wait already in
    // force (found by Hopper in the MCP fleet's limiter, 2026-10-27, and present here too).
    #[test]
    fn a_later_answer_never_shortens_a_wait_in_force() {
        let mut ledger = Ledger::default();
        let t0 = Instant::now();
        let spots = "https://api.pota.app/spot/activator";
        ledger.record(spots, Outcome::Busy(Some(Duration::from_secs(300))), t0);
        let block = t0 + Duration::from_secs(300);
        // A shorter Retry-After, a backoff, and a success from the slower request: none shortens it.
        assert_eq!(ledger.record(spots, Outcome::Busy(Some(Duration::from_secs(60))), t0), Some(block));
        assert_eq!(ledger.record(spots, Outcome::Unreachable, t0), Some(block));
        assert_eq!(ledger.record(spots, Outcome::Answered, t0), Some(block));
        assert_eq!(ledger.gate(&table(), spots, t0 + Duration::from_secs(120)), Ok(Gate::Resting(block)));
        // A longer one lengthens it.
        assert_eq!(ledger.record(spots, Outcome::Busy(Some(Duration::from_secs(900))), t0), Some(t0 + Duration::from_secs(900)));
    }

    #[test]
    fn retry_after_is_read_in_seconds_only() {
        assert_eq!(retry_after(Some("120")), Some(Duration::from_secs(120)));
        assert_eq!(retry_after(Some("Wed, 21 Oct 2026 07:28:00 GMT")), None);
        assert_eq!(retry_after(None), None);
    }
}
