// SPDX-License-Identifier: GPL-3.0-or-later
// QGD-LTW-0003–0005: only this module retains inspected files and pending keys.
use qso_graph_trust::{
    certificate::Trust,
    store::{
        ImportChoices, ImportDisposition, KeyBackend, PendingDelete, PendingImport, Store,
        StoreError,
    },
};
use serde::{Deserialize, Serialize};
use std::{io::Read, path::Path};
use zeroize::Zeroizing;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Discard {},
    Inspect {
        path: String,
        format: String,
    },
    InspectDelete {
        certificate: String,
    },
    Unlock {
        token: String,
        index: u32,
        password: String,
    },
    Commit {
        token: String,
    },
    Cancel {
        token: String,
    },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub call: String,
    pub serial: String,
    pub disposition: String,
    pub reason: String,
    pub file_has_key: bool,
    pub key_present: bool,
    pub needs_password: bool,
    pub dxcc: u32,
    pub qso_first: String,
    pub qso_last: String,
    pub valid_from: String,
    pub valid_to: String,
}
#[derive(Serialize)]
pub struct Root {
    pub fingerprint: String,
}
#[derive(Serialize)]
pub struct Location {
    pub name: String,
    pub fields: Vec<Field>,
}
#[derive(Serialize)]
pub struct Field {
    pub name: String,
    pub value: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub needs_password: bool,
    pub certificates: Vec<Entry>,
    pub roots: Vec<Root>,
    pub locations: Vec<Location>,
    pub signed_qsos: u32,
    pub signed_qso_bytes: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub status: String,
    pub certificates: Vec<Entry>,
    pub roots: u32,
    pub signed_qsos: u32,
    pub deleted: u32,
}

enum Plan {
    Import(Box<PendingImport>),
    // An authenticated p12's metadata cannot be previewed before its password. Retain its bytes
    // here so the password prompt cannot cause a different file to be read.
    P12(Zeroizing<Vec<u8>>),
    Delete(Box<PendingDelete>, Vec<Entry>),
}
struct Session {
    token: String,
    store: Store,
    plan: Plan,
}
#[derive(Default)]
pub struct Manager {
    session: Option<Session>,
}

fn entries(p: &PendingImport) -> Vec<Entry> {
    p.preview()
        .certificates
        .iter()
        .map(|c| {
            let (disposition, reason) = match &c.disposition {
                ImportDisposition::New => ("new", String::new()),
                ImportDisposition::Present => ("present", String::new()),
                ImportDisposition::Refused { reason } => ("refused", reason.clone()),
            };
            Entry {
                call: c.callsign.clone(),
                serial: c.serial.iter().map(|b| format!("{b:02X}")).collect(),
                disposition: disposition.into(),
                reason,
                file_has_key: c.file_has_key,
                key_present: c.key_present,
                needs_password: c.needs_password,
                dxcc: c.dxcc,
                qso_first: c.qso_dates.map(|d| d.0.to_string()).unwrap_or_default(),
                qso_last: c.qso_dates.map(|d| d.1.to_string()).unwrap_or_default(),
                valid_from: c
                    .validity
                    .map(|d| super::lotw::timestamp(d.0))
                    .unwrap_or_default(),
                valid_to: c
                    .validity
                    .map(|d| super::lotw::timestamp(d.1))
                    .unwrap_or_default(),
            }
        })
        .collect()
}
impl Session {
    fn preview(&self) -> Preview {
        let mut preview = Preview {
            token: self.token.clone(),
            needs_password: false,
            certificates: vec![],
            roots: vec![],
            locations: vec![],
            signed_qsos: 0,
            signed_qso_bytes: 0,
        };
        match &self.plan {
            Plan::P12(_) => preview.needs_password = true,
            Plan::Delete(_, entries) => preview.certificates = entries.clone(),
            Plan::Import(p) => {
                preview.certificates = entries(p);
                preview.roots = p
                    .preview()
                    .roots
                    .iter()
                    .map(|r| Root {
                        fingerprint: r.fingerprint.clone(),
                    })
                    .collect();
                preview.locations = p
                    .preview()
                    .locations
                    .iter()
                    .map(|l| Location {
                        name: l.name.clone(),
                        fields: l
                            .station
                            .fields()
                            .map(|(n, v)| Field {
                                name: n.into(),
                                value: v.into(),
                            })
                            .collect(),
                    })
                    .collect();
                preview.signed_qsos = p.preview().signed_qsos as u32;
                preview.signed_qso_bytes = p.preview().signed_qso_bytes as u32;
            }
        }
        preview
    }
}
const REFUSED: &str =
    "The LoTW operation was refused. Nothing was imported. Inspect the file again.";
