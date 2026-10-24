// SPDX-License-Identifier: GPL-3.0-only
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

// The Keychain service this product owns (QGD-CRD-0003: the core owns its
// entry names and sets them explicitly, never leaving them to a library
// default).
//
// This was "adif-mcp" until 2026-10-09 — the MCP servers' namespace, left from
// P0 when `qso-graph-auth` interoperability was still the plan. KI7MT ended
// Python and MCP interop (QGD-CRD-0004) and the constant never moved, so the
// desktop was reading and writing the MCP servers' own credentials: real
// callsigns' entries sat in the same namespace the suites
// wrote synthetic fixtures into. Either side could overwrite the other's entry
// for the same callsign and provider, and nothing would have said so.
//
// Nothing under "adif-mcp" is migrated, read or deleted by this product. Those
// entries may belong to the MCP servers; they are not ours to move.
const SERVICE: &str = "io.qso-graph.desktop";

// Where the suites put their fixtures, so a test can never write beside a real
// credential. A separate service rather than a prefix on the account, because
// "delete everything under this service" is then one sweep that cannot
// accidentally match something real.
const TEST_SERVICE: &str = "io.qso-graph.desktop.test";

// The env var only SELECTS between the two names above; it never supplies one.
// A variable that supplied the service would be a way to point the core back
// at "adif-mcp", or at any other product's namespace, from outside.
fn service() -> &'static str {
    if std::env::var_os("QG_DESKTOP_TEST_KEYCHAIN").is_some() { TEST_SERVICE } else { SERVICE }
}
mod corelog;
mod backup;
mod reference;
mod updates;
mod validation;
type CoreResult<T> = std::result::Result<T, &'static str>;

// What a service lookup answers (QGD-APP-0007, QGD-PII-0007). `outcome` is a
// fixed word; `fields` carries what the service sent, for display. The secret
// used is never in here.
#[derive(Default, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "addon", napi_derive::napi(object))]
pub struct LookupField {
    pub name: String,
    pub value: String,
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "addon", napi_derive::napi(object))]
pub struct LookupResult {
    pub outcome: String,
    pub fields: Vec<LookupField>,
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "addon", napi_derive::napi(object))]
pub struct ProviderRef {
    // Whether a username is saved, never the username (KI7MT, 2026-10-23:
    // "we don't store anything that's not publicly available"): a username
    // can be an email address, and it lives in the Keychain entry with the
    // secret. An index an earlier build wrote held the username itself; it is
    // read as having one, and the file is written again without it (load).
    #[serde(default)]
    pub has_username: bool,
    // QGD-CRD-0010: what is stored, without reading what is stored.
    //
    // Which kinds of secret an entry holds is not itself a secret, and it is
    // known at the moment it is written. Keeping it here is what lets the
    // status display answer without decrypting anything — a decryption macOS
    // puts a password prompt in front of, at startup, before the operator has
    // asked for anything.
    #[serde(default)]
    pub has_password: bool,
    #[serde(default)]
    pub has_api_key: bool,
    // When it was last written, as the operator would want to see it.
    #[serde(default)]
    pub saved_at: Option<String>,
}

// One of the operator's callsigns (KI7MT, 2026-10-22: "persona" is retired).
// `id` is permanent and random, and is what everything else keys on: the
// Keychain entries, the preferences, the active callsign and the default
// location. So the call and the description can both be changed, and neither
// appears in a Keychain entry's name.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "addon", napi_derive::napi(object))]
pub struct Callsign {
    pub id: String,
    pub call: String,
    pub description: String,
    pub start: Option<String>,
    pub end: Option<String>,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderRef>,
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    callsigns: BTreeMap<String, Callsign>,
}

// No Debug implementation: a credential must never be printed by an error path.
#[derive(Default, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct Credentials {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

#[derive(Serialize)]
#[cfg_attr(feature = "addon", napi_derive::napi(object))]
pub struct CredentialStatus {
    // Whether this service can be tested at all, which is a fact about the
    // service and not about what is saved for it. Reported so the screen can
    // say so before the operator presses anything: a button that does nothing
    // teaches nothing, and pressing it to be told is a poor way to find out.
    pub testable: bool,
    pub stored: bool,
    // Whether which kinds are stored is actually known.
    //
    // An entry saved before the index recorded kinds has none recorded, and
    // false would be a lie about it rather than an absence of information.
    // Reading the secret to find out is the one thing status must not do
    // (QGD-CRD-0009), so it says it does not know, and the next explicit
    // action that decrypts the entry records what it finds.
    pub kinds_known: bool,
    pub has_username: bool,
    pub has_password: bool,
    pub has_api_key: bool,
    pub preferred: String,
    pub effective: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Preferences {
    callsigns: BTreeMap<String, BTreeMap<String, String>>,
}

fn identifier(value: &str) -> CoreResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || value.contains(':') || value.chars().any(char::is_control) {
        return Err("Use a non-empty name without colons or control characters.");
    }
    Ok(value.to_lowercase())
}

// A callsign's id: a version 4 UUID, written lowercase. Checked wherever one
// arrives, because it becomes part of a Keychain entry's name.
fn callsign_id(value: &str) -> CoreResult<String> {
    let bytes = value.as_bytes();
    let shaped = bytes.len() == 36
        && bytes.iter().enumerate().all(|(at, &b)| if [8, 13, 18, 23].contains(&at) { b == b'-' } else { b.is_ascii_digit() || (b'a'..=b'f').contains(&b) })
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b');
    if shaped { Ok(value.to_owned()) } else { Err("Callsign not found.") }
}

// A new id: 122 random bits from the FIPS module's generator, which TLS already
// links (no second source of randomness), as a version 4 UUID. Random rather
// than derived from the call, so one call can be held several times and its
// letters never appear in the Keychain.
fn new_callsign_id() -> CoreResult<String> {
    let mut bytes = [0u8; 16];
    aws_lc_rs::rand::fill(&mut bytes).map_err(|_| "A callsign could not be created.")?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32]))
}

// The call letters, as the operator types them, in capitals. A portable or
// maritime suffix is part of the call (W1AW/P).
fn call_letters(value: &str) -> CoreResult<String> {
    let call = value.trim().to_uppercase();
    if call.is_empty() || call.len() > 32 || !call.chars().all(|c| c.is_ascii_alphanumeric() || c == '/') {
        return Err("Enter a callsign: letters, digits and /.");
    }
    Ok(call)
}

// What the operator calls this one, beside the call: "Home", "Field Day".
// May be empty.
fn description_text(value: &str) -> CoreResult<String> {
    let description = value.trim();
    if description.chars().count() > 64 || description.chars().any(char::is_control) {
        return Err("Keep the description to 64 characters, on one line.");
    }
    Ok(description.to_owned())
}

