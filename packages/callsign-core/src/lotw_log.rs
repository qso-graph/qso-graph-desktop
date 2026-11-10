// SPDX-License-Identifier: GPL-3.0-or-later
// QGD-LTW-0003–0005, 0008, 0013: inspected bytes and one-use plans stay in Rust.
use qso_graph_trust::{
    certificate::Certificate,
    options::{QthHandling, SigningOptions},
    qso::{Date, Qso, QsoError},
    records::{self, Record},
    signed_log::LogError,
    station::{StationError, StationLocation},
    store::{DuplicateChoice, KeyBackend, SigningPlan, Store},
    upload::{self, UploadOutcome, UploadRequest},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Read, path::Path, time::SystemTime};
use zeroize::Zeroizing;
const REFUSED: &str =
    "The log could not be prepared or signed. Inspect it again. No upload was made.";
const LIMIT: usize = 64 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    LogPrepare { path: String },
    LogPreview { token: String, selection: Selection },
    LogSign { token: String, path: String },
    UploadInspect { path: String },
    UploadSend { token: String },
    LogCancel { token: String },
    LogDiscard {},
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub call: String,
    pub place: BTreeMap<String, String>,
    pub park: String,
    pub certificate: String,
    pub from: String,
    pub to: String,
    pub sign_again: bool,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Refusal {
    pub record: usize,
    pub line: Option<usize>,
    pub field: String,
    pub reason: String,
}
#[derive(Serialize, Clone)]
pub struct Cert {
    pub id: String,
    pub call: String,
    pub serial: String,
    #[serde(rename = "qsoFirst")]
    pub qso_first: String,
    #[serde(rename = "qsoLast")]
    pub qso_last: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub qsos: usize,
    pub first: String,
    pub last: String,
    pub calls: Vec<String>,
    pub refused: Vec<Refusal>,
    pub outside_dates: usize,
    pub already_signed: usize,
    pub to_sign: usize,
    pub sign_again_count: usize,
    pub fields: BTreeMap<String, String>,
    pub certificates: Vec<Cert>,
    pub certificate: Option<Cert>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub signed: usize,
    pub outside_dates: usize,
    pub already_signed: usize,
    pub sign_again_count: usize,
    pub refused: Vec<Refusal>,
}
struct Prepared {
    records: Vec<Record>,
    preview: Preview,
    plan: Option<SigningPlan>,
    selection: Option<Selection>,
    store: Option<Store>,
}
struct Upload {
    bytes: Zeroizing<Vec<u8>>,
    name: String,
    preview: Preview,
}
enum Pending {
    Sign(Box<Prepared>),
    Upload(Box<Upload>),
}
struct Session {
    token: String,
    pending: Pending,
}
#[derive(Default)]
pub struct Manager {
    session: Option<Session>,
}
fn json(value: &impl Serialize) -> crate::CoreResult<String> {
    serde_json::to_string(value).map_err(|_| REFUSED)
}
fn read(path: &Path, extensions: &[&str]) -> crate::CoreResult<Zeroizing<Vec<u8>>> {
    if !path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| extensions.iter().any(|e| s.eq_ignore_ascii_case(e)))
    {
        return Err(REFUSED);
    }
    let file = std::fs::File::open(path).map_err(|_| REFUSED)?;
    if !file.metadata().map_err(|_| REFUSED)?.is_file() {
        return Err(REFUSED);
    }
    let mut bytes = Zeroizing::new(Vec::new());
    file.take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| REFUSED)?;
    if bytes.len() > LIMIT {
        return Err(REFUSED);
    }
    Ok(bytes)
}
fn empty(token: &str) -> Preview {
    Preview {
        token: token.into(),
        qsos: 0,
        first: String::new(),
        last: String::new(),
        calls: vec![],
        refused: vec![],
        outside_dates: 0,
        already_signed: 0,
        to_sign: 0,
        sign_again_count: 0,
        fields: BTreeMap::new(),
        certificates: vec![],
        certificate: None,
    }
}
fn range(p: &mut Preview, q: &Qso) {
    let date = q.date().to_string();
    if p.first.is_empty() || date < p.first {
        p.first = date.clone();
    }
    if p.last.is_empty() || date > p.last {
        p.last = date;
    }
}
fn failure(index: usize, r: &Record, field: &str, reason: &str) -> Refusal {
    Refusal {
        record: index + 1,
        line: r.source_line(),
        field: field.into(),
        reason: reason.into(),
    }
}
fn invalid(index: usize, r: &Record, e: QsoError) -> Refusal {
    let (field, reason) = match e {
        QsoError::Missing(f) => (f, "Required field is missing."),
        QsoError::Repeated(f) => (f, "Field occurs more than once."),
        QsoError::Invalid { field, .. } => (field, "Value is not accepted by LoTW."),
        QsoError::TooManyFields => ("", "Too many fields."),
        QsoError::SatelliteNotNamed | QsoError::SatelliteWithoutSat => {
            ("SAT_NAME", "Satellite name and propagation mode disagree.")
        }
    };
    failure(index, r, field, reason)
}
// Fixed policy; there is no caller-selected QTH handling.
fn options() -> SigningOptions {
    SigningOptions {
        qth: QthHandling::Refuse,
        ..SigningOptions::default()
    }
}
// Only field names are exposed; QG Trust errors can also contain input values.
fn location_error(error: StationError) -> &'static str {
    let field = match &error {
        StationError::Missing(field) | StationError::Invalid { field, .. } => *field,
        StationError::Repeated(field) | StationError::NotAField(field) => field.as_str(),
        StationError::TooManyFields => {
            return "The Location has too many fields. Check the Location.";
        }
    };
    match field {
        "CALL" => "Check the callsign selected for this Location.",
        "DXCC" | "MY_DXCC" => "Check the Location's DXCC entity before signing.",
        "GRIDSQUARE" | "MY_GRIDSQUARE" | "MY_VUCC_GRIDS" => {
            "Check the Location's grid squares before signing."
        }
        "US_STATE" | "CA_PROVINCE" | "RU_OBLAST" | "CN_PROVINCE" | "AU_STATE" | "JA_PREFECTURE"
        | "FI_KUNTA" | "MY_STATE" => {
            "Check the Location's state, province or prefecture before signing."
        }
        "US_COUNTY" | "JA_CITY_GUN_KU" | "MY_CNTY" => "Check the Location's county before signing.",
        "CQZ" | "MY_CQ_ZONE" => "Check the Location's CQ zone before signing.",
        "ITUZ" | "MY_ITU_ZONE" => "Check the Location's ITU zone before signing.",
        "IOTA" | "MY_IOTA" => "Check the Location's IOTA reference before signing.",
        "US_PARK" | "CA_US_PARK" | "DX_US_PARK" => "Check the Location's LoTW park before signing.",
        "MY_ALTITUDE" => {
            "The Location's altitude field is not accepted for LoTW signing. Check the Location."
        }
        "MY_ARRL_SECT" => {
            "The Location's ARRL section field is not accepted for LoTW signing. Check the Location."
        }
        "MY_POTA_REF" => {
            "The Location's POTA reference field is not accepted for LoTW signing. Check the Location."
        }
        "MY_SOTA_REF" => {
            "The Location's SOTA reference field is not accepted for LoTW signing. Check the Location."
        }
        "MY_WWFF_REF" => {
            "The Location's WWFF reference field is not accepted for LoTW signing. Check the Location."
        }
        _ => "The Location has a field LoTW does not accept. Check the Location's fields.",
    }
}
fn public_cert(id: &str, cert: &Certificate) -> Cert {
    Cert {
        id: id.into(),
        call: cert.callsign().into(),
        qso_first: cert.qso_dates().0.to_string(),
        qso_last: cert.qso_dates().1.to_string(),
        serial: cert
            .serial_number()
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect(),
    }
}
impl Manager {
    pub fn execute(&mut self, command: Command, test_dir: &Path) -> crate::CoreResult<String> {
        let test = std::env::var_os("QG_DESKTOP_TEST_KEYCHAIN").is_some();
        let dir = if test {
            test_dir.to_path_buf()
        } else {
            super::lotw::default_dir().ok_or(REFUSED)?
        };
        let backend = if test {
            KeyBackend::OsTest
        } else {
            KeyBackend::Os
        };
        self.run(command, &dir, backend, &mut |request| {
            // Also blocks an accidental invocation from any Desktop test process.
            if cfg!(test) || test {
                return Err(());
            }
            super::validation::send_lotw(request)
        })
    }
    fn take(&mut self, token: &str) -> crate::CoreResult<Session> {
        if !self.session.as_ref().is_some_and(|s| s.token == token) {
            return Err(REFUSED);
        }
        self.session.take().ok_or(REFUSED)
    }
    fn run(
        &mut self,
        command: Command,
        dir: &Path,
        backend: KeyBackend,
        send: &mut impl FnMut(&UploadRequest) -> Result<(u16, Vec<u8>), ()>,
    ) -> crate::CoreResult<String> {
        match command {
            Command::LogDiscard {} => {
                self.session = None;
                Ok("null".into())
            }
            Command::LogCancel { token } => {
                self.take(&token)?;
                Ok("null".into())
            }
            Command::LogPrepare { path } => {
                self.session = None;
                let bytes = read(Path::new(&path), &["adi", "adx", "log"])?;
                let records = records::parse(&bytes).map_err(
                    |_| "The log format is invalid. Check its fields and record endings.",
                )?;
                if records.is_empty() {
                    return Err("The log contains no QSOs.");
                }
                let token = crate::new_callsign_id()?;
                let mut preview = empty(&token);
                preview.qsos = records.len();
                for (index, r) in records.iter().enumerate() {
                    match Qso::from_adif_with_options(r, &options()) {
                        Ok(q) => {
                            range(&mut preview, &q);
                            for (field, value) in q.station() {
                                if field == "STATION_CALLSIGN"
                                    && !preview.calls.iter().any(|c| c == value)
                                {
                                    preview.calls.push(value.into());
                                }
                            }
                        }
                        Err(e) => preview.refused.push(invalid(index, r, e)),
                    }
                }
                preview.to_sign = records.len() - preview.refused.len();
                let result = json(&preview)?;
                self.session = Some(Session {
                    token,
                    pending: Pending::Sign(Box::new(Prepared {
                        records,
                        preview,
                        plan: None,
                        selection: None,
                        store: None,
                    })),
                });
                Ok(result)
            }
            Command::LogPreview { token, selection } => {
                let mut session = self.take(&token)?;
                let result = (|| -> crate::CoreResult<String> {
                    let Pending::Sign(p) = &mut session.pending else {
                        return Err(REFUSED);
                    };
                    // QG Trust owns the conversion from Desktop's ADIF Location fields.
                    let station = StationLocation::from_adif(
                        &selection.call,
                        &selection
                            .place
                            .iter()
                            .map(|(n, v)| (n.as_str(), v.as_str()))
                            .collect::<Vec<_>>(),
                        Some(&selection.park),
                    )
                    .map_err(location_error)?;
                    let from = if selection.from.is_empty() {
                        None
                    } else {
                        Some(Date::from_iso(&selection.from).ok_or(REFUSED)?)
                    };
                    let to = if selection.to.is_empty() {
                        None
                    } else {
                        Some(Date::from_iso(&selection.to).ok_or(REFUSED)?)
                    };
                    if from.zip(to).is_some_and(|(f, t)| f > t) {
                        return Err(REFUSED);
                    }
                    if p.store.is_none() {
                        p.store = Some(Store::open(dir, backend).map_err(|_| REFUSED)?.0);
                    }
                    let store = p.store.as_ref().ok_or(REFUSED)?;
                    let mut preview = empty(&token);
                    preview.qsos = p.records.len();
                    preview.calls = p.preview.calls.clone();
                    preview.fields = station
                        .fields()
                        .map(|(n, v)| (n.into(), v.into()))
                        .collect();
                    let mut valid = Vec::new();
                    for (i, r) in p.records.iter().enumerate() {
                        match Qso::from_adif_with_options(r, &options()) {
                            Err(e) => preview.refused.push(invalid(i, r, e)),
                            Ok(q) => {
                                if from.is_some_and(|f| q.date() < f)
                                    || to.is_some_and(|t| q.date() > t)
                                {
                                    preview.outside_dates += 1;
                                    continue;
                                }
                                valid.push((i, q));
                            }
                        }
                    }
                    let certificates = store.certificates().map_err(|_| REFUSED)?;
                    for c in &certificates {
                        let cert = &c.certificate;
                        let (first, last) = cert.qso_dates();
                        if c.key_name.is_some()
                            && cert.is_valid_at(SystemTime::now())
                            && cert.callsign() == station.call()
                            && cert.dxcc() == station.dxcc()
                            && valid
                                .iter()
                                .any(|(_, q)| q.date() >= first && q.date() <= last)
                        {
                            preview.certificates.push(public_cert(&c.id, cert));
                        }
                    }
                    let selected = if preview.certificates.len() == 1 {
                        preview.certificates.first()
                    } else {
                        preview
                            .certificates
                            .iter()
                            .find(|c| c.id == selection.certificate)
                    };
                    let chosen = selected.cloned();
                    if let Some(chosen) = &chosen {
                        let cert = &certificates
                            .iter()
                            .find(|c| c.id == chosen.id)
                            .ok_or(REFUSED)?
                            .certificate;
                        let (first, last) = cert.qso_dates();
                        valid.retain(|(i, q)| {
                            if q.date() < first || q.date() > last {
                                preview.refused.push(failure(
                                    *i,
                                    &p.records[*i],
                                    "QSO_DATE",
                                    "Outside the certificate's QSO dates.",
                                ));
                                false
                            } else {
                                true
                            }
                        });
                    }
                    let (indices, qsos): (Vec<_>, Vec<_>) = valid.into_iter().unzip();
                    let refusals = options().station_refusals(&qsos, &station);
                    let mut excluded = vec![false; qsos.len()];
                    for (index, error) in refusals {
                        let LogError::QsoFromAnotherStation { field, .. } = error else {
                            return Err(REFUSED);
                        };
                        let original = indices[index];
                        preview.refused.push(failure(
                            original,
                            &p.records[original],
                            field,
                            "Disagrees with the selected Location or callsign, or an earlier QSO.",
                        ));
                        excluded[index] = true;
                    }
                    // Preserve QG Trust's order and pass this same list into its retained signing plan.
                    let qsos = qsos
                        .into_iter()
                        .enumerate()
                        .filter_map(|(i, q)| (!excluded[i]).then_some(q))
                        .collect::<Vec<_>>();
                    for q in &qsos {
                        range(&mut preview, q);
                    }
                    preview.refused.sort_by_key(|r| r.record);
                    let mut plan = None;
                    if let Some(chosen) = chosen.filter(|_| !qsos.is_empty()) {
                        let prepared = store
                            .prepare_signing_with_options(&qsos, &station, &options())
                            .map_err(|_| REFUSED)?;
                        preview.already_signed = prepared.signed_before().len();
                        preview.sign_again_count = if selection.sign_again {
                            preview.already_signed
                        } else {
                            0
                        };
                        preview.to_sign = prepared.new_indices().len() + preview.sign_again_count;
                        preview.certificate = Some(chosen.clone());
                        plan = Some(prepared);
                    }
                    p.preview = preview;
                    p.plan = plan;
                    p.selection = Some(selection);
                    json(&p.preview)
                })();
                self.session = Some(session);
                result
            }
            Command::LogSign { token, path } => {
                // Consumed before even checking the output path or touching the key.
                let session = self.take(&token)?;
                let Pending::Sign(p) = session.pending else {
                    return Err(REFUSED);
                };
                if !Path::new(&path)
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("tq8"))
                {
                    return Err(REFUSED);
                }
                let choice = if p.selection.as_ref().ok_or(REFUSED)?.sign_again {
                    DuplicateChoice::SignAgain
                } else {
                    DuplicateChoice::NewOnly
                };
                let selected = p.plan.ok_or(REFUSED)?.choose(choice).ok_or(REFUSED)?;
                let cert = p.preview.certificate.as_ref().ok_or(REFUSED)?;
                let store = p.store.ok_or(REFUSED)?;
                let current = store.certificates().map_err(|_| REFUSED)?;
                let certificate = &current
                    .iter()
                    .find(|c| c.id == cert.id)
                    .ok_or(REFUSED)?
                    .certificate;
                if public_cert(&cert.id, certificate).serial != cert.serial {
                    return Err(REFUSED);
                }
                let signed = store
                    .with_key(&cert.id, |key| {
                        selected.sign(certificate, key, SystemTime::now())
                    })
                    .map_err(|_| REFUSED)?
                    .map_err(|_| REFUSED)?;
                signed.write_to(&store,Path::new(&path)).map_err(|_| "The signed log could not be saved or its signed-QSO record updated. Check the output file before signing again.")?;
                json(&Outcome {
                    signed: p.preview.to_sign,
                    outside_dates: p.preview.outside_dates,
                    already_signed: p.preview.already_signed - p.preview.sign_again_count,
                    sign_again_count: p.preview.sign_again_count,
                    refused: p.preview.refused,
                })
            }
            Command::UploadInspect { path } => {
                self.session = None;
                let bytes = read(Path::new(&path), &["tq8"])?;
                let checked = Zeroizing::new(
                    upload::check_signed_log(&bytes)
                        .map_err(|_| "This file is not a signed LoTW log.")?,
                );
                let token = crate::new_callsign_id()?;
                let preview = inspect_tq8(&checked, &token)?;
                let result = json(&preview)?;
                self.session = Some(Session {
                    token,
                    pending: Pending::Upload(Box::new(Upload {
                        bytes: checked,
                        name: Path::new(&path)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("log.tq8")
                            .into(),
                        preview,
                    })),
                });
                Ok(result)
            }
            Command::UploadSend { token } => {
                let session = self.take(&token)?;
                let Pending::Upload(p) = session.pending else {
                    return Err(REFUSED);
                };
                let request = UploadRequest::try_named(&p.bytes, &p.name).map_err(|_| REFUSED)?;
                let answer = match send(&request) {
                    Err(()) => {
                        "The connection failed. LoTW may have received the log. Check LoTW before trying again."
                    }
                    Ok((status, body)) => match upload::parse_response(status, &body) {
                        UploadOutcome::Accepted { .. } => {
                            "LoTW accepted the signed log for processing. This does not confirm the QSOs."
                        }
                        UploadOutcome::Rejected { .. } => {
                            "LoTW refused the signed log. Check the certificate and log before trying again."
                        }
                        UploadOutcome::Unknown => {
                            "LoTW's answer was not recognized. Check LoTW before trying again."
                        }
                    },
                };
                let _ = p.preview;
                json(&answer)
            }
        }
    }
}
// The library validates and sanitizes first. Its bounded gzip reader and record parser then
// expose only public certificate metadata and counts; no input bytes leave this module.
fn inspect_tq8(bytes: &[u8], token: &str) -> crate::CoreResult<Preview> {
    let tq7 = Zeroizing::new(qso_graph_trust::gzip::decompress(bytes, LIMIT).map_err(|_| REFUSED)?);
    let records = records::parse(&tq7).map_err(|_| REFUSED)?;
    let mut p = empty(token);
    for r in records {
        match r.text("Rec_Type") {
            Some("tCERT") => {
                let b64 = r.text("CERTIFICATE").ok_or(REFUSED)?;
                let pem = format!(
                    "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
                    b64.trim()
                );
                let cert = Certificate::from_pem_or_der(pem.as_bytes()).map_err(|_| REFUSED)?;
                p.certificates.push(public_cert("", &cert));
            }
            Some("tCONTACT") => {
                let date = Date::from_iso(r.text("QSO_DATE").ok_or(REFUSED)?)
                    .ok_or(REFUSED)?
                    .to_string();
                if p.first.is_empty() || date < p.first {
                    p.first = date.clone();
                }
                if p.last.is_empty() || date > p.last {
                    p.last = date;
                }
                p.qsos += 1;
            }
            _ => {}
        }
    }
    if p.certificates.is_empty() || p.qsos == 0 {
        return Err(REFUSED);
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lotw::tests::corpus;
    use qso_graph_trust::certificate::Trust;
    fn decode_base64(text: &str) -> Vec<u8> {
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let (mut accumulator, mut bits) = (0u32, 0u32);
        let mut decoded = Vec::new();
        for byte in text
            .bytes()
            .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        {
            let value = alphabet.iter().position(|b| *b == byte).expect("base64") as u32;
            accumulator = (accumulator << 6) | value;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                decoded.push((accumulator >> bits) as u8);
                accumulator &= (1 << bits) - 1;
            }
        }
        decoded
    }
    fn verify_output(bytes: &[u8]) {
        use aws_lc_rs::signature::{
            RSA_PKCS1_1024_8192_SHA1_FOR_LEGACY_USE_ONLY, UnparsedPublicKey,
        };
        let tq7 = qso_graph_trust::gzip::decompress(bytes, LIMIT).unwrap();
        let records = records::parse(&tq7).unwrap();
        let b64 = records.iter().find_map(|r| r.text("CERTIFICATE")).unwrap();
        let cert = Certificate::from_pem_or_der(&decode_base64(b64)).unwrap();
        let key = UnparsedPublicKey::new(
            &RSA_PKCS1_1024_8192_SHA1_FOR_LEGACY_USE_ONLY,
            cert.public_key_der(),
        );
        let mut checked = 0;
        for r in &records {
            if let Some(data) = r.get("SIGNDATA") {
                let mut signature = decode_base64(r.text("SIGN_LOTW_V2.0").unwrap());
                assert!(key.verify(data, &signature).is_ok());
                signature[0] ^= 1;
                assert!(key.verify(data, &signature).is_err());
                checked += 1;
            }
        }
        assert!(checked > 0);
    }
    fn run(m: &mut Manager, c: Command, dir: &Path) -> serde_json::Value {
        serde_json::from_str(
            &m.run(c, dir, KeyBackend::Memory, &mut |_| {
                panic!("test reached a production transport")
            })
            .unwrap(),
        )
        .unwrap()
    }
    fn token(p: &serde_json::Value) -> String {
        p["token"].as_str().unwrap().into()
    }
    fn selection() -> Selection {
        Selection {
            call: "QG0TEST".into(),
            place: BTreeMap::from([
                ("MY_DXCC".into(), "291".into()),
                ("MY_STATE".into(), "ID".into()),
                ("MY_GRIDSQUARE".into(), "DN13tp".into()),
            ]),
            park: String::new(),
            certificate: String::new(),
            from: String::new(),
            to: String::new(),
            sign_again: false,
        }
    }
    fn fixture_log(bytes: &[u8]) -> (tempfile::TempDir, Manager, String) {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = Store::open(dir.path().join("store"), KeyBackend::Memory).unwrap();
        let trust = Trust::with_roots(&[&corpus("tqsl/pki/root.pem")]).unwrap();
        store
            .import_pkcs12(
                &corpus("tqsl/1024/QG0TEST.p12"),
                &corpus("pki/p12-password"),
                &trust,
                None,
            )
            .unwrap();
        let log = dir.path().join("qg-test-log.adi");
        std::fs::write(&log, bytes).unwrap();
        let mut m = Manager::default();
        let p = run(
            &mut m,
            Command::LogPrepare {
                path: log.to_str().unwrap().into(),
            },
            dir.path(),
        );
        let Pending::Sign(prepared) = &mut m.session.as_mut().unwrap().pending else {
            panic!()
        };
        prepared.store = Some(store);
        (dir, m, token(&p))
    }
    fn fixture() -> (tempfile::TempDir, Manager, String) {
        fixture_log(b"<CALL:6>Z0TEST<QSO_DATE:8>20261101<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<STATION_CALLSIGN:7>QG0TEST<MY_STATE:2>ID<eor>\n<CALL:6>Z0TEST<QSO_DATE:8>20261102<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<STATION_CALLSIGN:7>QG0TEST<MY_STATE:2>WA<eor>")
    }
    fn adif(date: &str, fields: &str) -> String {
        format!(
            "<CALL:6>Z0TEST<QSO_DATE:8>{date}<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW{fields}<eor>\n"
        )
    }
    fn sign_and_check(
        dir: &Path,
        manager: &mut Manager,
        token: String,
        preview: &serde_json::Value,
    ) -> Vec<Record> {
        let output = dir.join("checked.tq8");
        let result = run(
            manager,
            Command::LogSign {
                token,
                path: output.to_str().unwrap().into(),
            },
            dir,
        );
        assert_eq!(result["signed"], preview["toSign"]);
        assert_eq!(result["refused"], preview["refused"]);
        assert_eq!(result["outsideDates"], preview["outsideDates"]);
        let bytes = std::fs::read(output).unwrap();
        verify_output(&bytes);
        assert_eq!(
            inspect_tq8(&bytes, "test-token").unwrap().qsos,
            result["signed"].as_u64().unwrap() as usize
        );
        records::parse(&qso_graph_trust::gzip::decompress(&bytes, LIMIT).unwrap()).unwrap()
    }
    #[test]
    fn ordinary_my_rig_and_antenna_fields_sign_in_adif_and_adx() {
        for bytes in [
            adif("20261101", "<MY_RIG:7>test rig<MY_ANTENNA:7>test ant<MY_NAME:4>test").into_bytes(),
            b"<ADX><HEADER/><RECORDS><RECORD><CALL>Z0TEST</CALL><QSO_DATE>20261101</QSO_DATE><TIME_ON>120000</TIME_ON><BAND>20m</BAND><MODE>CW</MODE><MY_RIG>test rig</MY_RIG><MY_ANTENNA>test ant</MY_ANTENNA><MY_NAME>test</MY_NAME></RECORD></RECORDS></ADX>".to_vec(),
        ] {
            let (dir, mut m, t) = fixture_log(&bytes);
            let preview = run(&mut m, Command::LogPreview { token: t.clone(), selection: selection() }, dir.path());
            assert_eq!(preview["toSign"], 1);
            assert_eq!(preview["refused"], serde_json::json!([]));
            sign_and_check(dir.path(), &mut m, t, &preview);
        }
    }
    #[test]
    fn carry_forward_refuses_conflicts_and_preview_matches_signed_list() {
        // A conversion refusal also proves QG Trust indices map back to original records.
        let log = [
            "<QSO_DATE:8>20261101<eor>\n".into(),
            adif("20261101", "<MY_STATE:2>ID"),
            adif("20261102", "<MY_STATE:2>WA"),
            adif("20261103", "<MY_STATE:2>ID"),
        ]
        .concat();
        let (dir, mut m, t) = fixture_log(log.as_bytes());
        let mut selected = selection();
        selected.place.remove("MY_STATE");
        let preview = run(
            &mut m,
            Command::LogPreview {
                token: t.clone(),
                selection: selected,
            },
            dir.path(),
        );
        assert_eq!(preview["qsos"], 4);
        assert_eq!(preview["toSign"], 2);
        assert_eq!(preview["outsideDates"], 0);
        assert_eq!(preview["refused"].as_array().unwrap().len(), 2);
        assert_eq!(preview["refused"][0]["record"], 1);
        assert_eq!(preview["refused"][1]["record"], 3);
        assert_eq!(preview["refused"][1]["field"], "MY_STATE");
        let records = sign_and_check(dir.path(), &mut m, t, &preview);
        let contacts = records
            .iter()
            .filter(|r| r.text("Rec_Type") == Some("tCONTACT"))
            .collect::<Vec<_>>();
        assert_eq!(
            contacts
                .iter()
                .map(|r| r.text("QSO_DATE").unwrap())
                .collect::<Vec<_>>(),
            ["2026-11-01", "2026-11-03"]
        );
        assert!(records.iter().any(|r| r.text("US_STATE") == Some("ID")));
    }
    #[test]
    fn all_station_refusals_still_produce_a_preview() {
        let (dir, mut m, t) = fixture_log(adif("20261101", "<MY_STATE:2>WA").as_bytes());
        let preview = run(
            &mut m,
            Command::LogPreview {
                token: t,
                selection: selection(),
            },
            dir.path(),
        );
        assert_eq!(preview["toSign"], 0);
        assert_eq!(preview["refused"].as_array().unwrap().len(), 1);
        assert_eq!(preview["refused"][0]["field"], "MY_STATE");
    }
    #[test]
    fn station_refusal_preserves_the_cabrillo_record_and_line() {
        let (dir, mut m, t) = fixture_log(&corpus("cabrillo/synthetic-03.log"));
        let mut selected = selection();
        selected.call = "QG1TEST".into();
        let preview = run(
            &mut m,
            Command::LogPreview {
                token: t,
                selection: selected,
            },
            dir.path(),
        );
        assert_eq!(preview["refused"][0]["record"], 1);
        assert_eq!(preview["refused"][0]["line"], 4);
        assert_eq!(preview["refused"][0]["field"], "STATION_CALLSIGN");
    }
    #[test]
    fn outside_dates_are_not_refused_or_used_for_carry_forward() {
        let log = [
            adif("20261101", "<MY_STATE:2>WA"),
            adif("20261102", "<MY_STATE:2>ID"),
            adif("20261103", "<MY_STATE:2>WA"),
        ]
        .concat();
        let (dir, mut m, t) = fixture_log(log.as_bytes());
        let mut selected = selection();
        selected.place.remove("MY_STATE");
        selected.from = "2026-11-02".into();
        selected.to = "2026-11-02".into();
        let preview = run(
            &mut m,
            Command::LogPreview {
                token: t.clone(),
                selection: selected,
            },
            dir.path(),
        );
        assert_eq!(preview["qsos"], 3);
        assert_eq!(preview["toSign"], 1);
        assert_eq!(preview["outsideDates"], 2);
        assert_eq!(preview["refused"], serde_json::json!([]));
        sign_and_check(dir.path(), &mut m, t, &preview);
    }
    #[test]
    fn prepare_refuse_sign_verify_and_consume_without_key_in_replies() {
        let (dir, mut m, t) = fixture();
        assert!(!dir.path().join("output.tq8").exists());
        let p = run(
            &mut m,
            Command::LogPreview {
                token: t.clone(),
                selection: selection(),
            },
            dir.path(),
        );
        assert_eq!(p["toSign"], 1);
        assert_eq!(p["refused"][0]["field"], "MY_STATE");
        assert_eq!(p["refused"][0]["record"], 2);
        assert_eq!(p["fields"]["US_STATE"], "ID");
        assert_eq!(p["fields"]["CALL"], "QG0TEST");
        let output = dir.path().join("output.tq8");
        let result = run(
            &mut m,
            Command::LogSign {
                token: t.clone(),
                path: output.to_str().unwrap().into(),
            },
            dir.path(),
        );
        assert_eq!(result["signed"], 1);
        let bytes = std::fs::read(output).unwrap();
        assert!(upload::check_signed_log(&bytes).is_ok());
        verify_output(&bytes);
        let info = inspect_tq8(&bytes, "test-token").unwrap();
        assert_eq!(info.qsos, 1);
        assert_eq!(info.certificates[0].call, "QG0TEST");
        assert!(
            m.run(
                Command::LogSign {
                    token: t,
                    path: dir.path().join("reuse.tq8").to_str().unwrap().into()
                },
                dir.path(),
                KeyBackend::Memory,
                &mut |_| panic!()
            )
            .is_err()
        );
        for reply in [p, result] {
            let text = reply.to_string();
            for forbidden in ["PRIVATE KEY", "key:", "password", "pkcs8"] {
                assert!(!text.contains(forbidden));
            }
        }
    }
    #[test]
    fn cancelled_and_failed_tokens_cannot_sign() {
        for cancel in [true, false] {
            let (dir, mut m, t) = fixture();
            run(
                &mut m,
                Command::LogPreview {
                    token: t.clone(),
                    selection: selection(),
                },
                dir.path(),
            );
            if cancel {
                run(&mut m, Command::LogCancel { token: t.clone() }, dir.path());
            } else {
                assert!(
                    m.run(
                        Command::LogSign {
                            token: t.clone(),
                            path: "invalid.adi".into()
                        },
                        dir.path(),
                        KeyBackend::Memory,
                        &mut |_| panic!()
                    )
                    .is_err()
                );
            }
            let output = dir.path().join("cancelled.tq8");
            assert!(
                m.run(
                    Command::LogSign {
                        token: t,
                        path: output.to_str().unwrap().into()
                    },
                    dir.path(),
                    KeyBackend::Memory,
                    &mut |_| panic!()
                )
                .is_err()
            );
            assert!(!output.exists());
        }
    }
    #[test]
    fn already_signed_requires_explicit_sign_again() {
        let (dir, mut m, t) = fixture();
        // Record a synthetic duplicate without reading a key or signing.
        let Pending::Sign(p) = &m.session.as_ref().unwrap().pending else {
            panic!()
        };
        let store = p.store.as_ref().unwrap();
        let selected_location = selection();
        let station = StationLocation::from_adif(
            &selected_location.call,
            &selected_location
                .place
                .iter()
                .map(|(n, v)| (n.as_str(), v.as_str()))
                .collect::<Vec<_>>(),
            Some(&selected_location.park),
        )
        .unwrap();
        let q = Qso::from_adif(&p.records[0]).unwrap();
        // Use the library's own signed station description through a real selection, preserving its duplicate semantics.
        let plan = store.prepare_signing(&[q], &station).unwrap();
        let selected = plan.choose(DuplicateChoice::SignAgain).unwrap();
        let cert = store.certificates().unwrap().remove(0).certificate;
        let signed = store
            .with_key(&store.certificates().unwrap()[0].id, |key| {
                selected.sign(&cert, key, SystemTime::now())
            })
            .unwrap()
            .unwrap();
        signed
            .write_to(store, &dir.path().join("first.tq8"))
            .unwrap();
        let p = run(
            &mut m,
            Command::LogPreview {
                token: t.clone(),
                selection: selection(),
            },
            dir.path(),
        );
        assert_eq!(p["alreadySigned"], 1);
        assert_eq!(p["toSign"], 0);
        let mut again = selection();
        again.sign_again = true;
        let p = run(
            &mut m,
            Command::LogPreview {
                token: t.clone(),
                selection: again,
            },
            dir.path(),
        );
        assert_eq!(p["toSign"], 1);
        assert_eq!(p["signAgainCount"], 1);
        let result = run(
            &mut m,
            Command::LogSign {
                token: t,
                path: dir.path().join("again.tq8").to_str().unwrap().into(),
            },
            dir.path(),
        );
        assert_eq!(result["signed"], 1);
        assert_eq!(result["alreadySigned"], 0);
    }
    #[test]
    fn upload_uses_only_fake_transport_and_fixed_endpoint() {
        let (dir, mut m, t) = fixture();
        run(
            &mut m,
            Command::LogPreview {
                token: t.clone(),
                selection: selection(),
            },
            dir.path(),
        );
        let path = dir.path().join("upload.tq8");
        run(
            &mut m,
            Command::LogSign {
                token: t,
                path: path.to_str().unwrap().into(),
            },
            dir.path(),
        );
        for (body, expected) in [
            (Some(b"<!-- .UPL. accepted -->".to_vec()), "accepted"),
            (Some(b"<!-- .UPL. rejected -->".to_vec()), "refused"),
            (Some(b"unknown".to_vec()), "not recognized"),
            (None, "connection failed"),
        ] {
            let p = run(
                &mut m,
                Command::UploadInspect {
                    path: path.to_str().unwrap().into(),
                },
                dir.path(),
            );
            assert_eq!(p["qsos"], 1);
            let t = token(&p);
            let mut calls = 0;
            let answer = m
                .run(
                    Command::UploadSend { token: t.clone() },
                    dir.path(),
                    KeyBackend::Memory,
                    &mut |request| {
                        calls += 1;
                        assert_eq!(request.url(), upload::UPLOAD_URL);
                        assert_eq!(request.method(), "POST");
                        body.clone().map(|b| (200, b)).ok_or(())
                    },
                )
                .unwrap();
            assert!(answer.contains(expected));
            assert_eq!(calls, 1);
            assert!(
                m.run(
                    Command::UploadSend { token: t },
                    dir.path(),
                    KeyBackend::Memory,
                    &mut |_| panic!()
                )
                .is_err()
            );
        }
    }
    #[test]
    fn location_errors_name_the_field_without_echoing_its_value() {
        let (dir, mut m, t) = fixture();
        for (field, label) in [
            ("MY_DXCC", "DXCC entity"),
            ("MY_GRIDSQUARE", "grid squares"),
            ("MY_CQ_ZONE", "CQ zone"),
            ("MY_SOTA_REF", "SOTA reference"),
        ] {
            let mut selected = selection();
            selected
                .place
                .insert(field.into(), "qg-test-invalid-location-value".into());
            let error = m
                .run(
                    Command::LogPreview {
                        token: t.clone(),
                        selection: selected,
                    },
                    dir.path(),
                    KeyBackend::Memory,
                    &mut |_| panic!(),
                )
                .unwrap_err();
            assert!(error.contains(label));
            assert!(!error.contains("qg-test-invalid-location-value"));
        }
    }
    #[test]
    fn preview_errors_allow_correcting_the_location_and_dates() {
        let (dir, mut m, t) = fixture();
        let mut bad = selection();
        bad.place.remove("MY_DXCC");
        assert!(
            m.run(
                Command::LogPreview {
                    token: t.clone(),
                    selection: bad
                },
                dir.path(),
                KeyBackend::Memory,
                &mut |_| panic!()
            )
            .is_err()
        );
        let mut bad = selection();
        bad.from = "2027-01-01".into();
        bad.to = "2026-01-01".into();
        assert!(
            m.run(
                Command::LogPreview {
                    token: t.clone(),
                    selection: bad
                },
                dir.path(),
                KeyBackend::Memory,
                &mut |_| panic!()
            )
            .is_err()
        );
        let good = run(
            &mut m,
            Command::LogPreview {
                token: t,
                selection: selection(),
            },
            dir.path(),
        );
        assert_eq!(good["toSign"], 1);
    }
    #[test]
    fn cabrillo_preview_retains_physical_lines() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("qg-test.log");
        std::fs::write(&file, corpus("cabrillo/synthetic-03.log")).unwrap();
        let mut m = Manager::default();
        let preview = run(
            &mut m,
            Command::LogPrepare {
                path: file.to_str().unwrap().into(),
            },
            dir.path(),
        );
        assert!(preview["qsos"].as_u64().unwrap() > 0);
        let Pending::Sign(p) = &m.session.as_ref().unwrap().pending else {
            panic!()
        };
        assert_eq!(p.records[0].source_line(), Some(4));
    }
    #[test]
    fn only_refuse_policy_and_no_extra_fields_are_accepted() {
        assert_eq!(options().qth, QthHandling::Refuse);
        for extra in ["qth", "ignore", "fromLog", "confirmed"] {
            let mut value = serde_json::json!({"call":"QG0TEST","place":{},"park":"","certificate":"","from":"","to":"","signAgain":false});
            value[extra] = serde_json::json!("Ignore");
            assert!(serde_json::from_value::<Selection>(value).is_err());
        }
    }
}
