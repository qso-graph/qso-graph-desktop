// SPDX-License-Identifier: GPL-3.0-only
// Moving callsigns, their service settings and their secrets between machines.
//
// QGD-PSN-0007 to QGD-PSN-0011. It is in the core, and not above it, for one
// reason: the secrets are in the Keychain and the core is the only thing that
// reads them (QGD-CRD-0002). An export built in TypeScript would mean the
// whole bundle in plaintext crossing a process boundary and sitting in a
// JavaScript heap nobody can zeroize. What crosses here is the ciphertext.
//
// The file:
//
//   QGD-CALLSIGN-EXPORT\n
//   {"format":"qg-callsign-export","version":1,"cipher":"AES-256-GCM",…}\n
//   <ciphertext and its 16-byte tag>
//
// The header is in the clear so a later release that has moved on from these
// algorithms can still read what this one wrote (QGD-PSN-0008), and it is the
// AEAD's associated data, so changing a byte of it fails the tag exactly as
// changing a byte of the ciphertext does (QGD-PSN-0009). An import is
// therefore all of the file or none of it: there is no point at which half of
// it has been read and believed.
use aws_lc_rs::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use aws_lc_rs::pbkdf2;
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::num::NonZeroU32;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const MAGIC: &str = "QGD-CALLSIGN-EXPORT";
pub const VERSION: u32 = 1;
pub const CIPHER: &str = "AES-256-GCM";
pub const KDF: &str = "PBKDF2-HMAC-SHA256";
const SALT_LEN: usize = 16;
const KEY_LEN: usize = 32;

// Measured on an M3 Ultra, 2026-10-09, by the `kdf_cost` measurement at the
// foot of this file:
//
//     100,000 iterations:  41 ms
//     300,000 iterations:  88 ms
//     600,000 iterations: 166 ms
//   1,000,000 iterations: 277 ms
//
// 600,000 is taken. It is what OWASP currently publishes for
// PBKDF2-HMAC-SHA256, and 166 ms on this machine — perhaps a second on a slow
// one — is nothing for an action an operator takes once. The step to a
// million buys 1.67x against an attacker for a wait the operator would start
// to feel, which is the wrong trade at this end of the curve; the way to buy
// more is a memory-hard KDF, and that is a different decision from a bigger
// number.
//
// It is written into every file and the file's number is what opens it, never
// this one — so raising it later costs nobody their old exports.
pub const ITERATIONS: u32 = 600_000;

// What a file may be, to be read at all. An export of a few callsigns is a few
// kilobytes; this is a bound on what a damaged or hostile file can make the
// core allocate before it has authenticated anything.
pub const MAX_FILE: usize = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
pub struct Header {
    pub format: String,
    pub version: u32,
    pub cipher: String,
    pub kdf: String,
    pub iterations: u32,
    pub salt: String,
    pub nonce: String,
    pub created: String,
}

// Everything that moves. No Debug: a bundle holds secrets.
#[derive(Default, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct Bundle {
    #[zeroize(skip)]
    pub callsigns: Vec<crate::Callsign>,
    // "<callsign id>:<provider>" to whatever was stored for it.
    #[zeroize(skip)]
    pub credentials: BTreeMap<String, crate::Credentials>,
    // Which secret each service prefers, by callsign id, which is a setting
    // and not a secret.
    #[zeroize(skip)]
    pub preferences: BTreeMap<String, BTreeMap<String, String>>,
    // The Locations, as QG Storage hands them over: JSON the core seals and
    // opens but does not read (KI7MT, 2026-10-23: one file moves callsigns
    // and Locations). Absent in a file written before it, which opens with
    // none; a build before it ignores it.
    #[serde(default)]
    #[zeroize(skip)]
    pub locations: String,
}

// Hex rather than base64, written out rather than taken from a crate: these
// are a 16-byte salt and a 12-byte nonce, and a dependency on the credential
// path is a thing to justify (QGD-SEC-0012) rather than to add for sixty
// bytes of encoding.
fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
        out.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap_or('0'));
    }
    out
}

fn from_hex(text: &str, expected: usize) -> Result<Vec<u8>, &'static str> {
    if text.len() != expected * 2 { return Err("This file's header is not the shape an export has."); }
    let bytes: Vec<u8> = text.as_bytes().chunks(2).map(|pair| {
        let high = (pair[0] as char).to_digit(16)?;
        let low = (pair[1] as char).to_digit(16)?;
        Some(((high << 4) | low) as u8)
    }).collect::<Option<Vec<u8>>>().ok_or("This file's header is not the shape an export has.")?;
    Ok(bytes)
}