fn subject(id: &str, provider: &str) -> CoreResult<String> {
    Ok(format!("{}:{}", callsign_id(id)?, identifier(provider)?))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> CoreResult<()> {
    let parent = path.parent().ok_or("Profile directory is unavailable.")?;
    fs::create_dir_all(parent).map_err(|_| "Profile directory could not be created.")?;
    let temp = parent.join(format!(".qg-{}-{}.tmp", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "System clock is unavailable.")?.as_nanos()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| "Profile could not be saved.")?;
        file.write_all(bytes).map_err(|_| "Profile could not be saved.")?;
        file.sync_all().map_err(|_| "Profile could not be saved.")?;
        fs::rename(&temp, path).map_err(|_| "Profile could not be saved.")?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(temp); }
    result
}

struct Store { directory: PathBuf }

// A callsign as the operator knows it: the call, and its description.
fn label(callsign: &Callsign) -> String {
    if callsign.description.is_empty() { callsign.call.clone() } else { format!("{} · {}", callsign.call, callsign.description) }
}

impl Store {
    fn new(directory: PathBuf) -> CoreResult<Self> {
        fs::create_dir_all(&directory).map_err(|_| "Profile directory could not be created.")?;
        Ok(Self { directory })
    }
    fn load(&self) -> CoreResult<Index> {
        let path = self.directory.join("callsigns.json");
        match fs::read(path) {
            Ok(bytes) if bytes.len() <= 4_000_000 => {
                let index: Index = serde_json::from_slice(&bytes).map_err(|_| "The list of callsigns could not be read. It has not been changed.")?;
                // An earlier build kept each service's username in this file.
                // Read again, it is gone, with only whether there was one
                // kept: the file is written again at once so it is not left.
                if let Ok(raw) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    let mut index = index;
                    let mut scrubbed = false;
                    if let Some(callsigns) = raw.get("callsigns").and_then(|value| value.as_object()) {
                        for (id, callsign) in callsigns {
                            let Some(providers) = callsign.get("providers").and_then(|value| value.as_object()) else { continue; };
                            for (provider, reference) in providers {
                                let Some(name) = reference.get("username").and_then(|value| value.as_str()) else { continue; };
                                scrubbed = true;
                                if let Some(entry) = index.callsigns.get_mut(id).and_then(|c| c.providers.get_mut(provider)) {
                                    entry.has_username = entry.has_username || !name.is_empty();
                                }
                            }
                        }
                    }
                    if scrubbed { self.save(&index)?; }
                    return Ok(index);
                }
                Ok(index)
            }
            Ok(_) => Err("The list of callsigns is larger than this version supports."),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Index::default()),
            Err(_) => Err("The list of callsigns could not be read. It has not been changed."),
        }
    }
    fn save(&self, index: &Index) -> CoreResult<()> {
        let bytes = serde_json::to_vec_pretty(index).map_err(|_| "Profile could not be saved.")?;
        atomic_write(&self.directory.join("callsigns.json"), &bytes)
    }
    fn lookup(&self, id: &str) -> CoreResult<Callsign> {
        let id = callsign_id(id)?;
        self.load()?.callsigns.remove(&id).ok_or("Callsign not found.")
    }
    fn parse_dates(start: &Option<String>, end: &Option<String>) -> CoreResult<()> {
        let parse = |value: &Option<String>| -> CoreResult<Option<NaiveDate>> {
            value.as_ref().map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "Use YYYY-MM-DD for dates.")).transpose()
        };
        let (first, last) = (parse(start)?, parse(end)?);
        if matches!((first, last), (Some(a), Some(b)) if b < a) { return Err("End date must not precede start date."); }
        Ok(())
    }
    // A new callsign, with a new id.
    fn create(&self, call: &str, description: &str, start: Option<String>, end: Option<String>) -> CoreResult<Callsign> {
        let (call, description) = (call_letters(call)?, description_text(description)?);
        Self::parse_dates(&start, &end)?;
        let mut index = self.load()?;
        let id = new_callsign_id()?;
        let callsign = Callsign { id: id.clone(), call, description, start, end, providers: BTreeMap::new() };
        index.callsigns.insert(id, callsign.clone());
        self.save(&index)?;
        Ok(callsign)
    }
    // The call, the description and the dates may all change; the id, and so
    // every credential under it, does not.
    fn update(&self, id: &str, call: &str, description: &str, start: Option<String>, end: Option<String>) -> CoreResult<Callsign> {
        let id = callsign_id(id)?;
        let (call, description) = (call_letters(call)?, description_text(description)?);
        Self::parse_dates(&start, &end)?;
        let mut index = self.load()?;
        let callsign = index.callsigns.get_mut(&id).ok_or("Callsign not found.")?;
        callsign.call = call;
        callsign.description = description;
        callsign.start = start;
        callsign.end = end;
        let updated = callsign.clone();
        self.save(&index)?;
        Ok(updated)
    }
    fn entry(&self, id: &str, provider: &str) -> CoreResult<keyring::Entry> {
        self.lookup(id)?;
        keyring::Entry::new(service(), &subject(id, provider)?).map_err(|_| "Keychain is unavailable.")
    }
    // Does the Keychain hold an entry for this, without reading it?
    //
    // The attributes of an item are not behind its access control; the data is.
    // Asking for attributes and deliberately not asking for data is what makes
    // this silent — a read of the secret is what raises the login-keychain
    // prompt (QGD-CRD-0009).
    #[cfg(target_os = "macos")]
    fn entry_exists(&self, id: &str, provider: &str) -> CoreResult<bool> {
        use security_framework::item::{ItemClass, ItemSearchOptions};
        let account = subject(id, provider)?;
        let found = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(service())
            .account(&account)
            // Attributes, and never data. This is the whole of the difference.
            .load_attributes(true)
            .limit(1)
            .search();
        match found {
            Ok(items) => Ok(!items.is_empty()),
            // -25300 is errSecItemNotFound: an answer, not a failure.
            Err(e) if e.code() == -25300 => Ok(false),
            Err(_) => Err("Keychain could not be asked about this credential."),
        }
    }

    // The Secret Service equivalent. keyring's own lookup unlocks any locked
    // item it finds, and unlocking a locked collection is what raises the
    // password dialog, so it is not used here. SearchItems answers with the
    // matching items split into locked and unlocked; either half is an entry,
    // and neither is opened. The attributes are the ones keyring writes
    // (zbus-secret-service-keyring-store's search_attributes).
    #[cfg(all(unix, not(target_os = "macos")))]
    fn entry_exists(&self, id: &str, provider: &str) -> CoreResult<bool> {
        use secret_service::{EncryptionType, blocking::SecretService};
        let account = subject(id, provider)?;
        let unavailable = "Keychain could not be asked about this credential.";
        let ss = SecretService::connect(EncryptionType::Dh).map_err(|_| unavailable)?;
        let found = ss
            .search_items(std::collections::HashMap::from([("service", service()), ("username", account.as_str())]))
            .map_err(|_| unavailable)?;
        Ok(!found.unlocked.is_empty() || !found.locked.is_empty())
    }

    // Windows Credential Manager has no prompt to raise: reading an entry's
    // attributes is silent.
    #[cfg(windows)]
    fn entry_exists(&self, id: &str, provider: &str) -> CoreResult<bool> {
        match self.entry(id, provider)?.inner.get_attributes() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err("Keychain could not be asked about this credential."),
        }
    }

    // Records what was stored, which is not a secret, so the status display
    // never has to decrypt anything to answer.
    fn record_kinds(&self, id: &str, provider: &str, creds: &Credentials) -> CoreResult<()> {
        let id = callsign_id(id)?;
        let provider = identifier(provider)?;
        let mut index = self.load()?;
        let profile = index.callsigns.get_mut(&id).ok_or("Callsign not found.")?;
        let reference = profile.providers.entry(provider).or_insert_with(ProviderRef::default);
        reference.has_username = creds.username.as_ref().is_some_and(|s| !s.is_empty());
        reference.has_password = creds.password.as_ref().is_some_and(|s| !s.is_empty());
        reference.has_api_key = creds.api_key.as_ref().is_some_and(|s| !s.is_empty());
        reference.saved_at = Some(now_utc());
        self.save(&index)
    }

    fn forget_kinds(&self, id: &str, provider: &str) -> CoreResult<()> {
        let Ok(id) = callsign_id(id) else { return Ok(()); };
        let Ok(provider) = identifier(provider) else { return Ok(()); };
        let mut index = self.load()?;
        if let Some(profile) = index.callsigns.get_mut(&id) {
            profile.providers.remove(&provider);
            return self.save(&index);
        }
        Ok(())
    }

    fn read_credentials(&self, id: &str, provider: &str) -> CoreResult<Option<Credentials>> {
        let entry = self.entry(id, provider)?;
        match entry.get_password() {
            Ok(raw) => {
                // QGD-CRD-0009: every decryption of a stored credential, as it
                // happens. This is the only path that decrypts one, so the log
                // is a complete record of when the operating system was asked
                // to unlock a secret — which is also what a test can read to
                // assert that nothing did so at startup. The provider and the
                // fact, never the value (QGD-LOG-0004).
                tracing::info!(provider = %provider, "credential secret read");
                let raw = Zeroizing::new(raw);
                let creds: Credentials = serde_json::from_str(&raw)
                    .map_err(|_| "Stored credential has an unsupported format. It has not been changed.")?;
                // Self-healing: an entry written before the index recorded
                // kinds gets them recorded here, the first time something with
                // a reason to decrypt it does. Nothing decrypts anything in
                // order to repair this.
                let _ = self.record_kinds(id, provider, &creds);
                Ok(Some(creds))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Keychain could not read this credential."),
        }
    }
    fn save_credentials(&self, id: &str, provider: &str, credentials: Credentials) -> CoreResult<()> {
        if credentials.username.as_ref().is_some_and(|s| s.len() > 4096) || credentials.password.as_ref().is_some_and(|s| s.len() > 4096) || credentials.api_key.as_ref().is_some_and(|s| s.len() > 4096) { return Err("Credential exceeds the supported size."); }
        if credentials.password.as_ref().is_none_or(String::is_empty) && credentials.api_key.as_ref().is_none_or(String::is_empty) { return Err("Enter a password or API key."); }
        let id = callsign_id(id)?;
        let provider = identifier(provider)?;
        let mut merged = self.read_credentials(&id, &provider)?.unwrap_or_default();
        if let Some(value) = credentials.username.as_ref() { merged.username = Some(value.clone()); }
        if let Some(value) = credentials.password.as_ref() { merged.password = Some(value.clone()); }
        if let Some(value) = credentials.api_key.as_ref() { merged.api_key = Some(value.clone()); }
        // Register a non-secret provider ref. Credentials
        // remain exclusively in Keychain; its payload never enters the index.
        let mut index = self.load()?;
        let profile = index.callsigns.get_mut(&id).ok_or("Callsign not found.")?;
        profile.providers.entry(provider.clone()).or_default();
        self.save(&index)?;
        let raw = Zeroizing::new(serde_json::to_string(&merged).map_err(|_| "Credential could not be encoded.")?);
        let result = self.entry(&id, &provider)?.set_password(&raw).map_err(|_| "Keychain could not save this credential.");
        // Recorded only once the Keychain has it, so the index never claims a
        // credential that was not written (QGD-CRD-0010).
        if result.is_ok() { self.record_kinds(&id, &provider, &merged)?; }
        // QGD-LOG-0004: the provider and the outcome. Never the value, never
        // the callsign or its description.
        match &result {
            Ok(()) => tracing::info!(provider = %provider, "credential saved"),
            Err(reason) => tracing::warn!(provider = %provider, reason = %reason, "credential could not be saved"),
        }
        result
    }
    fn preferences(&self) -> CoreResult<Preferences> {
        match fs::read(self.directory.join("desktop-preferences.json")) {
            Ok(bytes) if bytes.len() <= 4_000_000 => serde_json::from_slice(&bytes).map_err(|_| "Credential preferences could not be read."),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
            _ => Err("Credential preferences could not be read."),
        }
    }
    fn preference(&self, id: &str, provider: &str) -> CoreResult<String> {
        let prefs = self.preferences()?;
        let preference = prefs.callsigns.get(&callsign_id(id)?).and_then(|p| p.get(&identifier(provider).ok()?)).cloned().unwrap_or_else(|| "service".into());
        if !["service", "password", "api_key"].contains(&preference.as_str()) { return Err("Credential preference is invalid."); }
        Ok(preference)
    }
    fn set_preference(&self, id: &str, provider: &str, preference: &str) -> CoreResult<()> {
        self.lookup(id)?;
        if !["service", "password", "api_key"].contains(&preference) { return Err("Credential preference is invalid."); }
        let mut prefs = self.preferences()?;
        prefs.callsigns.entry(callsign_id(id)?).or_default().insert(identifier(provider)?, preference.into());
        let bytes = serde_json::to_vec_pretty(&prefs).map_err(|_| "Profile could not be saved.")?;
        atomic_write(&self.directory.join("desktop-preferences.json"), &bytes)
    }

    // ---- moving callsigns between machines (QGD-PSN-0007 to QGD-PSN-0011) -

    // Everything an export carries: the callsigns, which services each one
    // uses, the preferences, and the Locations it is handed. No username and no
    // secret (KI7MT, 2026-10-23: "the Callsigns and Locations are what we can
    // manage. Users still manage their credentials"): nothing here reads the
    // Keychain, and a service's record goes as having no secret saved, which
    // on the other computer is true until the operator enters it.
    fn gather_without_secrets(&self, locations: serde_json::Value) -> CoreResult<backup::Backup> {
        let index = self.load()?;
        let preferences = self.preferences()?.callsigns;
        let callsigns = index.callsigns.into_values().map(|mut callsign| {
            for reference in callsign.providers.values_mut() {
                reference.has_username = false;
                reference.has_password = false;
                reference.has_api_key = false;
                reference.saved_at = None;
            }
            callsign
        }).collect();
        let active = self.active_id()?;
        Ok(backup::Backup { format: backup::FORMAT.into(), version: backup::VERSION, created: now_utc(), callsigns, preferences, locations, active })
    }

    // The callsigns on this computer, as the operator knows them, which a
    // restore would remove first.
    fn labels(&self) -> CoreResult<Vec<String>> {
        Ok(self.load()?.callsigns.values().map(label).collect())
    }

    // What an import would change, without changing it (QGD-PSN-0009). A
    // callsign already here, by its id, is named, so the operator is told
    // before rather than after. Named as the operator knows it: the call and
    // the description.
    fn preview(&self, bundle: &backup::Backup) -> CoreResult<Vec<String>> {
        let mut arriving = Vec::new();
        for callsign in &bundle.callsigns {
            callsign_id(&callsign.id)?;
            arriving.push(label(callsign));
        }
        Ok(arriving)
    }

    // All of it or none of it. The index is written once, at the end, so a
    // failure part way through leaves the callsigns as they were — and the
    // Keychain entries that were written before it are entries for callsigns
    // the index does not have, which the next save overwrites. There is no
    // ordering that makes a Keychain and a file atomic together; what this
    // guarantees is that the index never half-changes.
    //
    // A restore onto a clean slate (KI7MT, 2026-10-23): the callsigns here,
    // with every Keychain entry each one has, are removed first when the
    // operator says so, and refused otherwise, so nothing is ever merged. No
    // secret is written: a file from before this release that holds some has
    // them left unread, and the operator enters each login again.
    fn absorb(&self, bundle: &backup::Backup, replace: bool) -> CoreResult<usize> {
        let here: Vec<String> = self.load()?.callsigns.keys().cloned().collect();
        if !here.is_empty() {
            if !replace { return Err("This computer already has callsigns. Remove them first, then restore."); }
            for id in &here { self.remove_callsign(id)?; }
        }
        let mut index = self.load()?;
        for callsign in &bundle.callsigns {
            // Every field is checked as if it had been typed here.
            let id = callsign_id(&callsign.id)?;
            call_letters(&callsign.call)?;
            description_text(&callsign.description)?;
            Self::parse_dates(&callsign.start, &callsign.end)?;
            let mut callsign = callsign.clone();
            // No secret arrives, so none is said to be saved.
            for reference in callsign.providers.values_mut() {
                reference.has_username = false;
                reference.has_password = false;
                reference.has_api_key = false;
                reference.saved_at = None;
            }
            index.callsigns.insert(id, callsign);
        }
        self.save(&index)?;

        let mut prefs = self.preferences()?;
        for (id, services) in &bundle.preferences {
            prefs.callsigns.entry(callsign_id(id)?).or_default().extend(services.clone());
        }
        let bytes = serde_json::to_vec_pretty(&prefs).map_err(|_| "Profile could not be saved.")?;
        atomic_write(&self.directory.join("desktop-preferences.json"), &bytes)?;
        // The callsign that was active, when the backup names one it holds.
        if let Some(active) = bundle.active.as_deref() {
            let id = callsign_id(active)?;
            if index.callsigns.contains_key(&id) {
                atomic_write(&self.directory.join("current.txt"), id.as_bytes())?;
            }
        }
        Ok(bundle.callsigns.len())
    }

    // The active callsign's id, or none. A file naming one that is gone reads
    // as none.
    fn active_id(&self) -> CoreResult<Option<String>> {
        match fs::read_to_string(self.directory.join("current.txt")) {
            Ok(id) => Ok(self.lookup(id.trim()).ok().map(|c| c.id)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err("The active callsign could not be read."),
        }
    }
    fn delete_credentials(&self, id: &str, provider: &str) -> CoreResult<bool> {
        self.lookup(id)?;
        #[cfg(target_os = "macos")]
        match security_framework::passwords::delete_generic_password(service(), &subject(id, provider)?) {
            Ok(()) => {
                tracing::info!(provider = %provider, "credential removed");
                // The index must not go on describing an entry that is gone.
                self.forget_kinds(id, provider)?;
                Ok(true)
            }
            Err(e) if e.code() == -25300 => { self.forget_kinds(id, provider)?; Ok(false) }
            Err(_) => {
                tracing::warn!(provider = %provider, "keychain refused to remove a credential");
                Err("Keychain could not remove this credential.")
            }
        }
        // The same contract as above: the index never goes on describing an
        // entry that is gone, whichever way it went.
        #[cfg(not(target_os = "macos"))]
        match self.entry(id, provider)?.delete_credential() {
            Ok(()) => {
                tracing::info!(provider = %provider, "credential removed");
                self.forget_kinds(id, provider)?;
                Ok(true)
            }
            Err(keyring::Error::NoEntry) => { self.forget_kinds(id, provider)?; Ok(false) }
            Err(_) => {
                tracing::warn!(provider = %provider, "keychain refused to remove a credential");
                Err("Keychain could not remove this credential.")
            }
        }
    }
    fn remove_secret(&self, id: &str, provider: &str, field: &str) -> CoreResult<()> {
        if !["password", "api_key"].contains(&field) { return Err("Secret field is invalid."); }
        let Some(mut creds) = self.read_credentials(id, provider)? else { return Ok(()); };
        let removed = if field == "password" { creds.password.take() } else { creds.api_key.take() };
        let _removed = Zeroizing::new(removed);
        if creds.password.as_ref().is_none_or(String::is_empty) && creds.api_key.as_ref().is_none_or(String::is_empty) {
            self.delete_credentials(id, provider)?;
        } else {
            let raw = Zeroizing::new(serde_json::to_string(&creds).map_err(|_| "Credential could not be encoded.")?);
            self.entry(id, provider)?.set_password(&raw).map_err(|_| "Keychain could not save this credential.")?;
            self.record_kinds(id, provider, &creds)?;
        }
        Ok(())
    }
    // A callsign, its credentials and its preferences. Every Keychain entry it
    // could have is deleted first; if one cannot be, nothing else changes and
    // a retry finishes the job.
    fn remove_callsign(&self, id: &str) -> CoreResult<()> {
        self.remove_callsign_using(id, |id, provider| self.delete_credentials(id, provider))
    }
    fn remove_callsign_using<F>(&self, id: &str, mut delete: F) -> CoreResult<()>
    where F: FnMut(&str, &str) -> CoreResult<bool> {
        let id = callsign_id(id)?;
        let profile = self.lookup(&id)?;
        let mut index = self.load()?;
        let mut prefs = self.preferences()?;
        let mut providers = std::collections::BTreeSet::new();
        for provider in profile.providers.keys().chain(prefs.callsigns.get(&id).into_iter().flat_map(|p| p.keys())) {
            providers.insert(identifier(provider)?);
        }
        // Every supported service as well, so an entry whose record was lost
        // is not left behind in the Keychain. Every account is scoped to this
        // callsign's id.
        for provider in ["qrz", "qrz_logbook", "eqsl", "lotw", "hamqth", "clublog"] { providers.insert(provider.into()); }
        let current_path = self.directory.join("current.txt");
        let current = match fs::read_to_string(&current_path) {
            Ok(value) => Some(value),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("The active callsign could not be read."),
        };
        for provider in providers {
            delete(&id, &provider).map_err(|_| "The callsign was not removed because Keychain could not delete a credential. Some credentials may already be removed; retry to finish.")?;
        }
        prefs.callsigns.remove(&id);
        let bytes = serde_json::to_vec_pretty(&prefs).map_err(|_| "Profile could not be saved.")?;
        atomic_write(&self.directory.join("desktop-preferences.json"), &bytes)?;
        if current.as_ref().is_some_and(|value| value.trim() == id) {
            fs::remove_file(current_path).map_err(|_| "The active callsign could not be cleared.")?;
        }
        index.callsigns.remove(&id);
        self.save(&index)
    }
    // QGD-CRD-0009: nothing here reads a secret.
    //
    // It used to. Opening the application selected the remembered callsign,
    // which asked for this, which decrypted the entry — and macOS asked the
    // operator for the login keychain password before he had done anything at
    // all. Everything this reports is either in the index, where it was
    // written when the credential was saved, or is the existence of the entry,
    // which the Keychain will answer from attributes without unlocking data.
    fn status(&self, id: &str, provider: &str) -> CoreResult<CredentialStatus> {
        self.lookup(id)?;
        let provider = identifier(provider)?;
        let reference = self.lookup(id)?.providers.get(&provider).cloned();
        let exists = self.entry_exists(id, &provider)?;
        let preferred = self.preference(id, &provider)?;

        // The index says what kinds were stored; the Keychain says whether the
        // entry is still there. An entry removed outside this application
        // makes the index stale, and the Keychain is believed over it.
        // Recorded when written. An entry with no saved_at predates the
        // record, so what it holds is unknown rather than nothing.
        let known = reference.as_ref().is_some_and(|r| r.saved_at.is_some());
        let has_password = exists && known && reference.as_ref().is_some_and(|r| r.has_password);
        let has_api_key = exists && known && reference.as_ref().is_some_and(|r| r.has_api_key);
        let effective = effective_field(&provider, has_password, has_api_key,
            if preferred == "service" { None } else { Some(&preferred) });

        Ok(CredentialStatus {
            testable: validation::supported(&provider),
            stored: exists,
            kinds_known: !exists || known,
            has_username: exists && reference.as_ref().is_some_and(|r| r.has_username),
            has_password,
            has_api_key,
            preferred,
            effective,
        })
    }
}

// The same choice selected_field makes, from what is stored rather than from
// the stored values — so the status display can answer it without decrypting
// anything (QGD-CRD-0010). The two must agree, and a test holds them together.
// An ISO-8601 instant. chrono is already here for NaiveDate, but without its
// "clock" feature, so the time comes from std and chrono formats it — rather
// than widening a dependency for one string.
fn now_utc() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default();
    chrono::DateTime::from_timestamp(seconds, 0)
        .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_default()
}

