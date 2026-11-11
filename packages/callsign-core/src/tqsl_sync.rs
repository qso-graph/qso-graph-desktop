// SPDX-License-Identifier: GPL-3.0-or-later
// QGD-STN-0013, QGD-LTW-0008: public place fields only; no retained TQSL link.
use qso_graph_trust::{station::StationLocation, tqsl_locations};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

const PLACE_FIELDS: &[&str] = &[
    "MY_GRIDSQUARE",
    "MY_VUCC_GRIDS",
    "MY_ALTITUDE",
    "MY_DXCC",
    "MY_CQ_ZONE",
    "MY_ITU_ZONE",
    "MY_STATE",
    "MY_CNTY",
    "MY_ARRL_SECT",
    "MY_POTA_REF",
    "MY_SOTA_REF",
    "MY_WWFF_REF",
    "MY_IOTA",
];
// The Location fields signing reads (`StationLocation::from_adif`). The rest, such as
// MY_POTA_REF or MY_ALTITUDE, TQSL cannot hold, so they are never a difference with it.
pub(crate) const SIGNED_FIELDS: &[&str] = &[
    "MY_GRIDSQUARE",
    "MY_VUCC_GRIDS",
    "MY_DXCC",
    "MY_CQ_ZONE",
    "MY_ITU_ZONE",
    "MY_STATE",
    "MY_CNTY",
    "MY_IOTA",
];

const REFUSED: &str = "TQSL's station locations could not be read from its folder. The file must be plain or gzip, at most 16 MiB.";
const ROUND_TRIP: &str =
    "These fields cannot make a Desktop Location that signs exactly as this TQSL location does.";

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    SyncInspect { existing: Vec<Existing> },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Existing {
    name: String,
    place: BTreeMap<String, String>,
    park: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub name: String,
    pub place: BTreeMap<String, String>,
    pub park: String,
    pub reason: String,
}
#[derive(Serialize)]
pub struct Difference {
    field: String,
    tqsl: Option<String>,
    stored: Option<String>,
}
#[derive(Serialize)]
pub struct Entry {
    #[serde(flatten)]
    pub location: Location,
    pub status: &'static str,
    pub differences: Vec<Difference>,
}
#[derive(Serialize)]
pub struct Preview {
    folder: String,
    locations: Vec<Entry>,
}