impl Manager {
    pub fn execute(&mut self, command: Command, test_dir: &Path) -> crate::CoreResult<String> {
        let dir = if std::env::var_os("QG_DESKTOP_TEST_KEYCHAIN").is_some() {
            test_dir.to_path_buf()
        } else {
            super::lotw::default_dir().ok_or(REFUSED)?
        };
        let backend = if std::env::var_os("QG_DESKTOP_TEST_KEYCHAIN").is_some() {
            KeyBackend::OsTest
        } else {
            KeyBackend::Os
        };
        self.run(command, &dir, backend, &Trust::lotw())
    }
    fn run(
        &mut self,
        command: Command,
        dir: &Path,
        backend: KeyBackend,
        trust: &Trust,
    ) -> crate::CoreResult<String> {
        match command {
            Command::Discard {} => {
                self.session = None;
                Ok("null".into())
            }
            Command::Inspect { path, format } => {
                self.session = None;
                let expected: &[&str] = match format.as_str() {
                    "certificate" => &["tq6", "p12"],
                    "backup" => &["tbk"],
                    _ => return Err(REFUSED),
                };
                let extension = Path::new(&path)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if !expected.contains(&extension.as_str()) {
                    return Err(REFUSED);
                }
                let limit = if extension == "tbk" {
                    qso_graph_trust::tbk::MAX_TBK_LEN
                } else {
                    qso_graph_trust::import::MAX_IMPORT_LEN
                };
                let mut bytes = Zeroizing::new(Vec::new());
                let file = std::fs::File::open(path).map_err(|_| REFUSED)?;
                if !file.metadata().map_err(|_| REFUSED)?.is_file() {
                    return Err(REFUSED);
                }
                file.take(limit as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| REFUSED)?;
                if bytes.len() > limit {
                    return Err(REFUSED);
                }
                let (store, _) = Store::open(dir, backend).map_err(|_| REFUSED)?;
                let plan = match extension.as_str() {
                    "tq6" => Plan::Import(Box::new(
                        store.inspect_tq6(&bytes, trust).map_err(|_| REFUSED)?,
                    )),
                    "tbk" => Plan::Import(Box::new(
                        store.inspect_tbk(&bytes, trust).map_err(|_| REFUSED)?,
                    )),
                    "p12" => match store.inspect_pkcs12(&bytes, b"", trust) {
                        Ok(pending) => Plan::Import(Box::new(pending)),
                        Err(_) => Plan::P12(bytes),
                    },
                    _ => return Err(REFUSED),
                };
                self.session = Some(Session {
                    token: crate::new_callsign_id()?,
                    store,
                    plan,
                });
                self.preview()
            }
            Command::InspectDelete { certificate } => {
                self.session = None;
                let (store, _) = Store::open(dir, backend).map_err(|_| REFUSED)?;
                let plan = inspect_delete(&store, &certificate)?;
                self.session = Some(Session {
                    token: crate::new_callsign_id()?,
                    store,
                    plan,
                });
                self.preview()
            }
            Command::Unlock {
                token,
                index,
                password,
            } => {
                let password = Zeroizing::new(password);
                // A failed password consumes the whole plan: no partial import can follow it.
                let mut session = self.take(&token)?;
                if password.len() > qso_graph_trust::import::MAX_PASSWORD_LEN {
                    return Err(REFUSED);
                }
                match &mut session.plan {
                    Plan::P12(bytes) if index == 0 => {
                        session.plan = Plan::Import(Box::new(
                            session
                                .store
                                .inspect_pkcs12(bytes, password.as_bytes(), trust)
                                .map_err(|_| REFUSED)?,
                        ));
                    }
                    Plan::Import(p) => p
                        .unlock_key(index as usize, password.as_bytes())
                        .map_err(|_| REFUSED)?,
                    _ => return Err(REFUSED),
                }
                self.session = Some(session);
                self.preview()
            }
            Command::Cancel { token } => {
                self.take(&token)?;
                Ok("null".into())
            }
            Command::Commit { token } => {
                let session = self.take(&token)?;
                let summary = commit_plan(&session.store, session.plan)?;
                serde_json::to_string(&summary).map_err(|_| REFUSED)
            }
        }
    }
    fn take(&mut self, token: &str) -> crate::CoreResult<Session> {
        if !self.session.as_ref().is_some_and(|s| s.token == token) {
            return Err(REFUSED);
        }
        self.session.take().ok_or(REFUSED)
    }
    fn preview(&self) -> crate::CoreResult<String> {
        serde_json::to_string(&self.session.as_ref().ok_or(REFUSED)?.preview()).map_err(|_| REFUSED)
    }
}

