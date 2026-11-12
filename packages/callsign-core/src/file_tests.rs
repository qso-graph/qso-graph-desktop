// SPDX-License-Identifier: GPL-3.0-or-later
// Unix special-file regressions run in children so a blocking open fails instead of hanging cargo.
use std::{
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub fn rejects_special_files(test: &str, extension: &str, probe: impl FnOnce(&Path)) {
    if let Some(path) = std::env::var_os("QG_TEST_READER_INPUT") {
        let path = Path::new(&path);
        if path.extension().is_some_and(|ext| ext == extension) {
            probe(path);
            println!("qg-test-reader-completed: {test}");
        }
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(format!("qg-test-reader.{extension}"));
    for kind in ["regular", "fifo", "directory"] {
        match kind {
            "regular" => std::fs::write(&path, b"malformed synthetic input").unwrap(),
            "fifo" => assert!(
                Command::new("mkfifo")
                    .arg(&path)
                    .status()
                    .unwrap()
                    .success()
            ),
            _ => std::fs::create_dir(&path).unwrap(),
        }
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", test, "--nocapture"])
            .env("QG_TEST_READER_INPUT", &path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let started = Instant::now();
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                let output = child.wait_with_output().unwrap();
                assert!(
                    status.success(),
                    "{test}: {kind} control failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
                assert!(
                    String::from_utf8_lossy(&output.stdout)
                        .contains(&format!("qg-test-reader-completed: {test}")),
                    "{test}: {kind} did not run its reader probe"
                );
                break;
            }
            if started.elapsed() > Duration::from_secs(2) {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("{test}: {kind} blocked for two seconds");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if kind == "directory" {
            std::fs::remove_dir(&path).unwrap();
        } else {
            std::fs::remove_file(&path).unwrap();
        }
    }
}
