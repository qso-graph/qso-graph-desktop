// SPDX-License-Identifier: GPL-3.0-only
// QGD-LOG-0001: the core's `tracing` output reaches the same stream as every
// other process's records.
//
// The core's exported methods are synchronous and are called from the node
// thread, so events raised while handling a command are drained by that same
// command and handed to the logger. That needs no callback across the boundary
// and no second thread, and it keeps the ordering a reader expects.
//
// QGD-LOG-0004: nothing here ever receives a secret. The core raises events
// with provider names and outcomes, never credential values, and the node side
// passes what it drains through the redacting logger regardless.
use std::io::Write;
use std::sync::{Mutex, OnceLock};
use tracing_subscriber::fmt::MakeWriter;

// Bounded, because an undrained buffer is the same unbounded growth the log
// folder's caps exist to prevent. Oldest dropped first, and the drop is
// reported rather than hidden.
const MAX_BUFFERED: usize = 1024;

static BUFFER: OnceLock<Mutex<Buffer>> = OnceLock::new();

#[derive(Default)]
struct Buffer {
    lines: Vec<String>,
    dropped: u64,
}

fn buffer() -> &'static Mutex<Buffer> {
    BUFFER.get_or_init(|| Mutex::new(Buffer::default()))
}

struct Sink;

impl Write for Sink {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if let Ok(text) = std::str::from_utf8(bytes) {
            if let Ok(mut held) = buffer().lock() {
                for line in text.split('\n').filter(|line| !line.trim().is_empty()) {
                    if held.lines.len() >= MAX_BUFFERED {
                        held.lines.remove(0);
                        held.dropped += 1;
                    }
                    held.lines.push(line.to_owned());
                }
            }
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}

struct Maker;

impl<'a> MakeWriter<'a> for Maker {
    type Writer = Sink;
    fn make_writer(&'a self) -> Self::Writer { Sink }
}

/// Installs the subscriber once. A second call is a no-op rather than an error:
/// a utility process that restarts must not fail because logging is already up.
pub fn init() {
    use tracing_subscriber::prelude::*;
    let layer = tracing_subscriber::fmt::layer()
        .json()
        .with_writer(Maker)
        .with_target(false)
        .with_current_span(false)
        .with_span_list(false);
    let _ = tracing_subscriber::registry().with(layer).try_init();
}

/// Takes everything buffered so far. The caller hands these to the logger.
pub fn drain() -> Vec<String> {
    let Ok(mut held) = buffer().lock() else { return Vec::new() };
    let dropped = std::mem::take(&mut held.dropped);
    let mut lines = std::mem::take(&mut held.lines);
    if dropped > 0 {
        // Said plainly, in the same stream, rather than leaving a silent gap.
        lines.push(format!(
            "{{\"level\":\"WARN\",\"fields\":{{\"message\":\"core log buffer overflowed\",\"dropped\":{dropped}}}}}"
        ));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    // The buffer is global by design — one core, one stream — so tests that use
    // it cannot run beside each other. The mutex protects a single operation,
    // not a test's whole sequence, and without this each test drains the
    // other's records.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn reset() {
        if let Ok(mut held) = buffer().lock() {
            held.lines.clear();
            held.dropped = 0;
        }
    }

    #[test]
    fn events_are_buffered_as_lines_and_drained_once() {
        let _serialised = TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        reset();
        init();
        tracing::info!(provider = "qrz_logbook", "credential saved");
        let first = drain();
        assert!(first.iter().any(|line| line.contains("credential saved")));
        assert!(first.iter().any(|line| line.contains("qrz_logbook")));
        // Draining takes them: a second call must not repeat what was handled.
        assert!(drain().is_empty());
    }

    #[test]
    fn the_buffer_is_bounded_and_says_what_it_dropped() {
        let _serialised = TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        reset();
        init();
        {
            let mut held = buffer().lock().unwrap();
            for index in 0..(MAX_BUFFERED + 5) {
                if held.lines.len() >= MAX_BUFFERED {
                    held.lines.remove(0);
                    held.dropped += 1;
                }
                held.lines.push(format!("line {index}"));
            }
        }
        let drained = drain();
        assert_eq!(drained.len(), MAX_BUFFERED + 1);
        assert!(drained.last().unwrap().contains("core log buffer overflowed"));
        assert!(drained.last().unwrap().contains("\"dropped\":5"));
    }
}
