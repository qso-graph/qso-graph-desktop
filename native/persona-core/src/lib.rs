// SPDX-License-Identifier: GPL-3.0-only
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const SERVICE: &str = "adif-mcp";
mod corelog;
mod validation;
type CoreResult<T> = std::result::Result<T, &'static str>;

#[derive(Default, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "addon", napi_derive::napi(object))]
pub struct ProviderRef {
    pub username: String,
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

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "addon", napi_derive::napi(object))]
pub struct Persona {
    pub name: String,
    pub callsign: String,
    pub start: Option<String>,
    pub end: Option<String>,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderRef>,
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    personas: BTreeMap<String, Persona>,
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
    personas: BTreeMap<String, BTreeMap<String, String>>,
}

fn identifier(value: &str) -> CoreResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || value.contains(':') || value.chars().any(char::is_control) {
        return Err("Use a non-empty name without colons or control characters.");
    }
    Ok(value.to_lowercase())
}

fn subject(persona: &str, provider: &str) -> CoreResult<String> {
    Ok(format!("{}:{}", identifier(persona)?, identifier(provider)?))
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

impl Store {
    fn new(directory: PathBuf) -> CoreResult<Self> {
        fs::create_dir_all(&directory).map_err(|_| "Profile directory could not be created.")?;
        Ok(Self { directory })
    }
    fn load(&self) -> CoreResult<Index> {
        let path = self.directory.join("personas.json");
        match fs::read(path) {
            Ok(bytes) if bytes.len() <= 4_000_000 => serde_json::from_slice(&bytes).map_err(|_| "The persona index could not be read. It has not been changed."),
            Ok(_) => Err("The persona index exceeds the supported size."),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Index::default()),
            Err(_) => Err("The persona index could not be read. It has not been changed."),
        }
    }
    fn save(&self, index: &Index) -> CoreResult<()> {
        let bytes = serde_json::to_vec_pretty(index).map_err(|_| "Profile could not be saved.")?;
        atomic_write(&self.directory.join("personas.json"), &bytes)
    }
    fn lookup(&self, name: &str) -> CoreResult<Persona> {
        let name = identifier(name)?;
        self.load()?.personas.into_iter().find(|(key, value)| key.to_lowercase() == name || value.name.to_lowercase() == name).map(|(_, value)| value).ok_or("Persona not found.")
    }
    fn upsert(&self, name: &str, callsign: &str, start: Option<String>, end: Option<String>) -> CoreResult<Persona> {
        let name = identifier(name)?;
        let callsign = callsign.trim().to_uppercase();
        if callsign.is_empty() || callsign.len() > 64 || callsign.chars().any(char::is_control) { return Err("Enter a callsign."); }
        let parse = |value: &Option<String>| -> CoreResult<Option<NaiveDate>> {
            value.as_ref().map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "Use YYYY-MM-DD for dates.")).transpose()
        };
        let (first, last) = (parse(&start)?, parse(&end)?);
        if matches!((first, last), (Some(a), Some(b)) if b < a) { return Err("End date must not precede start date."); }
        let mut index = self.load()?;
        let providers = index.personas.get(&name).map(|persona| persona.providers.clone()).unwrap_or_default();
        let persona = Persona { name: name.clone(), callsign, start, end, providers };
        index.personas.insert(name, persona.clone());
        self.save(&index)?;
        Ok(persona)
    }
    fn entry(&self, persona: &str, provider: &str) -> CoreResult<keyring::Entry> {
        self.lookup(persona)?;
        keyring::Entry::new(SERVICE, &subject(persona, provider)?).map_err(|_| "Keychain is unavailable.")
    }
    // Does the Keychain hold an entry for this, without reading it?
    //
    // The attributes of an item are not behind its access control; the data is.
    // Asking for attributes and deliberately not asking for data is what makes
    // this silent — a read of the secret is what raises the login-keychain
    // prompt (QGD-CRD-0009).
    #[cfg(target_os = "macos")]
    fn entry_exists(&self, persona: &str, provider: &str) -> CoreResult<bool> {
        use security_framework::item::{ItemClass, ItemSearchOptions};
        let account = subject(persona, provider)?;
        let found = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(SERVICE)
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

    #[cfg(not(target_os = "macos"))]
    fn entry_exists(&self, persona: &str, provider: &str) -> CoreResult<bool> {
        match self.entry(persona, provider)?.get_attributes() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err("Keychain could not be asked about this credential."),
        }
    }

    // Records what was stored, which is not a secret, so the status display
    // never has to decrypt anything to answer.
    fn record_kinds(&self, persona: &str, provider: &str, creds: &Credentials) -> CoreResult<()> {
        let persona = identifier(persona)?;
        let provider = identifier(provider)?;
        let mut index = self.load()?;
        let profile = index.personas.get_mut(&persona).ok_or("Persona not found.")?;
        let reference = profile.providers.entry(provider).or_insert_with(ProviderRef::default);
        reference.username = creds.username.clone().unwrap_or_default();
        reference.has_password = creds.password.as_ref().is_some_and(|s| !s.is_empty());
        reference.has_api_key = creds.api_key.as_ref().is_some_and(|s| !s.is_empty());
        reference.saved_at = Some(now_utc());
        self.save(&index)
    }

    fn forget_kinds(&self, persona: &str, provider: &str) -> CoreResult<()> {
        let Ok(persona) = identifier(persona) else { return Ok(()); };
        let Ok(provider) = identifier(provider) else { return Ok(()); };
        let mut index = self.load()?;
        if let Some(profile) = index.personas.get_mut(&persona) {
            profile.providers.remove(&provider);
            return self.save(&index);
        }
        Ok(())
    }

    fn read_credentials(&self, persona: &str, provider: &str) -> CoreResult<Option<Credentials>> {
        let entry = self.entry(persona, provider)?;
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
                let _ = self.record_kinds(persona, provider, &creds);
                Ok(Some(creds))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Keychain could not read this credential."),
        }
    }
    fn save_credentials(&self, persona: &str, provider: &str, credentials: Credentials) -> CoreResult<()> {
        if credentials.username.as_ref().is_some_and(|s| s.len() > 4096) || credentials.password.as_ref().is_some_and(|s| s.len() > 4096) || credentials.api_key.as_ref().is_some_and(|s| s.len() > 4096) { return Err("Credential exceeds the supported size."); }
        if credentials.password.as_ref().is_none_or(String::is_empty) && credentials.api_key.as_ref().is_none_or(String::is_empty) { return Err("Enter a password or API key."); }
        let persona = identifier(persona)?;
        let provider = identifier(provider)?;
        let mut merged = self.read_credentials(&persona, &provider)?.unwrap_or_default();
        if let Some(value) = credentials.username.as_ref() { merged.username = Some(value.clone()); }
        if let Some(value) = credentials.password.as_ref() { merged.password = Some(value.clone()); }
        if let Some(value) = credentials.api_key.as_ref() { merged.api_key = Some(value.clone()); }
        // Register a non-secret provider ref, matching PersonaStore. Credentials
        // remain exclusively in Keychain; its payload never enters the index.
        let mut index = self.load()?;
        let profile = index.personas.get_mut(&persona).ok_or("Persona not found.")?;
        profile.providers.entry(provider.clone()).or_default();
        self.save(&index)?;
        let raw = Zeroizing::new(serde_json::to_string(&merged).map_err(|_| "Credential could not be encoded.")?);
        let result = self.entry(&persona, &provider)?.set_password(&raw).map_err(|_| "Keychain could not save this credential.");
        // Recorded only once the Keychain has it, so the index never claims a
        // credential that was not written (QGD-CRD-0010).
        if result.is_ok() { self.record_kinds(&persona, &provider, &merged)?; }
        // QGD-LOG-0004: the provider and the outcome. Never the value, never
        // the persona's own name.
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
    fn preference(&self, persona: &str, provider: &str) -> CoreResult<String> {
        let prefs = self.preferences()?;
        let preference = prefs.personas.get(&identifier(persona)?).and_then(|p| p.get(&identifier(provider).ok()?)).cloned().unwrap_or_else(|| "service".into());
        if !["service", "password", "api_key"].contains(&preference.as_str()) { return Err("Credential preference is invalid."); }
        Ok(preference)
    }
    fn set_preference(&self, persona: &str, provider: &str, preference: &str) -> CoreResult<()> {
        self.lookup(persona)?;
        if !["service", "password", "api_key"].contains(&preference) { return Err("Credential preference is invalid."); }
        let mut prefs = self.preferences()?;
        prefs.personas.entry(identifier(persona)?).or_default().insert(identifier(provider)?, preference.into());
        let bytes = serde_json::to_vec_pretty(&prefs).map_err(|_| "Profile could not be saved.")?;
        atomic_write(&self.directory.join("desktop-preferences.json"), &bytes)
    }
    fn delete_credentials(&self, persona: &str, provider: &str) -> CoreResult<bool> {
        self.lookup(persona)?;
        #[cfg(target_os = "macos")]
        match security_framework::passwords::delete_generic_password(SERVICE, &subject(persona, provider)?) {
            Ok(()) => {
                tracing::info!(provider = %provider, "credential removed");
                // The index must not go on describing an entry that is gone.
                self.forget_kinds(persona, provider)?;
                Ok(true)
            }
            Err(e) if e.code() == -25300 => { self.forget_kinds(persona, provider)?; Ok(false) }
            Err(_) => {
                tracing::warn!(provider = %provider, "keychain refused to remove a credential");
                Err("Keychain could not remove this credential.")
            }
        }
        #[cfg(not(target_os = "macos"))]
        match self.entry(persona, provider)?.delete_credential() {
            Ok(()) => Ok(true), Err(keyring::Error::NoEntry) => Ok(false),
            Err(_) => Err("Keychain could not remove this credential."),
        }
    }
    fn remove_secret(&self, persona: &str, provider: &str, field: &str) -> CoreResult<()> {
        if !["password", "api_key"].contains(&field) { return Err("Secret field is invalid."); }
        let Some(mut creds) = self.read_credentials(persona, provider)? else { return Ok(()); };
        let removed = if field == "password" { creds.password.take() } else { creds.api_key.take() };
        let _removed = Zeroizing::new(removed);
        if creds.password.as_ref().is_none_or(String::is_empty) && creds.api_key.as_ref().is_none_or(String::is_empty) {
            self.delete_credentials(persona, provider)?;
        } else {
            let raw = Zeroizing::new(serde_json::to_string(&creds).map_err(|_| "Credential could not be encoded.")?);
            self.entry(persona, provider)?.set_password(&raw).map_err(|_| "Keychain could not save this credential.")?;
            self.record_kinds(persona, provider, &creds)?;
        }
        Ok(())
    }
    fn remove_persona(&self, name: &str) -> CoreResult<()> {
        self.remove_persona_using(name, |persona, provider| self.delete_credentials(persona, provider))
    }
    fn remove_persona_using<F>(&self, name: &str, mut delete: F) -> CoreResult<()>
    where F: FnMut(&str, &str) -> CoreResult<bool> {
        let name = identifier(name)?;
        let profile = self.lookup(&name)?;
        let mut index = self.load()?;
        let mut prefs = self.preferences()?;
        let mut providers = std::collections::BTreeSet::new();
        for provider in profile.providers.keys().chain(prefs.personas.get(&name).into_iter().flat_map(|p| p.keys())) {
            providers.insert(identifier(provider)?);
        }
        // Also cover supported providers whose ref may be absent in a legacy
        // index. Every account remains scoped to this exact persona.
        for provider in ["qrz", "qrz_logbook", "eqsl", "lotw", "hamqth", "clublog"] { providers.insert(provider.into()); }
        let current_path = self.directory.join("current.txt");
        let current = match fs::read_to_string(&current_path) {
            Ok(value) => Some(value),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("Active persona could not be read."),
        };
        for provider in providers {
            delete(&name, &provider).map_err(|_| "Persona was not removed because Keychain could not delete a credential. Some credentials may already be removed; retry to finish.")?;
        }
        prefs.personas.remove(&name);
        let bytes = serde_json::to_vec_pretty(&prefs).map_err(|_| "Profile could not be saved.")?;
        atomic_write(&self.directory.join("desktop-preferences.json"), &bytes)?;
        if current.as_ref().is_some_and(|value| value.trim().to_lowercase() == name) {
            fs::remove_file(current_path).map_err(|_| "Active persona could not be cleared.")?;
        }
        index.personas.retain(|key, profile| key.to_lowercase() != name && profile.name.to_lowercase() != name);
        self.save(&index)
    }
    // QGD-CRD-0009: nothing here reads a secret.
    //
    // It used to. Opening the application selected the remembered persona,
    // which asked for this, which decrypted the entry — and macOS asked the
    // operator for the login keychain password before he had done anything at
    // all. Everything this reports is either in the index, where it was
    // written when the credential was saved, or is the existence of the entry,
    // which the Keychain will answer from attributes without unlocking data.
    fn status(&self, persona: &str, provider: &str) -> CoreResult<CredentialStatus> {
        self.lookup(persona)?;
        let provider = identifier(provider)?;
        let reference = self.lookup(persona)?.providers.get(&provider).cloned();
        let exists = self.entry_exists(persona, &provider)?;
        let preferred = self.preference(persona, &provider)?;

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
            stored: exists,
            kinds_known: !exists || known,
            has_username: exists && reference.as_ref().is_some_and(|r| !r.username.is_empty()),
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
    pub struct PersonaCore { store: Store, tests: std::collections::BTreeMap<String, std::time::Instant> }

    #[napi(object)]
    pub struct CredentialTest { pub outcome: String }

    #[napi]
    impl PersonaCore {
        #[napi(constructor)]
        pub fn new(directory: String) -> Result<Self> { Ok(Self { store: Store::new(directory.into()).map_err(error)?, tests: Default::default() }) }
        #[napi]
        pub fn test_credential(&mut self, persona: String, provider: String) -> Result<CredentialTest> {
            self.store.lookup(&persona).map_err(error)?;
            let provider = identifier(&provider).map_err(error)?;
            let outcome = if !validation::supported(&provider) { "unsupported" }
            else if self.tests.get(&provider).is_some_and(|until| std::time::Instant::now() < *until) { "rate-limited" }
            else {
                let preference = self.store.preference(&persona, &provider).map_err(error)?;
                let creds = self.store.read_credentials(&persona, &provider).map_err(error)?;
                match creds {
                    Some(creds) if creds.username.as_ref().is_some_and(|s| !s.is_empty()) => {
                        self.tests.insert(provider.clone(), std::time::Instant::now() + std::time::Duration::from_secs(30));
                        let result = validation::test(&provider, &creds, if preference == "service" { None } else { Some(&preference) }).map_err(error)?;
                        tracing::info!(provider = %provider, outcome = %result, "credential tested");
                        if matches!(result, "rejected" | "rate-limited") {
                            self.tests.insert(provider.clone(), std::time::Instant::now() + std::time::Duration::from_secs(300));
                        }
                        result
                    }
                    _ => "missing",
                }
            };
            Ok(CredentialTest { outcome: outcome.into() })
        }
        #[napi]
        pub fn list(&self) -> Result<Vec<Persona>> { Ok(self.store.load().map_err(error)?.personas.into_values().collect()) }
        #[napi]
        pub fn upsert(&self, name: String, callsign: String, start: Option<String>, end: Option<String>) -> Result<Persona> { self.store.upsert(&name, &callsign, start, end).map_err(error) }
        #[napi]
        pub fn set_active(&self, name: String) -> Result<()> {
            let persona = self.store.lookup(&name).map_err(error)?;
            atomic_write(&self.store.directory.join("current.txt"), persona.name.as_bytes()).map_err(error)
        }
        #[napi]
        pub fn active(&self) -> Result<Option<String>> {
            let path = self.store.directory.join("current.txt");
            match fs::read_to_string(path) {
                Ok(name) => Ok(self.store.lookup(name.trim()).ok().map(|p| p.name)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(_) => Err(error("Active persona could not be read.")),
            }
        }
        #[napi]
        pub fn save_credentials(&self, persona: String, provider: String, credentials: CredentialInput) -> Result<()> {
            let credentials = Credentials {
                username: credentials.username.filter(|s| !s.is_empty()),
                password: credentials.password.filter(|s| !s.is_empty()),
                api_key: credentials.api_key.filter(|s| !s.is_empty()),
            };
            self.store.save_credentials(&persona, &provider, credentials).map_err(error)
        }
        #[napi]
        pub fn credential_status(&self, persona: String, provider: String) -> Result<CredentialStatus> { self.store.status(&persona, &provider).map_err(error) }
        #[napi]
        pub fn delete_credentials(&self, persona: String, provider: String) -> Result<bool> {
            self.store.delete_credentials(&persona, &provider).map_err(error)
        }
        #[napi]
        pub fn remove_secret(&self, persona: String, provider: String, field: String) -> Result<()> {
            self.store.remove_secret(&persona, &provider, &field).map_err(error)
        }
        #[napi]
        pub fn set_preference(&self, persona: String, provider: String, preference: String) -> Result<()> {
            self.store.set_preference(&persona, &provider, &preference).map_err(error)
        }
        #[napi]
        pub fn remove_persona(&self, name: String) -> Result<()> {
            self.store.remove_persona(&name).map_err(error)
        }
        // Available to the trusted native owner for future grant enforcement and
        // interop proof. The app's broker never exposes this method to renderers.
        #[napi]
        pub fn require_credential(&self, persona: String, provider: String, prefer: Option<String>) -> Result<CredentialInput> {
            let profile = self.store.lookup(&persona).map_err(error)?;
            if !profile.providers.contains_key(&identifier(&provider).map_err(error)?) { return Err(error("Persona has no reference for this provider.")); }
            let creds = self.store.read_credentials(&persona, &provider).map_err(error)?.ok_or_else(|| error("No credential is stored."))?;
            if creds.username.as_ref().is_none_or(String::is_empty) { return Err(error("No username is stored.")); }
            let saved_preference = self.store.preference(&persona, &provider).map_err(error)?;
            let preference = prefer.as_deref().or(if saved_preference == "service" { None } else { Some(&saved_preference) });
            let selected = selected_secret(&provider, &creds, preference).map_err(error)?;
            Ok(CredentialInput { username: creds.username.clone(), password: Some(selected.to_owned()), api_key: None })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn auth_compatible_records_and_dates() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let persona = store.upsert("Home", "w1aw", Some("2026-01-01".into()), None).unwrap();
        assert_eq!(persona.name, "home");
        assert_eq!(store.lookup("HOME").unwrap().callsign, "W1AW");
        assert!(store.upsert("Home", "W1AW", Some("2026-02-01".into()), Some("2026-01-01".into())).is_err());
        let value: serde_json::Value = serde_json::from_slice(&fs::read(temp.path().join("personas.json")).unwrap()).unwrap();
        assert_eq!(value["personas"]["home"]["callsign"], "W1AW");
        assert_eq!(store.load().unwrap().personas.len(), 1);
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
        assert_eq!(subject("Home", "QRZ_LOGBOOK").unwrap(), "home:qrz_logbook");
        assert!(subject("home:qrz", "qrz").is_err());
        assert!(subject("", "qrz").is_err());
    }
    #[test]
    fn failed_keychain_deletion_preserves_persona_and_selection_for_retry() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        store.upsert("portable", "KI7MT", None, None).unwrap();
        store.upsert("home", "W1AW", None, None).unwrap();
        store.set_preference("portable", "qrz", "password").unwrap();
        atomic_write(&temp.path().join("current.txt"), b"portable").unwrap();
        let before = fs::read(temp.path().join("personas.json")).unwrap();
        let prefs_before = fs::read(temp.path().join("desktop-preferences.json")).unwrap();
        let mut calls = 0;
        let result = store.remove_persona_using("portable", |persona, _provider| {
            assert_eq!(persona, "portable");
            calls += 1;
            if calls == 2 { Err("Synthetic Keychain refusal.") } else { Ok(true) }
        });
        assert!(result.is_err());
        assert_eq!(fs::read(temp.path().join("personas.json")).unwrap(), before);
        assert_eq!(fs::read(temp.path().join("desktop-preferences.json")).unwrap(), prefs_before);
        assert_eq!(fs::read_to_string(temp.path().join("current.txt")).unwrap(), "portable");
        store.remove_persona_using("portable", |_persona, _provider| Ok(false)).unwrap();
        assert!(store.lookup("portable").is_err());
        assert!(store.lookup("home").is_ok());
        assert!(!temp.path().join("current.txt").exists());
    }
}