fn effective_field(provider: &str, has_password: bool, has_api_key: bool, prefer: Option<&str>) -> Option<String> {
    let preferred = prefer.unwrap_or(if provider.to_lowercase() == "qrz_logbook" { "api_key" } else { "password" });
    let (first, second, first_name, second_name) = match preferred {
        "api_key" => (has_api_key, has_password, "api_key", "password"),
        "password" => (has_password, has_api_key, "password", "api_key"),
        _ => return None,
    };
    if first { Some(first_name.to_owned()) } else if second { Some(second_name.to_owned()) } else { None }
}

fn selected_field(provider: &str, creds: &Credentials, prefer: Option<&str>) -> CoreResult<&'static str> {
    let preferred = prefer.unwrap_or(if provider.to_lowercase() == "qrz_logbook" { "api_key" } else { "password" });
    let (first, second, first_name, second_name) = match preferred {
        "api_key" => (&creds.api_key, &creds.password, "api_key", "password"),
        "password" => (&creds.password, &creds.api_key, "password", "api_key"),
        _ => return Err("Secret preference must be password or api_key."),
    };
    if first.as_ref().is_some_and(|s| !s.is_empty()) { Ok(first_name) }
    else if second.as_ref().is_some_and(|s| !s.is_empty()) { Ok(second_name) }
    else { Err("No password or API key is stored.") }
}
fn selected_secret<'a>(provider: &str, creds: &'a Credentials, prefer: Option<&str>) -> CoreResult<&'a str> {
    match selected_field(provider, creds, prefer)? {
        "api_key" => creds.api_key.as_deref().ok_or("No API key is stored."),
        _ => creds.password.as_deref().ok_or("No password is stored."),
    }
}