fn inspect_delete(store: &Store, certificate: &str) -> crate::CoreResult<Plan> {
    let pending = store.inspect_delete(certificate).map_err(|_| REFUSED)?;
    let public = pending.preview();
    let entry = Entry {
        call: public.callsign.clone(),
        serial: public.serial.iter().map(|b| format!("{b:02X}")).collect(),
        disposition: "delete".into(),
        reason: String::new(),
        file_has_key: false,
        key_present: public.key_present,
        needs_password: false,
        dxcc: public.dxcc,
        qso_first: public.qso_dates.0.to_string(),
        qso_last: public.qso_dates.1.to_string(),
        valid_from: super::lotw::timestamp(public.validity.0),
        valid_to: super::lotw::timestamp(public.validity.1),
    };
    Ok(Plan::Delete(Box::new(pending), vec![entry]))
}

const DELETE_CONFLICT: &str =
    "The LoTW store changed since you confirmed. Nothing was deleted. Look at the store again.";

fn commit_plan(store: &Store, plan: Plan) -> crate::CoreResult<Summary> {
    let mut summary = Summary {
        status: "completed".into(),
        certificates: vec![],
        roots: 0,
        signed_qsos: 0,
        deleted: 0,
    };
    match plan {
        Plan::Import(p) => {
            summary.certificates = entries(&p);
            let roots: Vec<String> = p
                .preview()
                .roots
                .iter()
                .map(|r| r.fingerprint.clone())
                .collect();
            let accepted: Vec<&str> = roots.iter().map(String::as_str).collect();
            let report = store
                .commit(
                    *p,
                    ImportChoices {
                        accept_roots: &accepted,
                        store_locations: false,
                        skip_refused: true,
                    },
                )
                .map_err(|_| "The LoTW outcome is unknown. Read the store before trying again.")?;
            summary.roots = report.roots.len() as u32;
            summary.signed_qsos = report.signed_qsos_added as u32;
        }
        Plan::Delete(pending, entries) => {
            store.commit_delete(*pending).map_err(|error| match error {
                StoreError::Conflict => DELETE_CONFLICT,
                _ => "The certificate could not be completely deleted. Read the LoTW store again.",
            })?;
            summary.certificates = entries;
            summary.deleted = 1;
        }
        Plan::P12(_) => return Err(REFUSED),
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lotw::tests::corpus;
    fn trust() -> Trust {
        Trust::with_roots(&[&corpus("tqsl/pki/root.pem")]).unwrap()
    }
    fn standard_trust() -> Trust {
        Trust::with_roots(&[&corpus("standard/pki/root.pem")]).unwrap()
    }
    fn run(
        m: &mut Manager,
        command: Command,
        dir: &Path,
        trust: &Trust,
    ) -> crate::CoreResult<serde_json::Value> {
        let result = m.run(command, dir, KeyBackend::Memory, trust)?;
        serde_json::from_str(&result).map_err(|_| "Invalid reply")
    }
    fn inspect(m: &mut Manager, file: &Path, dir: &Path, trust: &Trust) -> serde_json::Value {
        run(
            m,
            Command::Inspect {
                path: file.to_str().unwrap().into(),
                format: if file.extension().unwrap() == "tbk" {
                    "backup"
                } else {
                    "certificate"
                }
                .into(),
            },
            dir,
            trust,
        )
        .unwrap()
    }
    fn token(value: &serde_json::Value) -> String {
        value["token"].as_str().unwrap().into()
    }
    fn public_bytes(dir: &Path) -> Option<Vec<u8>> {
        std::fs::read(dir.join("store.xml")).ok()
    }
    fn unlock(
        m: &mut Manager,
        value: &serde_json::Value,
        dir: &Path,
        trust: &Trust,
        index: u32,
        bytes: Vec<u8>,
    ) -> crate::CoreResult<serde_json::Value> {
        run(
            m,
            Command::Unlock {
                token: token(value),
                index,
                password: String::from_utf8(bytes).unwrap(),
            },
            dir,
            trust,
        )
    }
    #[test]
    fn qgd_ltw_0004_native_commands_refuse_extra_fields_including_discard() {
        for source in [
            r#"{"op":"discard","path":"test-only"}"#,
            r#"{"op":"commit","token":"test-only","password":"test-only"}"#,
            r#"{"op":"inspect","path":"test-only","format":"backup","confirmed":true}"#,
        ] {
            assert!(serde_json::from_str::<Command>(source).is_err());
        }
        assert!(serde_json::from_str::<Command>(r#"{"op":"discard"}"#).is_ok());
    }
    #[test]
    fn qgd_ltw_0005_discard_drops_a_late_plan_without_its_token() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        let file = tmp.path().join("test-only.p12");
        std::fs::write(&file, corpus("tqsl/1024/QG0TEST.p12")).unwrap();
        let mut m = Manager::default();
        let trust = trust();
        let p = inspect(&mut m, &file, &dir, &trust);
        assert!(m.session.is_some());
        run(&mut m, Command::Discard {}, &dir, &trust).unwrap();
        assert!(m.session.is_none());
        assert!(public_bytes(&dir).is_none());
        assert!(run(&mut m, Command::Commit { token: token(&p) }, &dir, &trust).is_err());
    }
    #[test]
    fn qgd_ltw_0003_inspect_cancel_and_one_use_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        let file = tmp.path().join("test-only.tq6");
        std::fs::write(&file, corpus("tqsl/1024/QG0TEST.tq6")).unwrap();
        let mut m = Manager::default();
        let trust = trust();
        let p = inspect(&mut m, &file, &dir, &trust);
        assert!(public_bytes(&dir).is_none());
        assert_eq!(p["certificates"][0]["call"], "QG0TEST");
        run(&mut m, Command::Cancel { token: token(&p) }, &dir, &trust).unwrap();
        assert!(public_bytes(&dir).is_none());
        assert!(run(&mut m, Command::Commit { token: token(&p) }, &dir, &trust).is_err());
        let p = inspect(&mut m, &file, &dir, &trust);
        // The selected file changes after preview. Commit uses the held parsed plan only.
        std::fs::write(&file, b"planted replacement").unwrap();
        let summary = run(&mut m, Command::Commit { token: token(&p) }, &dir, &trust).unwrap();
        assert_eq!(
            summary["certificates"][0]["call"],
            p["certificates"][0]["call"]
        );
        assert_eq!(crate::lotw::certificates(Some(&dir)).unwrap().len(), 1);
        assert!(run(&mut m, Command::Commit { token: token(&p) }, &dir, &trust).is_err());
        for forbidden in [
            "password",
            "email",
            "PRIVATE KEY",
            "planted replacement",
            "test-only.tq6",
        ] {
            assert!(!summary.to_string().contains(forbidden));
        }
    }
    #[test]
    fn qgd_ltw_0005_password_protected_and_passwordless_p12() {
        let tmp = tempfile::tempdir().unwrap();
        let trust = trust();
        let file = tmp.path().join("test-only.p12");
        std::fs::write(&file, corpus("tqsl/1024-password/QG0TEST.p12")).unwrap();
        let dir = tmp.path().join("protected");
        let mut m = Manager::default();
        let p = inspect(&mut m, &file, &dir, &trust);
        assert_eq!(p["needsPassword"], true);
        assert!(unlock(&mut m, &p, &dir, &trust, 0, b"test-only-wrong".to_vec()).is_err());
        assert!(public_bytes(&dir).is_none());
        assert!(m.session.is_none());
        let p = inspect(&mut m, &file, &dir, &trust);
        let p = unlock(&mut m, &p, &dir, &trust, 0, corpus("pki/p12-password")).unwrap();
        assert_eq!(p["needsPassword"], false);
        let session = m.take(&token(&p)).unwrap();
        let summary = commit_plan(&session.store, session.plan).unwrap();
        assert_eq!(summary.certificates.len(), 1);
        let certs = session.store.certificates().unwrap();
        session.store.with_key(&certs[0].id, |_| ()).unwrap();
        // Produce an empty-password container from generated test material only. No secret is
        // placed on a command line, and every fixture stays under this temporary directory.
        let source = tmp.path().join("source.p12");
        std::fs::write(&source, corpus("tqsl/1024/QG0TEST.p12")).unwrap();
        let password = tmp.path().join("password");
        std::fs::write(&password, corpus("pki/p12-password")).unwrap();
        let pem = tmp.path().join("test-only.pem");
        let status = std::process::Command::new("openssl")
            .args(["pkcs12", "-in"])
            .arg(&source)
            .arg("-passin")
            .arg(format!("file:{}", password.display()))
            .args(["-nodes", "-out"])
            .arg(&pem)
            .output()
            .unwrap();
        assert!(status.status.success());
        let empty = tmp.path().join("empty.p12");
        let status = std::process::Command::new("openssl")
            .args(["pkcs12", "-export", "-in"])
            .arg(&pem)
            .args(["-passout", "pass:", "-out"])
            .arg(&empty)
            .output()
            .unwrap();
        assert!(status.status.success());
        let dir = tmp.path().join("empty");
        let p = inspect(&mut m, &empty, &dir, &trust);
        assert_eq!(p["needsPassword"], false);
        let summary = run(&mut m, Command::Commit { token: token(&p) }, &dir, &trust).unwrap();
        assert_eq!(summary["certificates"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn qgd_ltw_0005_tbk_independent_passwords_and_present_keys() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        let trust = standard_trust();
        let file = tmp.path().join("test-only.tbk");
        std::fs::write(&file, corpus("standard/standard.tbk")).unwrap();
        let mut m = Manager::default();
        let p = inspect(&mut m, &file, &dir, &trust);
        let locked: Vec<_> = p["certificates"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .filter(|(_, c)| c["needsPassword"] == true)
            .map(|(i, c)| {
                (
                    i as u32,
                    c["call"].as_str().unwrap().to_string(),
                    c["serial"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        assert_eq!(locked.len(), 2);
        assert_ne!(locked[0].1, locked[1].1);
        assert!(!locked[0].2.is_empty());
        let password = |call: &str| corpus(&format!("standard/keys/{call}.password"));
        let p = unlock(
            &mut m,
            &p,
            &dir,
            &trust,
            locked[0].0,
            password(&locked[0].1),
        )
        .unwrap();
        assert!(
            unlock(
                &mut m,
                &p,
                &dir,
                &trust,
                locked[1].0,
                password(&locked[0].1)
            )
            .is_err()
        );
        assert!(public_bytes(&dir).is_none());
        let mut p = inspect(&mut m, &file, &dir, &trust);
        for (i, call, _) in &locked {
            p = unlock(&mut m, &p, &dir, &trust, *i, password(call)).unwrap();
        }
        let session = m.take(&token(&p)).unwrap();
        let summary = commit_plan(&session.store, session.plan).unwrap();
        assert_eq!(summary.certificates.len(), 3);
        assert!(summary.signed_qsos > 0);
        assert!(session.store.locations().unwrap().is_empty());
        let pending = session
            .store
            .inspect_tbk(&corpus("standard/standard.tbk"), &trust)
            .unwrap();
        assert!(
            pending
                .preview()
                .certificates
                .iter()
                .all(|c| !c.needs_password && c.disposition == ImportDisposition::Present)
        );
        for c in session.store.certificates().unwrap() {
            session.store.with_key(&c.id, |_| ()).unwrap();
        }
        drop(pending);
    }
    #[test]
    fn qgd_ltw_0003_changed_store_refuses_whole_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        let trust = trust();
        let file = tmp.path().join("test-only.tq6");
        std::fs::write(&file, corpus("tqsl/1024/QG0TEST.tq6")).unwrap();
        let mut m = Manager::default();
        let p = inspect(&mut m, &file, &dir, &trust);
        let (other, _) = Store::open(&dir, KeyBackend::Memory).unwrap();
        other
            .import_tq6(&corpus("tqsl/1024/QG0TEST.tq6"), &trust, None)
            .unwrap();
        let before = public_bytes(&dir);
        assert!(run(&mut m, Command::Commit { token: token(&p) }, &dir, &trust).is_err());
        assert_eq!(public_bytes(&dir), before);
        assert!(m.session.is_none());
    }
    #[test]
    fn qgd_ltw_0002_delete_removes_certificate_and_key() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        let trust = trust();
        let file = tmp.path().join("test-only.p12");
        std::fs::write(&file, corpus("tqsl/1024/QG0TEST.p12")).unwrap();
        let mut m = Manager::default();
        let p = inspect(&mut m, &file, &dir, &trust);
        let p = unlock(&mut m, &p, &dir, &trust, 0, corpus("pki/p12-password")).unwrap();
        let session = m.take(&token(&p)).unwrap();
        commit_plan(&session.store, session.plan).unwrap();
        let certs = session.store.certificates().unwrap();
        let id = certs[0].id.clone();
        session.store.with_key(&id, |_| ()).unwrap();
        let inspected = run(
            &mut m,
            Command::InspectDelete {
                certificate: id.clone(),
            },
            &dir,
            &trust,
        )
        .unwrap();
        assert_eq!(inspected["certificates"][0]["call"], "QG0TEST");
        let before = public_bytes(&dir);
        run(
            &mut m,
            Command::Cancel {
                token: token(&inspected),
            },
            &dir,
            &trust,
        )
        .unwrap();
        assert_eq!(public_bytes(&dir), before);
        session.store.with_key(&id, |_| ()).unwrap();
        let before_delete = public_bytes(&dir).unwrap();
        let plan = inspect_delete(&session.store, &id).unwrap();
        let summary = commit_plan(&session.store, plan).unwrap();
        assert_eq!(summary.deleted, 1);
        assert!(session.store.certificates().unwrap().is_empty());
        assert!(session.store.with_key(&id, |_| ()).is_err());
        let deleted = public_bytes(&dir).unwrap();
        // Restore only the public pointer as a control: a leaked/orphaned key would still work.
        std::fs::write(dir.join("store.xml"), before_delete).unwrap();
        assert!(session.store.with_key(&id, |_| ()).is_err());
        std::fs::write(dir.join("store.xml"), deleted).unwrap();
    }
    #[test]
    fn qgd_ltw_0003_delete_refuses_key_attached_after_inspection() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        let trust = trust();
        let (store, _) = Store::open(&dir, KeyBackend::Memory).unwrap();
        let id = store
            .import_tq6(&corpus("tqsl/1024/QG0TEST.tq6"), &trust, None)
            .unwrap()[0]
            .id
            .clone();
        let mut m = Manager::default();
        let p = run(
            &mut m,
            Command::InspectDelete {
                certificate: id.clone(),
            },
            &dir,
            &trust,
        )
        .unwrap();
        assert_eq!(p["certificates"][0]["keyPresent"], false);
        // Memory backends are per Store; the other instance retains the attached key.
        let before_attach = public_bytes(&dir);
        let (other, _) = Store::open(&dir, KeyBackend::Memory).unwrap();
        other
            .import_pkcs12(
                &corpus("tqsl/1024/QG0TEST.p12"),
                &corpus("pki/p12-password"),
                &trust,
                None,
            )
            .unwrap();
        let before = public_bytes(&dir);
        assert_ne!(before, before_attach);
        assert_eq!(
            run(&mut m, Command::Commit { token: token(&p) }, &dir, &trust).err(),
            Some(DELETE_CONFLICT)
        );
        assert_eq!(public_bytes(&dir), before);
        assert_eq!(other.certificates().unwrap().len(), 1);
        other.with_key(&id, |_| ()).unwrap();
    }
    #[test]
    fn qgd_ltw_0003_delete_refuses_public_store_change() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        let trust = trust();
        let (store, _) = Store::open(&dir, KeyBackend::Memory).unwrap();
        let id = store
            .import_tq6(&corpus("tqsl/1024/QG0TEST.tq6"), &trust, None)
            .unwrap()[0]
            .id
            .clone();
        let mut m = Manager::default();
        let p = run(
            &mut m,
            Command::InspectDelete {
                certificate: id.clone(),
            },
            &dir,
            &trust,
        )
        .unwrap();
        let (other, _) = Store::open(&dir, KeyBackend::Memory).unwrap();
        let station = qso_graph_trust::station::StationLocation::new(&[
            ("CALL", "QG0TEST"),
            ("DXCC", "291"),
            ("GRIDSQUARE", "EM17"),
        ])
        .unwrap();
        other.add_location("test-only", &station).unwrap();
        let before = public_bytes(&dir);
        assert_eq!(
            run(&mut m, Command::Commit { token: token(&p) }, &dir, &trust).err(),
            Some(DELETE_CONFLICT)
        );
        assert_eq!(public_bytes(&dir), before);
        assert_eq!(other.certificates().unwrap()[0].id, id);
    }
    #[test]
    fn qgd_ltw_0003_new_roots_require_confirmed_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("store");
        let mut xml = String::from("<tqsldata><tqslcerts>");
        for (tag, name) in [
            ("rootcert", "new-root"),
            ("cacert", "new-ca"),
            ("usercert", "user-a"),
        ] {
            xml.push_str(&format!(
                "<{tag}>{}</{tag}>",
                String::from_utf8(corpus(&format!("roots/{name}.pem"))).unwrap()
            ));
        }
        xml.push_str("</tqslcerts></tqsldata>");
        let file = tmp.path().join("test-only.tq6");
        std::fs::write(&file, xml).unwrap();
        let mut m = Manager::default();
        let trust = Trust::lotw();
        let p = inspect(&mut m, &file, &dir, &trust);
        assert_eq!(p["roots"].as_array().unwrap().len(), 1);
        assert_eq!(p["roots"][0]["fingerprint"].as_str().unwrap().len(), 95);
        assert!(public_bytes(&dir).is_none());
        run(&mut m, Command::Cancel { token: token(&p) }, &dir, &trust).unwrap();
        assert!(public_bytes(&dir).is_none());
        let p = inspect(&mut m, &file, &dir, &trust);
        let result = run(&mut m, Command::Commit { token: token(&p) }, &dir, &trust).unwrap();
        assert_eq!(result["roots"], 1);
        assert_eq!(
            crate::lotw::trusted_roots(Some(&dir))
                .unwrap()
                .iter()
                .filter(|r| r.source == "tq6")
                .count(),
            2
        );
    }
}
