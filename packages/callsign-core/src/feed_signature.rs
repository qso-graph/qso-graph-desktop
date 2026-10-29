// SPDX-License-Identifier: GPL-3.0-only
// The update feed's signature (#128, QGD-SCP-0003, QGD-FRM-0019).
//
// The feed says which file is an update and what its SHA-256 is, so whoever
// can change the feed can choose what this product installs. On Windows and
// macOS the installer's own signature is checked as well; a Linux AppImage
// has nothing else. So the feed is signed in CI with the release key, as a
// detached OpenPGP signature beside it (`desktop.json.asc`), and nothing in it
// is believed until that signature is verified here against the release key's
// public half, which is built in.
//
// Only what that one signature needs is read: an ASCII-armoured v4 signature
// packet, over a binary document, by an RSA key, hashed with SHA-256 or
// SHA-512, issued by the key whose fingerprint the register names. Anything
// else is refused rather than half-understood. The RSA arithmetic is AWS-LC's,
// the same FIPS module every connection uses, so no second crypto library is
// linked (RFC 9580 §5.2; the v4 trailer of §5.2.4).
use aws_lc_rs::signature::{self, RsaPublicKeyComponents};

type CoreResult<T> = std::result::Result<T, &'static str>;

const REFUSED: &str = "The update feed's signature is not the release key's, so the feed was not used.";

/// The public half of the key the feed must be signed by.
#[derive(serde::Deserialize, Clone)]
pub(crate) struct FeedKey {
    /// The v4 fingerprint, 40 hex digits.
    pub fingerprint: String,
    /// When the key was made (seconds since 1970): part of what its
    /// fingerprint is computed over.
    pub created: u32,
    /// The RSA modulus and public exponent, hex.
    pub n: String,
    pub e: String,
}

// The v4 fingerprint of an RSA public key: SHA-1 over 0x99, the packet's
// length and the packet (version 4, created, algorithm 1, n and e as MPIs;
// RFC 9580 §5.5.4). Checked on every use, so a register whose numbers are not
// the key it names is refused rather than trusted.
pub(crate) fn fingerprint_of(key: &FeedKey) -> Option<Vec<u8>> {
    let n = hex(&key.n)?;
    let e = hex(&key.e)?;
    let mpi = |v: &[u8]| -> Option<Vec<u8>> {
        let v = &v[v.iter().position(|&b| b != 0)?..];
        let bits = (v.len() * 8 - v[0].leading_zeros() as usize) as u16;
        let mut out = bits.to_be_bytes().to_vec();
        out.extend_from_slice(v);
        Some(out)
    };
    let mut packet = vec![4u8];
    packet.extend_from_slice(&key.created.to_be_bytes());
    packet.push(1);
    packet.extend(mpi(&n)?);
    packet.extend(mpi(&e)?);
    let mut digest = aws_lc_rs::digest::Context::new(&aws_lc_rs::digest::SHA1_FOR_LEGACY_USE_ONLY);
    digest.update(&[0x99]);
    digest.update(&(packet.len() as u16).to_be_bytes());
    digest.update(&packet);
    Some(digest.finish().as_ref().to_vec())
}

/// Verifies `armored` as a signature over `data` by `key`, and returns when it
/// was made (seconds since 1970, as the signature itself states).
pub(crate) fn verify(data: &[u8], armored: &[u8], key: &FeedKey) -> CoreResult<i64> {
    let packet = dearmor(armored).ok_or(REFUSED)?;
    let body = signature_packet(&packet).ok_or(REFUSED)?;
    let parsed = parse(body).ok_or(REFUSED)?;

    let wanted = hex(&key.fingerprint).filter(|f| f.len() == 20).ok_or("The update register could not be read.")?;
    if fingerprint_of(key).as_deref() != Some(&wanted[..]) { return Err("The update register could not be read."); }
    if parsed.issuer.as_deref() != Some(&wanted[..]) { return Err(REFUSED); }
    let created = parsed.created.ok_or(REFUSED)?;

    let n = hex(&key.n).ok_or("The update register could not be read.")?;
    let e = hex(&key.e).ok_or("The update register could not be read.")?;
    // An MPI drops leading zero bytes; RSA verification wants the modulus' length.
    if parsed.signature.len() > n.len() { return Err(REFUSED); }
    let mut sig = vec![0u8; n.len() - parsed.signature.len()];
    sig.extend_from_slice(parsed.signature);

    // What was hashed: the document, then the signature's hashed part, then the
    // v4 trailer (0x04 0xFF and that part's length).
    let mut message = Vec::with_capacity(data.len() + parsed.hashed.len() + 6);
    message.extend_from_slice(data);
    message.extend_from_slice(parsed.hashed);
    message.extend_from_slice(&[0x04, 0xFF]);
    message.extend_from_slice(&(parsed.hashed.len() as u32).to_be_bytes());

    let algorithm = match parsed.hash {
        8 => &signature::RSA_PKCS1_2048_8192_SHA256,
        10 => &signature::RSA_PKCS1_2048_8192_SHA512,
        _ => return Err(REFUSED),
    };
    RsaPublicKeyComponents { n: &n[..], e: &e[..] }
        .verify(algorithm, &message, &sig)
        .map_err(|_| REFUSED)?;
    Ok(created)
}