#[cfg(feature = "addon")]
mod addon {
    use super::*;
    use napi::{Error, Result};
    use napi::bindgen_prelude::{AsyncTask, Buffer};
    use napi::{Env, Task};
    use napi_derive::napi;
    fn error(reason: &'static str) -> Error { Error::from_reason(reason) }

    // The JS transfer object is distinct from the Rust-owned, zeroized secret.
    // Neither type implements Debug; no renderer can call the read operation.
    #[napi(object)]
    pub struct CredentialInput {
        pub username: Option<String>,
        pub password: Option<String>,
        pub api_key: Option<String>,
    }

    /// QGD-LOG-0001: install the core's subscriber. Idempotent, because a
    /// utility process that restarts must not fail on logging already being up.
    #[napi]
    pub fn init_core_logging() { crate::corelog::init(); }

    /// Hand over everything the core has raised since the last call. The node
    /// side passes these through its own redacting logger.
    #[napi]
    pub fn drain_core_logs() -> Vec<String> { crate::corelog::drain() }

    #[napi]
    pub struct CallsignCore { store: Store }

    #[napi(object)]
    pub struct CredentialTest { pub outcome: String }

    /// What is in an export and what importing it would change. No secret: it
    /// counts them and names the callsigns, which is what an operator needs to
    /// decide (QGD-CRD-0006).
    #[napi(object)]
    pub struct ImportPreview {
        pub created: String,
        pub callsigns: u32,
        pub arriving: Vec<String>,
        // The callsigns on this computer, which a restore removes first.
        pub here: Vec<String>,
        // The Locations, as QG Storage handed them to the export.
        pub locations: String,
    }

    /// What came back from a reference source. `fresh` false is a 304: the
    /// body is empty and nothing changed (QGD-REF-0010).
    pub struct UpdateDownload {
        directory: std::path::PathBuf,
        url: String,
        sum: String,
        name: String,
    }

    impl Task for UpdateDownload {
        type Output = String;
        type JsValue = String;
        fn compute(&mut self) -> Result<String> {
            let path = crate::updates::download(&self.directory, &self.url, &self.sum, &self.name).map_err(error)?;
            // The host and the name, never the path or the sum.
            let host = self.url.split('/').nth(2).unwrap_or("").to_string();
            tracing::info!(host, name = self.name.as_str(), "update downloaded and checked");
            path.into_os_string().into_string().map_err(|_| error("The update could not be saved."))
        }
        fn resolve(&mut self, _env: Env, output: String) -> Result<String> { Ok(output) }
    }

    #[napi(object)]
    pub struct FetchedReference {
        pub fresh: bool,
        pub body: Buffer,
        pub etag: Option<String>,
        pub last_modified: Option<String>,
    }

    #[napi(object)]
    pub struct ImportSummary {
        pub callsigns: u32,
        // The Locations, for QG Storage to restore.
        pub locations: String,
    }

    #[napi]
    impl CallsignCore {
        #[napi(constructor)]
        pub fn new(directory: String) -> Result<Self> { Ok(Self { store: Store::new(directory.into()).map_err(error)? }) }
        /// Tests the saved credential, every time it is asked.
        ///
        /// This product does not limit the operator. It held a cooldown of its
        /// own until 2026-10-10 — thirty seconds after any test and five
        /// minutes after a rejected one — and the effect was that a ham who
        /// had just corrected a password was told to wait, by us, for a
        /// service that was willing to answer. KI7MT's direction: do not
        /// intentionally limit users.
        ///
        /// `rate-limited` stays as an outcome, because the service itself can
        /// say it (`QGD-PSN-0005`). The difference is whose answer it is.
        ///
        /// Pressing the button twice at once is prevented by the button, which
        /// is disabled while a test is in flight — not a limit, just not
        /// firing the same action twice.
        #[napi]
        pub fn test_credential(&mut self, id: String, provider: String) -> Result<CredentialTest> {
            self.store.lookup(&id).map_err(error)?;
            let provider = identifier(&provider).map_err(error)?;
            let outcome = if !validation::supported(&provider) { "unsupported" }
            else {
                let preference = self.store.preference(&id, &provider).map_err(error)?;
                let creds = self.store.read_credentials(&id, &provider).map_err(error)?;
                match creds {
                    Some(creds) if creds.username.as_ref().is_some_and(|s| !s.is_empty()) => {
                        let result = validation::test(&provider, &creds, if preference == "service" { None } else { Some(&preference) }).map_err(error)?;
                        tracing::info!(provider = %provider, outcome = %result, "credential tested");
                        result
                    }
                    _ => "missing",
                }
            };
            Ok(CredentialTest { outcome: outcome.into() })
        }
        // QGD-APP-0007: the frame acts with the credential and returns the
        // answer. Never the secret, and never a log line carrying the result —
        // QGD-PII-0007 forbids keeping or passing on what a lookup returned,
        // and a log is keeping it. Only the outcome word is logged.
        #[napi]
        pub fn service_lookup(
            &mut self, id: String, provider: String, operation: String, callsign: String
        ) -> Result<LookupResult> {
            // Refused before a secret is read.
            //
            // QGD-CRD-0009: a secret is read only on an action that needs it,
            // because reading one is what makes macOS ask for the login
            // keychain password. An operation this product does not perform,
            // or a callsign it will not send, needs no credential to refuse —
            // and the first version of this read the Keychain first and then
            // threw the answer away. Found in review.
            if !validation::known_operation(&provider, &operation) {
                return Ok(LookupResult { outcome: "unsupported".into(), fields: Vec::new() });
            }
            if !validation::plain_callsign(&callsign) {
                return Ok(LookupResult { outcome: "invalid-request".into(), fields: Vec::new() });
            }
            let preference = self.store.preference(&id, &provider).map_err(error)?;
            let creds = self.store.read_credentials(&id, &provider).map_err(error)?;
            let Some(creds) = creds.filter(|c| c.username.as_ref().is_some_and(|s| !s.is_empty())) else {
                return Ok(LookupResult { outcome: "missing".into(), fields: Vec::new() });
            };
            let looked = validation::lookup(
                &provider, &creds,
                if preference == "service" { None } else { Some(&preference) },
                &operation, &callsign,
            ).map_err(error)?;
            match looked {
                validation::Looked::Found(fields) => {
                    tracing::info!(provider = %provider, operation = %operation, fields = fields.len(), "service lookup answered");
                    Ok(LookupResult {
                        outcome: "success".into(),
                        fields: fields.into_iter().map(|(name, value)| LookupField { name, value }).collect(),
                    })
                }
                validation::Looked::Nothing(reason) => {
                    tracing::info!(provider = %provider, operation = %operation, outcome = %reason, "service lookup answered");
                    Ok(LookupResult { outcome: reason.into(), fields: Vec::new() })
                }
            }
        }
        #[napi]
        pub fn list(&self) -> Result<Vec<Callsign>> { Ok(self.store.load().map_err(error)?.callsigns.into_values().collect()) }
        #[napi]
        pub fn create(&self, call: String, description: String, start: Option<String>, end: Option<String>) -> Result<Callsign> {
            self.store.create(&call, &description, start, end).map_err(error)
        }
        #[napi]
        pub fn update(&self, id: String, call: String, description: String, start: Option<String>, end: Option<String>) -> Result<Callsign> {
            self.store.update(&id, &call, &description, start, end).map_err(error)
        }
        #[napi]
        pub fn set_active(&self, id: String) -> Result<()> {
            let callsign = self.store.lookup(&id).map_err(error)?;
            atomic_write(&self.store.directory.join("current.txt"), callsign.id.as_bytes()).map_err(error)
        }
        // The active callsign's id, or none. A file naming one that is gone
        // reads as none.
        #[napi]
        pub fn active(&self) -> Result<Option<String>> {
            self.store.active_id().map_err(error)
        }
        #[napi]
        pub fn save_credentials(&self, id: String, provider: String, credentials: CredentialInput) -> Result<()> {
            let credentials = Credentials {
                username: credentials.username.filter(|s| !s.is_empty()),
                password: credentials.password.filter(|s| !s.is_empty()),
                api_key: credentials.api_key.filter(|s| !s.is_empty()),
            };
            self.store.save_credentials(&id, &provider, credentials).map_err(error)
        }
        #[napi]
        pub fn credential_status(&self, id: String, provider: String) -> Result<CredentialStatus> { self.store.status(&id, &provider).map_err(error) }
        #[napi]
        pub fn delete_credentials(&self, id: String, provider: String) -> Result<bool> {
            self.store.delete_credentials(&id, &provider).map_err(error)
        }
        #[napi]
        pub fn remove_secret(&self, id: String, provider: String, field: String) -> Result<()> {
            self.store.remove_secret(&id, &provider, &field).map_err(error)
        }
        #[napi]
        pub fn set_preference(&self, id: String, provider: String, preference: String) -> Result<()> {
            self.store.set_preference(&id, &provider, &preference).map_err(error)
        }
        #[napi]
        pub fn remove_callsign(&self, id: String) -> Result<()> {
            self.store.remove_callsign(&id).map_err(error)
        }

        // ---- moving callsigns between machines -------------------------
        //
        // A plain file of what is public (backup.rs): no login is read for
        // it, so nothing secret crosses this boundary (QGD-PSN-0007).
        // ---- reference data, fetched through this process's TLS ---------
        //
        // D-18 and D-31: all of the app's outbound HTTPS goes through this
        // core, because Electron's networking is BoringSSL and not the
        // validated module. The engine asks; this fetches; the bytes go back
        // for the engine to load. No credential is involved and none is read.
        #[napi]
        pub fn fetch_reference(
            &self,
            url: String,
            etag: Option<String>,
            last_modified: Option<String>,
        ) -> Result<FetchedReference> {
            let fetched = crate::reference::fetch(&url, etag.as_deref(), last_modified.as_deref())
                .map_err(error)?;
            // The host, so a run can be read back later; never the path, which
            // is longer and says no more about where this went.
            let host = url.split('/').nth(2).unwrap_or("").to_string();
            tracing::info!(host, fresh = fetched.fresh, bytes = fetched.body.len(), "reference fetched");
            Ok(FetchedReference {
                fresh: fetched.fresh,
                body: fetched.body.into(),
                etag: fetched.etag,
                last_modified: fetched.last_modified,
            })
        }

        // ---- updates (QGD-FRM-0019) ------------------------------------
        //
        // The feed from the one address the register names, and a download
        // checked against the sum main read from it (updates.rs). The
        // download runs off the main thread: it can take minutes, and every
        // other request to this process must still be answered meanwhile.
        #[napi]
        pub fn fetch_update_feed(&self) -> Result<Buffer> {
            let body = crate::updates::fetch_feed().map_err(error)?;
            tracing::info!(bytes = body.len(), "update feed fetched");
            Ok(body.into())
        }

        #[napi(ts_return_type = "Promise<string>")]
        pub fn download_update(&self, url: String, sum: String, name: String) -> AsyncTask<UpdateDownload> {
            AsyncTask::new(UpdateDownload { directory: self.store.directory.clone(), url, sum, name })
        }

        /// A plain backup of the callsigns and the Locations it is handed,
        /// with nothing of any login (QGD-PSN-0007).
        #[napi]
        pub fn export_backup(&self, locations: String) -> Result<Buffer> {
            if locations.len() > 2 * 1024 * 1024 { return Err(error("The Locations are too large to back up.")); }
            let locations: serde_json::Value = serde_json::from_str(&locations).map_err(|_| error("The Locations could not be backed up."))?;
            let bundle = self.store.gather_without_secrets(locations).map_err(error)?;
            let text = crate::backup::write(&bundle).map_err(error)?;
            tracing::info!(callsigns = bundle.callsigns.len(), "callsigns backed up");
            Ok(text.into_bytes().into())
        }

        /// What a restore would do, without doing it (QGD-PSN-0009).
        #[napi]
        pub fn inspect_backup(&self, file: Buffer) -> Result<ImportPreview> {
            let text = std::str::from_utf8(file.as_ref()).map_err(|_| error("That file is not a backup this product wrote."))?;
            let bundle = crate::backup::read(text).map_err(error)?;
            let arriving = self.store.preview(&bundle).map_err(error)?;
            Ok(ImportPreview {
                created: bundle.created.clone(),
                callsigns: bundle.callsigns.len() as u32,
                arriving,
                here: self.store.labels().map_err(error)?,
                locations: if bundle.locations.is_null() { String::new() } else { bundle.locations.to_string() },
            })
        }

        #[napi]
        pub fn apply_backup(&self, file: Buffer, replace: bool) -> Result<ImportSummary> {
            let text = std::str::from_utf8(file.as_ref()).map_err(|_| error("That file is not a backup this product wrote."))?;
            let bundle = crate::backup::read(text).map_err(error)?;
            let callsigns = self.store.absorb(&bundle, replace).map_err(error)?;
            tracing::info!(callsigns, "callsigns restored");
            Ok(ImportSummary { callsigns: callsigns as u32, locations: if bundle.locations.is_null() { String::new() } else { bundle.locations.to_string() } })
        }
        // Available to the trusted native owner for future grant enforcement and
        // interop proof. The app's broker never exposes this method to renderers.
        #[napi]
        pub fn require_credential(&self, id: String, provider: String, prefer: Option<String>) -> Result<CredentialInput> {
            let profile = self.store.lookup(&id).map_err(error)?;
            if !profile.providers.contains_key(&identifier(&provider).map_err(error)?) { return Err(error("This callsign has no profile for this service.")); }
            let creds = self.store.read_credentials(&id, &provider).map_err(error)?.ok_or_else(|| error("No credential is stored."))?;
            if creds.username.as_ref().is_none_or(String::is_empty) { return Err(error("No username is stored.")); }
            let saved_preference = self.store.preference(&id, &provider).map_err(error)?;
            let preference = prefer.as_deref().or(if saved_preference == "service" { None } else { Some(&saved_preference) });
            let selected = selected_secret(&provider, &creds, preference).map_err(error)?;
            Ok(CredentialInput { username: creds.username.clone(), password: Some(selected.to_owned()), api_key: None })
        }
    }
}

#[cfg(test)]
mod tests {
    // QGD-CRD-0003, and the defect it failed to catch for nine Parts.
    //
    // The service constant said "adif-mcp" — the MCP servers' namespace — long
    // after KI7MT ended MCP interoperability (QGD-CRD-0004). The requirement
    // said the core owns its entry names; the code named someone else's; and
    // no test compared them. A requirement whose Verify column says Test needs
    // a test that fails when the code disagrees with it.
    #[test]
    fn the_core_owns_its_keychain_service_and_never_another_product_s() {
        // Not merely "not adif-mcp": the names are asserted, so renaming one by
        // accident is a failure rather than a silent change of namespace.
        assert_eq!(SERVICE, "io.qso-graph.desktop");
        assert_eq!(TEST_SERVICE, "io.qso-graph.desktop.test");

        // Neither is any other product's. adif-mcp is written out here, in a
        // test, because this is the one place naming it is the point.
        for name in [SERVICE, TEST_SERVICE] {
            assert_ne!(name, "adif-mcp", "the core is using the MCP servers' namespace");
            assert!(name.starts_with("io.qso-graph.desktop"),
                "a service this core writes must be plainly this product's: {name}");
        }
        assert_ne!(SERVICE, TEST_SERVICE, "fixtures would land beside real credentials");
    }