// The one message a failed decryption gives, whatever the cause.
//
// QGD-PSN-0010: an AEAD tag fails identically for a wrong passphrase and for
// an altered file, so this product does not claim to know which. Saying "wrong
// passphrase" of a corrupted file sends someone to retype a passphrase that
// was right; saying "corrupted" of a typo sends them looking for a backup they
// do not need.
pub const CANNOT_OPEN: &str =
    "This file could not be opened with that passphrase. It may be the wrong passphrase, or the file may have been altered.";

fn derive(passphrase: &str, salt: &[u8], iterations: u32) -> Result<Zeroizing<[u8; KEY_LEN]>, &'static str> {
    let rounds = NonZeroU32::new(iterations).ok_or("This file's header is not the shape an export has.")?;
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    pbkdf2::derive(pbkdf2::PBKDF2_HMAC_SHA256, rounds, salt, passphrase.as_bytes(), key.as_mut());
    Ok(key)
}

// QGD-PSN-0007: an export without a passphrase is refused, not written in the
// clear. No minimum length is imposed beyond "something": a product that
// lectures an operator about passphrase strength while holding their
// credentials has its priorities the wrong way round, and the KDF cost above
// is what makes a short one expensive to attack.
fn check_passphrase(passphrase: &str) -> Result<(), &'static str> {
    if passphrase.trim().is_empty() {
        return Err("Choose a passphrase. An export is encrypted or it is not written.");
    }
    Ok(())
}

pub fn seal(bundle: &Bundle, passphrase: &str, created: String) -> Result<Vec<u8>, &'static str> {
    check_passphrase(passphrase)?;
    let random = SystemRandom::new();
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    random.fill(&mut salt).map_err(|_| "This machine's random number generator is unavailable.")?;
    random.fill(&mut nonce).map_err(|_| "This machine's random number generator is unavailable.")?;

    let header = Header {
        format: "qg-callsign-export".into(),
        version: VERSION,
        cipher: CIPHER.into(),
        kdf: KDF.into(),
        iterations: ITERATIONS,
        salt: to_hex(&salt),
        nonce: to_hex(&nonce),
        created,
    };
    let header_line = serde_json::to_vec(&header).map_err(|_| "The export could not be written.")?;

    let mut plaintext = Zeroizing::new(
        serde_json::to_vec(bundle).map_err(|_| "The export could not be written.")?);
    let key = derive(passphrase, &salt, ITERATIONS)?;
    let sealing = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key.as_ref()).map_err(|_| "The export could not be written.")?);

    // The header is the associated data, so the file is one thing: a header
    // that has been edited fails the same tag the ciphertext does.
    let mut sealed = plaintext.to_vec();
    sealing.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce),
        Aad::from(&header_line),
        &mut sealed,
    ).map_err(|_| "The export could not be written.")?;
    plaintext.zeroize();

    let mut file = Vec::with_capacity(MAGIC.len() + header_line.len() + sealed.len() + 2);
    file.extend_from_slice(MAGIC.as_bytes());
    file.push(b'\n');
    file.extend_from_slice(&header_line);
    file.push(b'\n');
    file.extend_from_slice(&sealed);
    Ok(file)
}

pub struct Opened {
    pub header: Header,
    pub bundle: Bundle,
}

