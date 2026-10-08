// SPDX-License-Identifier: GPL-3.0-only
// Reads back what src/diagnostics.ts writes, so a suite can look inside an
// exported archive rather than at its bytes.
//
// This exists because searching the archive bytes for a credential is not a
// check: zip() deflates an entry whenever that helps, which is almost always
// for a log, and the plaintext is simply not there to find. The assertion
// passed on an archive that did contain the credential.
//
// A reader that quietly returned nothing would recreate that, so every caller
// is expected to assert something it knows is present before trusting that
// nothing it fears is.
import { inflateRawSync } from 'node:zlib';

const LOCAL = 0x04034b50;

export function entries(archive) {
  const found = [];
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === LOCAL) {
    const method = archive.readUInt16LE(offset + 8);
    const compressed = archive.readUInt32LE(offset + 18);
    const uncompressed = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const payload = archive.subarray(start, start + compressed);
    let content;
    if (method === 0) content = Buffer.from(payload);
    else if (method === 8) content = inflateRawSync(payload);
    else throw new Error(`${name}: unsupported compression method ${method}`);
    if (content.length !== uncompressed) {
      throw new Error(`${name}: expected ${uncompressed} bytes, read ${content.length}`);
    }
    found.push({ name, content, method });
    offset = start + compressed;
  }
  return found;
}