    #[test]
    fn test_mode_is_selected_but_never_supplied() {
        // The env var chooses between two compiled-in names. If it supplied a
        // name, anything outside this process could point the core at
        // "adif-mcp" — or at any other product's namespace — and the checks
        // above would be worth nothing.
        let source = include_str!("lib.rs");
        let selector = source
            .lines()
            .find(|line| line.contains("QG_DESKTOP_TEST_KEYCHAIN"))
            .expect("the test-mode selector must exist");
        assert!(selector.contains("var_os"),
            "the selector must test for presence, not read a value: {selector}");
        assert!(!selector.contains("unwrap_or") && !selector.contains("var("),
            "the service name must not come from the environment: {selector}");
    }

    use super::*;
    #[test]
    fn a_callsign_has_a_permanent_random_id_and_its_call_and_description_change() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let home = store.create(" w1aw ", " Home ", Some("2026-01-01".into()), None).unwrap();
        assert_eq!((home.call.as_str(), home.description.as_str()), ("W1AW", "Home"));
        assert!(callsign_id(&home.id).is_ok(), "{} is a version 4 UUID", home.id);
        // The same call twice is two callsigns, with two ids.
        let portable = store.create("W1AW/P", "", None, None).unwrap();
        assert_ne!(home.id, portable.id);
        // Both the call and the description change; the id does not.
        let changed = store.update(&home.id, "K1ABC", "Home station", None, None).unwrap();
        assert_eq!((changed.id.as_str(), changed.call.as_str(), changed.description.as_str()), (home.id.as_str(), "K1ABC", "Home station"));
        assert_eq!(store.lookup(&home.id).unwrap().call, "K1ABC");
        let value: serde_json::Value = serde_json::from_slice(&fs::read(temp.path().join("callsigns.json")).unwrap()).unwrap();
        assert_eq!(value["callsigns"][&home.id]["description"], "Home station");
        assert_eq!(store.load().unwrap().callsigns.len(), 2);
        // Refused: dates out of order, a call that is not one, a description
        // on two lines, an id that is not one.
        assert!(store.update(&home.id, "K1ABC", "", Some("2026-02-01".into()), Some("2026-01-01".into())).is_err());
        assert!(store.create("W1 AW", "", None, None).is_err());
        assert!(store.create("W1AW", "a\nb", None, None).is_err());
        assert!(store.lookup("home").is_err());
        assert!(store.update("00000000-0000-1000-8000-000000000000", "W1AW", "", None, None).is_err());
    }
    #[test]
    fn ids_are_version_4_uuids_and_do_not_repeat() {
        let ids: std::collections::BTreeSet<String> = (0..1000).map(|_| new_callsign_id().unwrap()).collect();
        assert_eq!(ids.len(), 1000);
        for id in &ids { assert_eq!(callsign_id(id).unwrap(), *id); }
        assert!(callsign_id("6F9619FF-8B86-4D11-B42D-00C04FC964FF").is_err(), "uppercase is not how this core writes one");
        assert!(callsign_id("6f9619ff-8b86-1d11-b42d-00c04fc964ff").is_err(), "version 1 embeds the machine and the time");
    }
    #[test]
    fn credential_selection_matches_auth() {
        let creds = Credentials { username: Some("W1AW".into()), password: Some("fixture-password".into()), api_key: Some("fixture-key".into()) };
        assert!(selected_secret("QRZ_LOGBOOK", &creds, None).unwrap() == "fixture-key");
        for provider in ["qrz", "eqsl", "lotw", "hamqth"] { assert!(selected_secret(provider, &creds, None).unwrap() == "fixture-password"); }
        assert!(selected_secret("qrz", &creds, Some("api_key")).unwrap() == "fixture-key");
        assert!(selected_secret("qrz", &creds, Some("invalid")).is_err());
    }
    #[test]
    fn naming_contract_and_boundaries() {
        // An entry's name is the callsign's id and the service: nothing the
        // operator typed.
        let id = new_callsign_id().unwrap();
        assert_eq!(subject(&id, "QRZ_LOGBOOK").unwrap(), format!("{id}:qrz_logbook"));
        assert!(subject("home", "qrz").is_err());
        assert!(subject(&format!("{id}:qrz"), "qrz").is_err());
        assert!(subject("", "qrz").is_err());
    }
    // QGD-INV-0004 (KI7MT, 2026-10-23): no username in the profile file. One
    // an earlier build wrote there is read as "a username is saved" and the
    // file is written again at once without it.
    #[test]
    fn a_backup_carries_which_callsign_is_active_and_a_restore_brings_it_back() {
        let from = tempfile::tempdir().unwrap();
        let store = Store::new(from.path().into()).unwrap();
        let old = store.create("KE1HA", "Previous", Some("1995-01-01".into()), Some("2001-01-01".into())).unwrap().id;
        let current = store.create("KI7MT", "Current", Some("2015-01-01".into()), None).unwrap().id;
        atomic_write(&from.path().join("current.txt"), current.as_bytes()).unwrap();
        let bundle = store.gather_without_secrets(serde_json::Value::Null).unwrap();
        assert_eq!(bundle.active.as_deref(), Some(current.as_str()));

        let to = tempfile::tempdir().unwrap();
        let restored = Store::new(to.path().into()).unwrap();
        assert_eq!(restored.absorb(&bundle, false).unwrap(), 2);
        assert_eq!(restored.active_id().unwrap().as_deref(), Some(current.as_str()));
        assert!(restored.lookup(&old).is_ok());

        // A backup naming a callsign it does not hold leaves none active.
        let mut stray = bundle;
        stray.active = Some("00000000-0000-4000-8000-000000000000".into());
        let other = tempfile::tempdir().unwrap();
        let elsewhere = Store::new(other.path().into()).unwrap();
        elsewhere.absorb(&stray, false).unwrap();
        assert!(elsewhere.active_id().unwrap().is_none());
    }

