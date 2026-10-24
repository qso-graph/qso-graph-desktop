// SPDX-License-Identifier: GPL-3.0-only
// Reading one named file out of a zip archive.
//
// The core fetches ADIF's published archive at run time (QGD-REF-0001: a
// later ADIF release is new data, not a new build), so the application has to
// be able to open it itself. It is not allowed to shell out to `unzip` — that
// would be a command built at run time, which QGD-SEC-0002 forbids — and the
// archive is a real zip from another project, so the reader has to be one.
//
// It walks the **central directory**, not the local headers. scripts/unzip.mjs
// walks local headers because it reads archives this product wrote, where
// every entry has its sizes in its own header. A general zip need not: an
// entry written by a streaming writer carries zeroes there and its real sizes
// in a data descriptor afterwards. The central directory is the authority in
// the format, and reading anything else is reading a hint.
import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE = 0x02014b50;
const LOCAL_FILE = 0x04034b50;
const ZIP64_LOCATOR = 0x07064b50;

export interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

// The end record is at the end, after a comment of up to 65,535 bytes, so it
// is found by searching backwards for its signature.
function endRecord(archive: Buffer): number {
  const earliest = Math.max(0, archive.length - 22 - 0xffff);
  for (let at = archive.length - 22; at >= earliest; at -= 1) {
    if (archive.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  throw new Error('that is not a zip archive: no end-of-central-directory record');
}

export function entries(archive: Buffer): Entry[] {
  const end = endRecord(archive);
  // Zip64 is refused rather than half-read. ADIF's archive is a few megabytes
  // and will not be one; an archive that is would otherwise be read with the
  // 32-bit fields saturated at 0xffffffff, which is how a reader silently
  // returns the wrong bytes.
  if (end >= 20 && archive.readUInt32LE(end - 20) === ZIP64_LOCATOR) {
    throw new Error('zip64 archives are not supported');
  }
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const found: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== CENTRAL_FILE) {
      throw new Error(`the central directory ends after ${index} of ${count} entries`);
    }
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    found.push({
      name: archive.toString('utf8', at + 46, at + 46 + nameLength),
      method: archive.readUInt16LE(at + 10),
      compressedSize: archive.readUInt32LE(at + 20),
      size: archive.readUInt32LE(at + 24),
      offset: archive.readUInt32LE(at + 42)
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

export function read(archive: Buffer, name: string): Buffer {
  const entry = entries(archive).find(candidate => candidate.name === name);
  if (!entry) throw new Error(`${name} is not in the archive`);
  return readEntry(archive, entry);
}

export function readEntry(archive: Buffer, entry: Entry): Buffer {
  if (archive.readUInt32LE(entry.offset) !== LOCAL_FILE) {
    throw new Error(`${entry.name}: the central directory points at no local header`);
  }
  // The local header's name and extra lengths say where the data starts. Its
  // sizes are not read: the central directory's are the authority.
  const nameLength = archive.readUInt16LE(entry.offset + 26);
  const extraLength = archive.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const payload = archive.subarray(start, start + entry.compressedSize);

  let content: Buffer;
  if (entry.method === 0) content = Buffer.from(payload);
  else if (entry.method === 8) content = inflateRawSync(payload);
  else throw new Error(`${entry.name}: unsupported compression method ${entry.method}`);

  // The size the directory promised. A reader that returns short content is
  // how a definitions file parses and turns out to hold half of ADIF.
  if (content.length !== entry.size) {
    throw new Error(`${entry.name}: expected ${entry.size} bytes, read ${content.length}`);
  }
  return content;
}