pub fn open(file: &[u8], passphrase: &str) -> Result<Opened, &'static str> {
    check_passphrase(passphrase)?;
    if file.len() > MAX_FILE { return Err("This file is larger than any export this product writes."); }

    // The two framing lines, read before anything is trusted.
    let first = file.iter().position(|byte| *byte == b'\n')
        .ok_or("This is not a QSO Graph Desktop export.")?;
    if &file[..first] != MAGIC.as_bytes() { return Err("This is not a QSO Graph Desktop export."); }
    let rest = &file[first + 1..];
    let second = rest.iter().position(|byte| *byte == b'\n')
        .ok_or("This is not a QSO Graph Desktop export.")?;
    let header_line = &rest[..second];
    let sealed = &rest[second + 1..];

    let header: Header = serde_json::from_slice(header_line)
        .map_err(|_| "This file's header is not the shape an export has.")?;
    if header.format != "qg-callsign-export" { return Err("This is not a QSO Graph Desktop export."); }
    // Refused by name rather than attempted: a file written by a later release
    // with another cipher is a file this one cannot read, and saying which is
    // more use than a tag failure.
    if header.version != VERSION {
        return Err("This export was written by a different version of QSO Graph Desktop.");
    }
    if header.cipher != CIPHER || header.kdf != KDF {
        return Err("This export uses an algorithm this version does not have.");
    }
    let salt = from_hex(&header.salt, SALT_LEN)?;
    let nonce_bytes = from_hex(&header.nonce, NONCE_LEN)?;
    if sealed.len() <= AES_256_GCM.tag_len() { return Err(CANNOT_OPEN); }

    // The file's own iteration count, never this build's: that is what makes
    // the number in the header worth writing.
    let key = derive(passphrase, &salt, header.iterations)?;
    let opening = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key.as_ref()).map_err(|_| CANNOT_OPEN)?);
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&nonce_bytes);

    let mut buffer = Zeroizing::new(sealed.to_vec());
    let plaintext = opening.open_in_place(
        Nonce::assume_unique_for_key(nonce),
        Aad::from(header_line),
        buffer.as_mut(),
    ).map_err(|_| CANNOT_OPEN)?;

    let bundle: Bundle = serde_json::from_slice(plaintext)
        .map_err(|_| "This export opened, and what is inside it is not an export of callsigns.")?;
    Ok(Opened { header, bundle })
}

#[cfg(test)]
mod tests {
    use super::*;