// Restore and Sync share this conversion and its exact equality check. QG Trust
// owns station validation in both directions, including fields we cannot hold.
pub fn location(name: &str, station: &StationLocation) -> Location {
    let mut place = BTreeMap::new();
    let mut park = String::new();
    for (field, value) in station.fields() {
        let target = match field {
            "DXCC" => "MY_DXCC",
            "CQZ" => "MY_CQ_ZONE",
            "ITUZ" => "MY_ITU_ZONE",
            "IOTA" => "MY_IOTA",
            "US_STATE" | "CA_PROVINCE" | "RU_OBLAST" | "CN_PROVINCE" | "AU_STATE"
            | "JA_PREFECTURE" | "FI_KUNTA" => "MY_STATE",
            "JA_CITY_GUN_KU" => "MY_CNTY",
            "US_COUNTY" => {
                place.insert(
                    "MY_CNTY".into(),
                    format!("{},{value}", station.get("US_STATE").unwrap_or_default()),
                );
                continue;
            }
            "GRIDSQUARE" => {
                let grid = value
                    .split(',')
                    .map(|g| {
                        g.chars()
                            .enumerate()
                            .map(|(i, c)| {
                                if (4..6).contains(&i) {
                                    c.to_ascii_lowercase()
                                } else {
                                    c.to_ascii_uppercase()
                                }
                            })
                            .collect::<String>()
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                place.insert(
                    if grid.contains(',') {
                        "MY_VUCC_GRIDS"
                    } else {
                        "MY_GRIDSQUARE"
                    }
                    .into(),
                    grid,
                );
                continue;
            }
            "US_PARK" | "CA_US_PARK" | "DX_US_PARK" => {
                park = value.into();
                continue;
            }
            _ => continue,
        };
        let value = match (field, value) {
            ("CA_PROVINCE", "PQ") => "QC",
            ("CA_PROVINCE", "NF") => "NL",
            ("RU_OBLAST", "JA") => "YR",
            ("RU_OBLAST", "JN") => "YN",
            _ => value,
        };
        place.insert(target.into(), value.into());
    }
    checked_location(name, station, place, park)
}
fn checked_location(
    name: &str,
    station: &StationLocation,
    place: BTreeMap<String, String>,
    park: String,
) -> Location {
    let fields: Vec<_> = place
        .iter()
        .map(|(n, v)| (n.as_str(), v.as_str()))
        .collect();
    let matches = StationLocation::from_adif(station.call(), &fields, Some(&park))
        .is_ok_and(|rebuilt| &rebuilt == station);
    Location {
        name: name.into(),
        place,
        park,
        reason: if matches {
            String::new()
        } else {
            ROUND_TRIP.into()
        },
    }
}

fn text(value: &str, limit: usize) -> bool {
    value.chars().count() <= limit
        && !value
            .chars()
            .any(|c| c.is_control() || c == '<' || c == '>')
}
impl Command {
    pub fn execute(self) -> crate::CoreResult<String> {
        let Self::SyncInspect { existing } = self;
        inspect(&tqsl_locations::default_folder(), &existing)
    }
}
fn inspect(folder: &Path, existing: &[Existing]) -> crate::CoreResult<String> {
    if existing.len() > 500
        || existing.iter().any(|s| {
            !text(&s.name, 64)
                || s.name.trim().is_empty()
                || s.place.len() > 13
                || !text(&s.park, 40)
                || s.place.iter().any(|(k, v)| {
                    !PLACE_FIELDS.contains(&k.as_str()) || !text(v, 100) || v.is_empty()
                })
        })
    {
        return Err("The Desktop Locations supplied for Sync were refused.");
    }
    let folder_name = folder.to_str().filter(|s| s.len() <= 4096).ok_or(REFUSED)?;
    let locations = tqsl_locations::read(folder)
        .map_err(|_| REFUSED)?
        .into_iter()
        .map(|l| {
            let (location, station) = match l.station {
                Ok(station) => (location(&l.name, &station), Some(station)),
                Err(reason) => (
                    Location {
                        name: l.name,
                        place: BTreeMap::new(),
                        park: String::new(),
                        reason,
                    },
                    None,
                ),
            };
            let mut status = if location.reason.is_empty() {
                "new"
            } else {
                "refused"
            };
            let mut differences = Vec::new();
            if status != "refused"
                && let Some(station) = &station
                && let Some(here) = existing
                    .iter()
                    .find(|s| s.name.to_lowercase() == location.name.to_lowercase())
            {
                // Same means it signs the same: QG Trust builds TQSL's exact station from
                // the Location's signed fields and park.
                let signed: Vec<_> = here
                    .place
                    .iter()
                    .filter(|(n, _)| SIGNED_FIELDS.contains(&n.as_str()))
                    .map(|(n, v)| (n.as_str(), v.as_str()))
                    .collect();
                let signs_same =
                    StationLocation::from_adif(station.call(), &signed, Some(&here.park))
                        .is_ok_and(|rebuilt| &rebuilt == station);
                let mut fields: Vec<_> = location
                    .place
                    .keys()
                    .chain(here.place.keys())
                    .filter(|n| !signs_same && SIGNED_FIELDS.contains(&n.as_str()))
                    .cloned()
                    .collect();
                fields.sort();
                fields.dedup();
                for field in fields {
                    let tqsl = location.place.get(&field).cloned();
                    let stored = here.place.get(&field).cloned();
                    if tqsl != stored {
                        differences.push(Difference {
                            field,
                            tqsl,
                            stored,
                        });
                    }
                }
                if !signs_same && location.park != here.park {
                    differences.push(Difference {
                        field: "lotwPark".into(),
                        tqsl: (!location.park.is_empty()).then(|| location.park.clone()),
                        stored: (!here.park.is_empty()).then(|| here.park.clone()),
                    });
                }
                status = if signs_same { "same" } else { "differs" };
            }
            Entry {
                location,
                status,
                differences,
            }
        })
        .collect();
    let reply = serde_json::to_string(&Preview {
        folder: folder_name.into(),
        locations,
    })
    .map_err(|_| REFUSED)?;
    if reply.len() > 4 * 1024 * 1024 {
        return Err(REFUSED);
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lotw::tests::corpus;
    fn standard() -> Vec<tqsl_locations::Location> {
        tqsl_locations::parse(&corpus("standard/tqsl/station_data")).unwrap()
    }
    fn preview(folder: &Path, existing: &[Existing]) -> serde_json::Value {
        serde_json::from_str(&inspect(folder, existing).unwrap()).unwrap()
    }
    #[test]
    fn standard_locations_round_trip_and_park_is_not_pota() {
        let locations = standard();
        assert!(!locations.is_empty());
        for l in &locations {
            let s = l.station.as_ref().unwrap();
            let mapped = location(&l.name, s);
            assert!(!mapped.place.contains_key("MY_POTA_REF"));
            assert!(mapped.reason.is_empty(), "{}: {}", l.name, mapped.reason);
            let fields: Vec<_> = mapped
                .place
                .iter()
                .map(|(n, v)| (n.as_str(), v.as_str()))
                .collect();
            assert_eq!(
                &StationLocation::from_adif(s.call(), &fields, Some(&mapped.park)).unwrap(),
                s
            );
        }
        let parked = locations
            .iter()
            .find(|l| l.station.as_ref().unwrap().get("US_PARK").is_some())
            .unwrap();
        let station = parked.station.as_ref().unwrap();
        let mapped = location(&parked.name, station);
        assert_eq!(mapped.park, station.get("US_PARK").unwrap());
        assert!(!mapped.place.contains_key("MY_POTA_REF"));
        assert!(mapped.reason.is_empty());
    }
    #[test]
    fn unrepresentable_station_is_refused_by_round_trip() {
        let s = standard().remove(0).station.unwrap();
        let mut mapped = location("test-only", &s);
        mapped.place.insert("MY_GRIDSQUARE".into(), "AA00".into());
        let refused = checked_location("test-only", &s, mapped.place, mapped.park);
        assert_eq!(refused.reason, ROUND_TRIP);
    }

    #[test]
    fn statuses_compare_what_signs_and_ignore_name_case() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("station_data"),
            corpus("standard/tqsl/station_data"),
        )
        .unwrap();
        let new = preview(tmp.path(), &[]);
        assert!(
            new["locations"]
                .as_array()
                .unwrap()
                .iter()
                .all(|l| l["status"] == "new")
        );
        let l = &standard()[0];
        let m = location(&l.name, l.station.as_ref().unwrap());
        let mut existing = vec![Existing {
            name: m.name.to_uppercase(),
            place: m.place,
            park: m.park,
        }];
        assert_eq!(
            preview(tmp.path(), &existing)["locations"][0]["status"],
            "same"
        );
        // Fields TQSL cannot hold, and a grid in another case, still sign the same.
        existing[0].place.insert("MY_ALTITUDE".into(), "100".into());
        existing[0]
            .place
            .insert("MY_POTA_REF".into(), "US-0001".into());
        if let Some(grid) = existing[0].place.get_mut("MY_GRIDSQUARE") {
            *grid = grid.to_uppercase();
        }
        assert_eq!(
            preview(tmp.path(), &existing)["locations"][0]["status"],
            "same"
        );
        // A different park or signed field differs, and only those are listed.
        existing[0].park = "NP01".into();
        existing[0].place.insert("MY_STATE".into(), "KS".into());
        let differs = preview(tmp.path(), &existing);
        assert_eq!(differs["locations"][0]["status"], "differs");
        let listed: Vec<_> = differs["locations"][0]["differences"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["field"].as_str().unwrap().to_string())
            .collect();
        assert!(listed.contains(&"lotwPark".to_string()), "{listed:?}");
        assert!(listed.contains(&"MY_STATE".to_string()), "{listed:?}");
        assert!(
            !listed
                .iter()
                .any(|f| f == "MY_ALTITUDE" || f == "MY_POTA_REF"),
            "{listed:?}"
        );
        // Only synthetic corpus data, with one field removed to exercise refusal.
        let data = String::from_utf8(corpus("tqsl/1024/tqsl/station_data")).unwrap();
        let start = data.find("<CALL>").unwrap();
        let end = data.find("</CALL>").unwrap() + 7;
        std::fs::write(
            tmp.path().join("station_data"),
            format!("{}{}", &data[..start], &data[end..]),
        )
        .unwrap();
        let refused = preview(tmp.path(), &[]);
        assert_eq!(refused["locations"][0]["status"], "refused");
        assert!(
            !refused["locations"][0]["reason"]
                .as_str()
                .unwrap()
                .is_empty()
        );
    }
    fn snapshot(dir: &Path) -> Vec<(std::path::PathBuf, u64, std::time::SystemTime)> {
        let mut files: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .flat_map(|e| {
                let e = e.unwrap();
                let m = e.metadata().unwrap();
                let mut entries = vec![(e.path(), m.len(), m.modified().unwrap())];
                if m.is_dir() {
                    entries.extend(snapshot(&e.path()));
                }
                entries
            })
            .collect();
        files.sort();
        files
    }
    #[test]
    fn read_only_plain_gzip_missing_and_oversized() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(
            preview(tmp.path(), &[])["locations"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            preview(tmp.path(), &[])["folder"],
            tmp.path().to_str().unwrap()
        );
        // These sentinels are deliberately unreadable as certificates and keys.
        std::fs::write(tmp.path().join("certificates"), b"test-only-do-not-open").unwrap();
        std::fs::create_dir(tmp.path().join("keys")).unwrap();
        std::fs::write(tmp.path().join("keys/test-only"), b"test-only-do-not-open").unwrap();
        for name in [
            "standard/tqsl/station_data",
            "tqsl/1024/tqsl/station_data",
            "tqsl/1024-password/tqsl/station_data",
        ] {
            let bytes = corpus(name);
            for gzip in [false, true] {
                let bytes = if gzip {
                    qso_graph_trust::gzip::compress(&bytes)
                } else {
                    bytes.clone()
                };
                std::fs::write(tmp.path().join("station_data"), bytes).unwrap();
                let before = snapshot(tmp.path());
                assert!(
                    !preview(tmp.path(), &[])["locations"]
                        .as_array()
                        .unwrap()
                        .is_empty()
                );
                assert_eq!(snapshot(tmp.path()), before);
            }
        }
        std::fs::write(
            tmp.path().join("station_data"),
            vec![b' '; tqsl_locations::MAX_FILE_LEN + 1],
        )
        .unwrap();
        let before = snapshot(tmp.path());
        assert!(inspect(tmp.path(), &[]).is_err());
        assert_eq!(snapshot(tmp.path()), before);
        assert!(
            serde_json::from_str::<Command>(
                r#"{"op":"syncInspect","existing":[],"path":"not-allowed"}"#
            )
            .is_err()
        );
        let invalid = Existing {
            name: "test-only".into(),
            place: BTreeMap::from([("MY_STREET".into(), "test-only".into())]),
            park: String::new(),
        };
        assert!(inspect(tmp.path(), &[invalid]).is_err());
    }
}
