// SPDX-License-Identifier: GPL-3.0-only
fn main() {
    if std::env::var_os("CARGO_FEATURE_ADDON").is_some() {
        napi_build::setup();
    }
    // The application's own version, from package.json, for the user agent a
    // service sees (#129): QRZ asks every client to say truthfully what it is.
    println!("cargo:rerun-if-changed=../../package.json");
    let manifest = std::fs::read_to_string("../../package.json").expect("package.json");
    let version = manifest
        .lines()
        .find_map(|line| line.trim().strip_prefix("\"version\": \""))
        .and_then(|rest| rest.split('"').next())
        .expect("package.json names a version");
    assert!(
        !version.is_empty() && version.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+')),
        "package.json's version is not a version: {version}"
    );
    println!("cargo:rustc-env=QGD_VERSION={version}");
}