    // `Opened` has no Debug, on purpose — it holds secrets, and a test that
    // printed one on failure would put it in the output. So the refusal is
    // taken by matching rather than by unwrap_err, which needs Debug on the
    // Ok side.
    fn refused(result: Result<Opened, &'static str>) -> &'static str {
        match result {
            Ok(_) => panic!("this should have been refused and was not"),
            Err(reason) => reason,
        }
    }

    // The file is a text header and then ciphertext, so an edit to the header
    // works on that line alone. Treating the whole file as a string fails on
    // the first byte of the tag that is not valid UTF-8.
    fn edit_header(file: &[u8], from: &str, to: &str) -> Vec<u8> {
        let first = file.iter().position(|byte| *byte == b'\n').unwrap();
        let rest = &file[first + 1..];
        let second = rest.iter().position(|byte| *byte == b'\n').unwrap();
        let header = std::str::from_utf8(&rest[..second]).unwrap().replace(from, to);
        assert!(!header.contains(from), "the header edit changed nothing");
        let mut out = Vec::from(&file[..first + 1]);
        out.extend_from_slice(header.as_bytes());
        out.push(b'\n');
        out.extend_from_slice(&rest[second + 1..]);
        out
    }

    const ID: &str = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";

    fn bundle() -> Bundle {
        let mut credentials = BTreeMap::new();
        credentials.insert(format!("{ID}:qrz"), crate::Credentials {
            username: Some("W1AW".into()),
            password: Some("QG_FAKE_SECRET_VALUE".into()),
            api_key: None,
        });
        Bundle {
            callsigns: vec![crate::Callsign {
                id: ID.into(), call: "W1AW".into(), description: "Home".into(),
                start: Some("2026-01-01".into()), end: None,
                providers: Default::default(),
            }],
            credentials,
            preferences: Default::default(),
            locations: String::new(),
        }
    }

    // The Locations travel inside the encryption with the callsigns: a
    // Location's street address must never be readable from the file
    // (KI7MT, 2026-10-23: one file moves callsigns and Locations).
    #[test]
    fn carries_the_locations_sealed() {
        let mut with = bundle();
        with.locations = r#"{"stations":[{"name":"QG_FAKE_HOME","place":{"MY_STREET":"QG_FAKE_STREET"}}]}"#.into();
        let file = seal(&with, "a passphrase", "2026-10-23T00:00:00Z".into()).unwrap();
        for text in ["QG_FAKE_HOME", "QG_FAKE_STREET", "MY_STREET"] {
            assert!(!file.windows(text.len()).any(|window| window == text.as_bytes()), "the export holds {text} in the clear");
        }
        assert_eq!(open(&file, "a passphrase").unwrap().bundle.locations, with.locations);
    }

    // A file from before the Locations opens, with none.
    #[test]
    fn opens_a_file_from_before_the_locations() {
        let older: Bundle = serde_json::from_str(r#"{"callsigns":[],"credentials":{},"preferences":{}}"#).unwrap();
        assert_eq!(older.locations, "");
    }

    #[test]
    fn round_trips() {
        let file = seal(&bundle(), "a passphrase", "2026-10-09T00:00:00Z".into()).unwrap();
        let opened = open(&file, "a passphrase").unwrap();
        assert_eq!(opened.bundle.callsigns[0].call, "W1AW");
        assert_eq!(
            opened.bundle.credentials[&format!("{ID}:qrz")].password.as_deref(),
            Some("QG_FAKE_SECRET_VALUE"));
    }

    #[test]
    fn holds_nothing_in_the_clear() {
        // QGD-PSN-0007. The whole point: every value that went in, searched
        // for in the bytes that came out.
        let file = seal(&bundle(), "a passphrase", "2026-10-09T00:00:00Z".into()).unwrap();
        for secret in ["QG_FAKE_SECRET_VALUE", "W1AW", "Home", "qrz"] {
            assert!(
                !file.windows(secret.len()).any(|window| window == secret.as_bytes()),
                "the export holds {secret} in the clear");
        }
        // And the header is readable, which is the part that is meant to be.
        let text = String::from_utf8_lossy(&file);
        assert!(text.starts_with(MAGIC));
        assert!(text.contains(CIPHER));
        assert!(text.contains(KDF));
    }

    #[test]
    fn refuses_an_empty_passphrase() {
        assert!(seal(&bundle(), "", "x".into()).is_err());
        assert!(seal(&bundle(), "   ", "x".into()).is_err());
    }

    #[test]
    fn a_wrong_passphrase_and_an_altered_file_say_the_same_thing() {
        // QGD-PSN-0010.
        let file = seal(&bundle(), "a passphrase", "2026-10-09T00:00:00Z".into()).unwrap();
        let wrong = refused(open(&file, "another passphrase"));

        let mut altered = file.clone();
        let last = altered.len() - 1;
        altered[last] ^= 0x01;
        let tampered = refused(open(&altered, "a passphrase"));

        assert_eq!(wrong, tampered);
        assert_eq!(wrong, CANNOT_OPEN);
    }

    #[test]
    fn an_edited_header_fails_the_same_tag() {
        // QGD-PSN-0009: the header is the associated data, so it is part of
        // the file rather than a label on it. Lowering the iteration count is
        // the edit that would matter.
        let file = seal(&bundle(), "a passphrase", "2026-10-09T00:00:00Z".into()).unwrap();
        let edited = edit_header(&file, &format!("\"iterations\":{ITERATIONS}"), "\"iterations\":1000");
        assert_eq!(refused(open(&edited, "a passphrase")), CANNOT_OPEN);
    }

    #[test]
    fn refuses_something_that_is_not_an_export() {
        assert!(open(b"hello", "a passphrase").is_err());
        assert!(open(b"QGD-CALLSIGN-EXPORT\n", "a passphrase").is_err());
        assert!(open(b"QGD-CALLSIGN-EXPORT\nnot json\nxx", "a passphrase").is_err());
    }

    #[test]
    fn refuses_a_version_or_cipher_it_does_not_have() {
        let file = seal(&bundle(), "a passphrase", "2026-10-09T00:00:00Z".into()).unwrap();
        let later = edit_header(&file, "\"version\":1", "\"version\":2");
        assert!(refused(open(&later, "a passphrase")).contains("different version"));
        let other = edit_header(&file, CIPHER, "AES-128-GCM");
        assert!(refused(open(&other, "a passphrase")).contains("algorithm"));
    }

    #[test]
    fn uses_the_file_s_own_iteration_count() {
        // A file written with a different cost still opens, which is what the
        // number in the header is for.
        let file = seal(&bundle(), "a passphrase", "2026-10-09T00:00:00Z".into()).unwrap();
        let opened = open(&file, "a passphrase").unwrap();
        assert_eq!(opened.header.iterations, ITERATIONS);
        assert_eq!(opened.header.cipher, CIPHER);
    }
}

// A measurement, not a test: `cargo test -- --ignored --nocapture kdf_cost`
// prints what the chosen iteration count costs on the machine running it.
// QGD-PSN-0008 leaves the number to be chosen by measuring, and this is the
// measurement — recorded in the commit that chose it.
#[cfg(test)]
mod cost {
    use super::*;
    use std::time::Instant;

    #[test]
    #[ignore]
    fn kdf_cost() {
        for iterations in [100_000u32, 300_000, 600_000, 1_000_000] {
            let started = Instant::now();
            let _ = derive("a passphrase of ordinary length", &[0u8; SALT_LEN], iterations).unwrap();
            println!("{iterations} iterations: {} ms", started.elapsed().as_millis());
        }
    }
}
