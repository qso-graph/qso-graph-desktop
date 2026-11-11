// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, SecondsFormat, Utc};
use napi_derive::napi;
use qso_graph_trust::store::{Listing, RootKind};
use serde::Serialize;

#[napi(object)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LotwCertificate {
    pub id: String,
    pub call: String,
    pub dxcc: u32,
    pub dxcc_name: Option<String>,
    pub qso_first: String,
    pub qso_last: String,
    pub valid_from: String,
    pub valid_to: String,
    pub serial: String,
    pub has_key: bool,
}

#[napi(object)]
pub struct LotwTrustedRoot {
    pub kind: String,
    pub subject: String,
    pub serial: String,
    pub valid_from: String,
    pub valid_to: String,
    pub fingerprint: String,
    pub source: String,
    pub accepted_at: Option<String>,
}

pub(crate) fn timestamp(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn listing(dir: Option<&Path>) -> crate::CoreResult<Listing> {
    let fallback;
    let dir = match dir {
        Some(dir) => dir,
        None => {
            // An absent default directory has the same listing as a missing store.
            fallback = loop {
                let path = std::env::temp_dir()
                    .join(format!("qg-lotw-empty-{}", crate::new_callsign_id()?));
                if !path.exists() {
                    break path;
                }
            };
            &fallback
        }
    };
    Listing::read(dir).map_err(|_| "The LoTW store could not be read.")
}

pub fn certificates(dir: Option<&Path>) -> crate::CoreResult<Vec<LotwCertificate>> {
    Ok(listing(dir)?
        .certificates()
        .iter()
        .map(|entry| {
            let cert = &entry.certificate;
            let (first, last) = cert.qso_dates();
            let (from, to) = cert.validity();
            LotwCertificate {
                id: entry.id.clone(),
                call: cert.callsign().to_owned(),
                dxcc: cert.dxcc(),
                dxcc_name: qso_graph_trust::station::dxcc_name(cert.dxcc()).map(str::to_owned),
                qso_first: first.to_string(),
                qso_last: last.to_string(),
                valid_from: timestamp(from),
                valid_to: timestamp(to),
                serial: cert
                    .serial_number()
                    .iter()
                    .map(|b| format!("{b:02X}"))
                    .collect(),
                has_key: entry.has_key,
            }
        })
        .collect())
}

pub fn trusted_roots(dir: Option<&Path>) -> crate::CoreResult<Vec<LotwTrustedRoot>> {
    Ok(listing(dir)?
        .trusted_roots()
        .iter()
        .map(|root| LotwTrustedRoot {
            kind: match root.kind {
                RootKind::Root => "root",
                RootKind::Ca => "ca",
            }
            .into(),
            subject: root.subject.clone(),
            serial: root.serial.clone(),
            valid_from: timestamp(root.not_before),
            valid_to: timestamp(root.not_after),
            fingerprint: root.fingerprint.clone(),
            source: root.source.name().into(),
            accepted_at: root
                .accepted_at
                .and_then(|secs| {
                    SystemTime::UNIX_EPOCH.checked_add(std::time::Duration::from_secs(secs))
                })
                .map(timestamp),
        })
        .collect())
}

pub fn default_dir() -> Option<PathBuf> {
    qso_graph_trust::store::default_dir()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use qso_graph_trust::{
        certificate::Trust,
        store::{KeyBackend, Store},
    };

    pub(crate) fn corpus(name: &str) -> Vec<u8> {
        // Temporary local QG Trust patch: fixtures must follow the code under test.
        // Remove with the patch when switching to v0.2.0 before commit.
        let manifest = include_str!("../Cargo.toml");
        if let Some(patch) = manifest
            .split("[patch.\"https://github.com/qso-graph/qso-graph-trust\"]")
            .nth(1)
        {
            let path = patch
                .lines()
                .find_map(|line| {
                    line.strip_prefix("qso-graph-trust = { path = \"")
                        .and_then(|s| s.split('"').next())
                })
                .expect("local QG Trust path");
            return std::fs::read(Path::new(path).join("../../tests/corpus").join(name))
                .expect("patched test corpus");
        }

        let cargo = std::env::var_os("CARGO_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var_os("HOME").expect("home")).join(".cargo")
            });
        let checkouts = cargo.join("git/checkouts");
        let repo = std::fs::read_dir(checkouts)
            .expect("checkouts")
            .map(|e| e.expect("entry").path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("qso-graph-trust-")
            })
            .expect("trust checkout");
        std::fs::read(
            repo.join(pinned_trust_commit())
                .join("tests/corpus")
                .join(name),
        )
        .expect("test corpus")
    }

    /// Cargo unpacks a git dependency under its commit's first seven characters. Read the commit
    /// QG Trust is pinned to from Cargo.lock, so the test corpus follows the pin: a name written
    /// here went stale at the next release, and passed wherever the old checkout was still cached.
    fn pinned_trust_commit() -> String {
        let lock = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.lock"),
        )
        .expect("Cargo.lock");
        let source = lock
            .lines()
            .find_map(|line| {
                line.strip_prefix("source = \"git+https://github.com/qso-graph/qso-graph-trust?")
            })
            .expect("QG Trust's source in Cargo.lock");
        let commit = source
            .split_once('#')
            .map(|(_, c)| c.trim_end_matches('"'))
            .expect("pinned commit");
        commit[..7].to_string()
    }

    fn trust() -> Trust {
        Trust::with_roots(&[&corpus("tqsl/pki/root.pem")]).expect("test root")
    }

    #[test]
    fn missing_and_empty_stores_are_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing").join("store");
        assert!(certificates(Some(&missing)).unwrap().is_empty());
        assert_eq!(trusted_roots(Some(&missing)).unwrap().len(), 4);
        assert!(!dir.path().join("missing").exists());
        assert!(certificates(Some(dir.path())).unwrap().is_empty());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        assert!(certificates(None).unwrap().is_empty());
        assert_eq!(trusted_roots(None).unwrap().len(), 4);
    }

    #[test]
    fn built_in_roots_have_the_expected_fingerprints() {
        let roots = trusted_roots(None).unwrap();
        let expected = [
            "2E:35:F9:6E:F1:86:26:DC:90:1A:2C:F3:1B:FB:56:DA:FA:DC:70:30:D7:33:D9:B3:07:D0:DB:8E:87:C7:9A:0F",
            "A6:89:D0:B4:ED:C4:F1:AF:DD:2C:62:C5:01:C8:13:6E:1F:35:4C:9D:7D:ED:06:4D:91:C9:D6:2A:F8:BD:EC:93",
            "0F:B9:62:75:EA:CA:03:EF:29:FF:50:9D:9E:54:5B:1F:38:61:F4:46:8F:06:87:BE:CC:59:3E:D0:06:04:B2:E6",
            "98:EA:7D:C6:B1:4D:8E:A6:A5:B7:26:83:0D:45:E2:B5:A5:E0:ED:5B:5D:B9:B1:26:E8:AD:13:2D:33:5D:9A:8C",
        ];
        assert_eq!(roots.len(), expected.len());
        for fp in expected {
            assert!(
                roots
                    .iter()
                    .any(|root| root.fingerprint == fp && root.source == "built in")
            );
        }
        assert_eq!(roots.iter().filter(|r| r.kind == "root").count(), 2);
        assert_eq!(roots.iter().filter(|r| r.kind == "ca").count(), 2);
    }

    #[test]
    fn accepted_roots_show_their_source() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = Store::open(dir.path(), KeyBackend::Memory).unwrap();
        let mut xml = String::from("<tqsldata><tqslcerts>");
        for (tag, name) in [
            ("rootcert", "new-root"),
            ("cacert", "new-ca"),
            ("usercert", "user-a"),
        ] {
            let pem = String::from_utf8(corpus(&format!("roots/{name}.pem"))).unwrap();
            xml.push_str(&format!("<{tag}>{pem}</{tag}>"));
        }
        xml.push_str("</tqslcerts></tqsldata>");
        let trust = Trust::lotw();
        let fingerprint = match store.import_tq6(xml.as_bytes(), &trust, None) {
            Err(qso_graph_trust::import::ImportError::UntrustedRoot { fingerprint, .. }) => {
                fingerprint
            }
            other => panic!("expected untrusted root: {other:?}"),
        };
        store
            .import_tq6(xml.as_bytes(), &trust, Some(&fingerprint))
            .unwrap();
        let roots = trusted_roots(Some(dir.path())).unwrap();
        let accepted: Vec<_> = roots.iter().filter(|r| r.source == "tq6").collect();
        assert_eq!(accepted.len(), 2);
        assert!(
            accepted
                .iter()
                .any(|r| r.kind == "root" && r.fingerprint == fingerprint)
        );
        assert!(accepted.iter().any(|r| r.kind == "ca"));
        assert!(accepted.iter().all(|r| r.accepted_at.is_some()));
    }

    #[test]
    fn invalid_store_error_does_not_include_its_path() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("store.xml"), "invalid").unwrap();
        assert_eq!(
            certificates(Some(dir.path())).err(),
            Some("The LoTW store could not be read.")
        );
        assert_eq!(
            trusted_roots(Some(dir.path())).err(),
            Some("The LoTW store could not be read.")
        );
    }

    #[test]
    fn imports_list_public_details_and_only_key_presence() {
        for keyed in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let (store, _) = Store::open(dir.path(), KeyBackend::Memory).unwrap();
            let id = if keyed {
                store
                    .import_pkcs12(
                        &corpus("tqsl/1024/QG0TEST.p12"),
                        &corpus("pki/p12-password"),
                        &trust(),
                        None,
                    )
                    .unwrap()
                    .id
            } else {
                store
                    .import_tq6(&corpus("tqsl/1024/QG0TEST.tq6"), &trust(), None)
                    .unwrap()[0]
                    .id
                    .clone()
            };
            let before = std::fs::read(dir.path().join("store.xml")).unwrap();
            let records = certificates(Some(dir.path())).unwrap();
            assert_eq!(records.len(), 1);
            let record = &records[0];
            let source = store.certificates().unwrap();
            let cert = &source[0].certificate;
            assert_eq!(record.id, id);
            assert_eq!(record.call, "QG0TEST");
            assert_eq!(record.dxcc, 291);
            assert_eq!(
                record.dxcc_name.as_deref(),
                Some("UNITED STATES OF AMERICA")
            );
            assert_eq!(
                (record.qso_first.as_str(), record.qso_last.as_str()),
                (
                    cert.qso_dates().0.to_string().as_str(),
                    cert.qso_dates().1.to_string().as_str()
                )
            );
            assert_eq!(record.valid_from, timestamp(cert.validity().0));
            assert_eq!(record.valid_to, timestamp(cert.validity().1));
            assert_eq!(
                record.serial,
                cert.serial_number()
                    .iter()
                    .map(|b| format!("{b:02X}"))
                    .collect::<String>()
            );
            assert_eq!(record.has_key, keyed);
            assert_eq!(std::fs::read(dir.path().join("store.xml")).unwrap(), before);
            let value = serde_json::to_value(record).unwrap();
            let fields = value.as_object().unwrap();
            let allowed = [
                "id",
                "call",
                "dxcc",
                "dxccName",
                "qsoFirst",
                "qsoLast",
                "validFrom",
                "validTo",
                "serial",
                "hasKey",
            ];
            let safe = |obj: &serde_json::Map<String, serde_json::Value>| {
                obj.len() == allowed.len() && obj.keys().all(|key| allowed.contains(&key.as_str()))
            };
            assert!(safe(fields));
            let mut planted = fields.clone();
            planted.insert("keyName".into(), "test-only".into());
            assert!(!safe(&planted));
        }
    }
}