    #[test]
    fn a_username_an_earlier_build_kept_is_taken_out_of_the_file() {
        let temp = tempfile::tempdir().unwrap();
        let id = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
        let old = format!(r#"{{"callsigns":{{"{id}":{{"id":"{id}","call":"W1AW","description":"Home","start":null,"end":null,"providers":{{"clublog":{{"username":"qg_fake_person@example.invalid","has_password":true,"has_api_key":false,"saved_at":"2026-10-22T00:00:00Z"}}}}}}}}}}"#);
        fs::write(temp.path().join("callsigns.json"), old).unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let index = store.load().unwrap();
        assert!(index.callsigns[id].providers["clublog"].has_username);
        let written = fs::read_to_string(temp.path().join("callsigns.json")).unwrap();
        assert!(!written.contains("qg_fake_person"), "the username is still in the file");
        assert!(!written.contains("\"username\""), "the field is still in the file");
        assert!(written.contains("has_username"));
    }

    #[test]
    fn failed_keychain_deletion_preserves_callsign_and_selection_for_retry() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let portable = store.create("KI7MT", "Portable", None, None).unwrap().id;
        let home = store.create("W1AW", "Home", None, None).unwrap().id;
        store.set_preference(&portable, "qrz", "password").unwrap();
        atomic_write(&temp.path().join("current.txt"), portable.as_bytes()).unwrap();
        let before = fs::read(temp.path().join("callsigns.json")).unwrap();
        let prefs_before = fs::read(temp.path().join("desktop-preferences.json")).unwrap();
        let mut calls = 0;
        let result = store.remove_callsign_using(&portable, |id, _provider| {
            assert_eq!(id, portable);
            calls += 1;
            if calls == 2 { Err("Synthetic Keychain refusal.") } else { Ok(true) }
        });
        assert!(result.is_err());
        assert_eq!(fs::read(temp.path().join("callsigns.json")).unwrap(), before);
        assert_eq!(fs::read(temp.path().join("desktop-preferences.json")).unwrap(), prefs_before);
        assert_eq!(fs::read_to_string(temp.path().join("current.txt")).unwrap(), portable);
        store.remove_callsign_using(&portable, |_id, _provider| Ok(false)).unwrap();
        assert!(store.lookup(&portable).is_err());
        assert!(store.lookup(&home).is_ok());
        assert!(!temp.path().join("current.txt").exists());
    }
}