struct Parsed<'a> {
    hashed: &'a [u8],
    hash: u8,
    created: Option<i64>,
    issuer: Option<Vec<u8>>,
    signature: &'a [u8],
}

// Version 4, signature type 0x00 (a binary document), public-key algorithm 1
// (RSA), then the hashed subpackets, the unhashed ones, the hash's left 16
// bits and the signature as one MPI.
fn parse(body: &[u8]) -> Option<Parsed<'_>> {
    if body.len() < 6 || body[0] != 4 || body[1] != 0x00 || body[2] != 1 { return None; }
    let hash = body[3];
    let hashed_len = u16::from_be_bytes([body[4], body[5]]) as usize;
    let hashed_end = 6usize.checked_add(hashed_len)?;
    let hashed = body.get(..hashed_end)?;
    let (created, issuer) = subpackets(body.get(6..hashed_end)?)?;
    let unhashed_len = u16::from_be_bytes([*body.get(hashed_end)?, *body.get(hashed_end + 1)?]) as usize;
    let mut at = hashed_end + 2 + unhashed_len;
    at += 2; // the hash's left 16 bits, which the verification itself settles
    let bits = u16::from_be_bytes([*body.get(at)?, *body.get(at + 1)?]) as usize;
    let len = bits.div_ceil(8);
    let signature = body.get(at + 2..at + 2 + len)?;
    if at + 2 + len != body.len() { return None; }
    Some(Parsed { hashed, hash, created, issuer, signature })
}

// The hashed subpackets: the creation time (2) and the issuer's fingerprint
// (33). A subpacket marked critical that is not understood makes the signature
// one this cannot judge, so it is refused (RFC 9580 §5.2.3.7).
fn subpackets(mut area: &[u8]) -> Option<(Option<i64>, Option<Vec<u8>>)> {
    let (mut created, mut issuer) = (None, None);
    while !area.is_empty() {
        let (len, skip): (usize, usize) = match area[0] {
            l @ 0..=191 => (l as usize, 1),
            l @ 192..=254 => ((((l as usize) - 192) << 8) + *area.get(1)? as usize + 192, 2),
            255 => (u32::from_be_bytes(area.get(1..5)?.try_into().ok()?) as usize, 5),
        };
        let packet = area.get(skip..skip.checked_add(len)?)?;
        let (&kind, value) = packet.split_first()?;
        match kind & 0x7F {
            2 => created = Some(u32::from_be_bytes(value.try_into().ok()?) as i64),
            33 => { if value.first() == Some(&4) { issuer = Some(value.get(1..)?.to_vec()); } }
            other => if kind & 0x80 != 0 && !matches!(other, 3 | 16 | 20 | 27) { return None; },
        }
        area = &area[skip + len..];
    }
    Some((created, issuer))
}

// The first packet must be a signature (tag 2), in either header format, and
// it must be the only thing there.
fn signature_packet(data: &[u8]) -> Option<&[u8]> {
    let first = *data.first()?;
    if first & 0x80 == 0 { return None; }
    let (tag, len, start): (u8, usize, usize) = if first & 0x40 != 0 {
        let tag = first & 0x3F;
        let l = *data.get(1)? as usize;
        match l {
            0..=191 => (tag, l, 2),
            192..=223 => (tag, ((l - 192) << 8) + *data.get(2)? as usize + 192, 3),
            255 => (tag, u32::from_be_bytes(data.get(2..6)?.try_into().ok()?) as usize, 6),
            _ => return None, // partial lengths are not a detached signature
        }
    } else {
        let tag = (first >> 2) & 0x0F;
        match first & 3 {
            0 => (tag, *data.get(1)? as usize, 2),
            1 => (tag, u16::from_be_bytes(data.get(1..3)?.try_into().ok()?) as usize, 3),
            2 => (tag, u32::from_be_bytes(data.get(1..5)?.try_into().ok()?) as usize, 5),
            _ => return None,
        }
    };
    if tag != 2 { return None; }
    let body = data.get(start..start.checked_add(len)?)?;
    if start + len != data.len() { return None; }
    Some(body)
}

