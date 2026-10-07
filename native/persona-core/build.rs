// SPDX-License-Identifier: GPL-3.0-only
fn main() {
    if std::env::var_os("CARGO_FEATURE_ADDON").is_some() {
        napi_build::setup();
    }
}
