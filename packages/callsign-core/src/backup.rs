// SPDX-License-Identifier: GPL-3.0-only
// Moving callsigns and Locations between computers, as a plain file.
//
// QGD-PSN-0007 to QGD-PSN-0011. KI7MT, 2026-10-23: "we don't store anything
// that's not publicly available", and a login never moves. What this file
// holds is public: each callsign (its licensing authority publishes it), the
// services each one uses with nothing of its login, its preferences, and the
// Locations, whose places are no closer than a grid square and whose notes
// stay behind. Nothing in it needs keeping secret, so it is not encrypted: a
// passphrase would only be one more thing to lose. It is JSON an operator can
// read, written where they choose and sent nowhere.
//
//   {"format":"qso-graph-desktop-backup","version":1,"created":"…",
//    "callsigns":[…],"preferences":{…},"locations":{…}}
//
// Read whole and checked before anything changes: the shape here, every
// callsign field as if typed (absorb, lib.rs), the Locations by QG Storage.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const FORMAT: &str = "qso-graph-desktop-backup";
// 2 adds which callsign is active (KI7MT, 2026-10-24: it did not come over).
// A version 1 file is still read; a build that knows only 1 says a version 2
// file is from a different version rather than calling it broken.
pub const VERSION: u32 = 2;
const READS: [u32; 2] = [1, 2];

// What a file may be, to be read at all: a few hundred callsigns and five
// hundred Locations are well inside it.
pub const MAX_FILE: usize = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Backup {
    pub format: String,
    pub version: u32,
    pub created: String,
    pub callsigns: Vec<crate::Callsign>,
    // Which secret each service prefers, by callsign id: a setting, not a
    // secret.
    #[serde(default)]
    pub preferences: BTreeMap<String, BTreeMap<String, String>>,
    // The Locations, as QG Storage handed them over and will take them back.
    #[serde(default)]
    pub locations: serde_json::Value,
    // The active callsign's id, if one is (version 2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
}

pub fn write(backup: &Backup) -> Result<String, &'static str> {
    serde_json::to_string_pretty(backup).map_err(|_| "The backup could not be written.")
}

pub fn read(text: &str) -> Result<Backup, &'static str> {
    if text.len() > MAX_FILE { return Err("That file is larger than a backup this product writes."); }
    // An encrypted file from a build before 2026-10-23 starts with its name,
    // not with JSON: said as such rather than as a broken file.
    if text.starts_with("QGD-CALLSIGN-EXPORT") {
        return Err("That is an encrypted export from an earlier build, which this one does not read. Back up again from that computer.");
    }
    let backup: Backup = serde_json::from_str(text).map_err(|_| "That file is not a backup this product wrote.")?;
    if backup.format != FORMAT { return Err("That file is not a backup this product wrote."); }
    if !READS.contains(&backup.version) { return Err("That backup was written by a different version of QSO Graph Desktop."); }
    if !(backup.locations.is_null() || backup.locations.is_object()) { return Err("That file's Locations are not the shape a backup has."); }
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";

    fn backup() -> Backup {
        Backup {
            format: FORMAT.into(), version: VERSION, created: "2026-10-23T00:00:00Z".into(),
            callsigns: vec![crate::Callsign {
                id: ID.into(), call: "W1AW".into(), description: "Home".into(),
                start: Some("2026-01-01".into()), end: None, providers: Default::default(),
            }],
            preferences: Default::default(),
            locations: serde_json::json!({ "stations": [{ "name": "Camp", "place": { "MY_GRIDSQUARE": "DN13" } }], "defaults": {}, "active": null }),
            active: Some(ID.into()),
        }
    }

    #[test]
    fn round_trips_as_plain_json() {
        let text = write(&backup()).unwrap();
        assert!(text.contains("\"W1AW\"") && text.contains("\"DN13\""), "a backup is readable");
        let read = read(&text).unwrap();
        assert_eq!(read.callsigns[0].call, "W1AW");
        assert_eq!(read.locations["stations"][0]["name"], "Camp");
        assert_eq!(read.active.as_deref(), Some(ID), "which callsign is active comes back");
    }

    #[test]
    fn a_version_1_backup_is_still_read_with_no_active_callsign() {
        let mut first = backup();
        first.version = 1;
        first.active = None;
        let read = read(&write(&first).unwrap()).unwrap();
        assert_eq!(read.version, 1);
        assert!(read.active.is_none());
    }

    #[test]
    fn refuses_what_it_did_not_write() {
        assert!(read("hello").is_err());
        assert!(read(&write(&backup()).unwrap().replace(FORMAT, "something-else")).is_err());
        assert!(read(&write(&backup()).unwrap().replace("\"version\": 2", "\"version\": 3")).err().unwrap().contains("different version"));
        // A field it does not know: a secret could not ride in on one.
        assert!(read(&write(&backup()).unwrap().replacen("{", "{\"credentials\":{},", 1)).is_err());
        assert!(read("QGD-CALLSIGN-EXPORT\n{}").err().unwrap().contains("earlier build"));
        assert!(read(&"x".repeat(MAX_FILE + 1)).is_err());
    }
}