// ASCII armour: the BEGIN line, headers to a blank line, base64, an optional
// "=XXXX" checksum line, the END line. The checksum is not relied on: the
// signature is what is checked.
fn dearmor(armored: &[u8]) -> Option<Vec<u8>> {
    let text = std::str::from_utf8(armored).ok()?;
    let mut lines = text.lines().map(str::trim_end);
    lines.by_ref().find(|line| *line == "-----BEGIN PGP SIGNATURE-----")?;
    let mut body = String::new();
    let mut in_headers = true;
    for line in lines {
        if line == "-----END PGP SIGNATURE-----" { return base64(&body); }
        if in_headers { if line.is_empty() { in_headers = false; } else if !line.contains(": ") { in_headers = false; body.push_str(line); } continue; }
        if line.starts_with('=') { continue; }
        body.push_str(line);
    }
    None
}

fn base64(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in text.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 { bits -= 8; out.push((acc >> bits) as u8); acc &= (1 << bits) - 1; }
    }
    Some(out)
}

pub(crate) fn hex(text: &str) -> Option<Vec<u8>> {
    if text.len() % 2 != 0 { return None; }
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &[u8] = include_bytes!("testdata/feed/desktop.json");
    const SIGNED: &[u8] = include_bytes!("testdata/feed/desktop.json.asc");
    const SHA256: &[u8] = include_bytes!("testdata/feed/sha256.asc");
    const LATER: &[u8] = include_bytes!("testdata/feed/later.asc");
    const OTHER_KEY: &[u8] = include_bytes!("testdata/feed/other-key.asc");
    const TEST_KEY: &str = include_str!("testdata/feed/test-key.json");

    fn test_key() -> FeedKey { serde_json::from_str(TEST_KEY).unwrap() }

    #[test]
    fn a_signature_by_the_key_is_accepted_and_says_when_it_was_made() {
        let made = verify(FEED, SIGNED, &test_key()).unwrap();
        assert!(made > 1_790_000_000, "{made}");
        assert!(verify(FEED, LATER, &test_key()).unwrap() > made);
    }

    #[test]
    fn sha256_and_sha512_are_both_read() {
        verify(FEED, SHA256, &test_key()).unwrap();
    }

    #[test]
    fn one_changed_byte_in_the_feed_is_refused() {
        let mut changed = FEED.to_vec();
        let at = changed.iter().position(|b| b.is_ascii_digit()).unwrap();
        changed[at] = if changed[at] == b'9' { b'8' } else { changed[at] + 1 };
        assert_eq!(verify(&changed, SIGNED, &test_key()), Err(REFUSED));
    }

    #[test]
    fn another_key_is_refused() {
        assert_eq!(verify(FEED, OTHER_KEY, &test_key()), Err(REFUSED));
    }

    #[test]
    fn nothing_that_is_not_a_signature_is_accepted() {
        for junk in [&b""[..], b"not armour", b"-----BEGIN PGP SIGNATURE-----\n\n!!!!\n-----END PGP SIGNATURE-----\n",
                     b"-----BEGIN PGP SIGNATURE-----\n\nAAAA\n-----END PGP SIGNATURE-----\n"] {
            assert_eq!(verify(FEED, junk, &test_key()), Err(REFUSED), "{:?}", String::from_utf8_lossy(junk));
        }
        // A truncated signature.
        let cut = &SIGNED[..SIGNED.len() / 2];
        assert_eq!(verify(FEED, cut, &test_key()), Err(REFUSED));
    }

    #[test]
    fn the_fingerprint_is_computed_from_the_key_s_own_numbers() {
        let key = test_key();
        assert_eq!(fingerprint_of(&key).unwrap(), hex(&key.fingerprint).unwrap());
        let mut wrong = key.clone();
        wrong.created += 1;
        assert_eq!(verify(FEED, SIGNED, &wrong), Err("The update register could not be read."));
    }

    #[test]
    fn base64_and_hex_decode() {
        assert_eq!(base64("aGFt").unwrap(), b"ham");
        assert_eq!(base64("aGFtcw==").unwrap(), b"hams");
        assert_eq!(hex("0aff").unwrap(), vec![0x0a, 0xff]);
        assert!(hex("0g").is_none());
    }
}
