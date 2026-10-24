// SPDX-License-Identifier: GPL-3.0-only
// QGD-LOG-0012: exporting diagnostics produces one redacted archive for the
// user to send. Nothing leaves the machine unless the user sends it.
//
// The archive is written here, without a dependency. A credential application
// carries a supply chain for every package it ships, and a store-and-deflate
// zip writer is about a hundred lines of well-defined format that can be
// checked against the system's own unzip — which the tests do.
import { deflateRawSync } from 'node:zlib';
import { REDACTED_FIELDS } from '../logging/logging.js';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ArchiveEntry {
  name: string;
  content: Buffer;
  modified?: Date;
}

function dosTime(when: Date): { time: number; date: number } {
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (Math.floor(when.getSeconds() / 2)),
    date: ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  };
}

// A zip of stored-or-deflated entries. No directories, no comments, no zip64:
// a diagnostics bundle is a handful of text files.
export function zip(entries: readonly ArchiveEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.content);
    // Deflate only when it actually helps; a tiny file can grow.
    const useDeflate = deflated.length < entry.content.length;
    const payload = useDeflate ? deflated : entry.content;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosTime(entry.modified ?? new Date());
    const crc = crc32(entry.content);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(entry.content.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, payload);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(time, 12);
    directory.writeUInt16LE(date, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(payload.length, 20);
    directory.writeUInt32LE(entry.content.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    // >>> 0 because a shift is signed in JavaScript and this one overflows
    // into a negative, which writeUInt32LE refuses.
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);

    offset += header.length + name.length + payload.length;
  }

  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...local, centralBytes, end]);
}

// A second pass over what is already redacted at write time. The logger is the
// guarantee; this is what catches a line that reached the folder some other way
// — the engine's own log, from P4, is not written through our logger at all.
//
// Structured lines are parsed and redacted by field name, exactly as the logger
// does, because a field's value can be an object, an array or a number and a
// pattern written for quoted strings silently passes all three. Only a line
// that will not parse falls back to a pattern.
const SECRET_FIELDS = new Set(REDACTED_FIELDS.map(field => field.toLowerCase()));

function redactValue(value: unknown): unknown {
  // A string value can carry a secret the field name cannot reveal:
  // {"msg":"connection failed password=synthetic"} is a perfectly ordinary
  // record. Field-name redaction alone does not reach inside it.
  if (typeof value === 'string') return redactPlain(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_FIELDS.has(key.toLowerCase()) ? '[redacted]' : redactValue(inner);
    }
    return result;
  }
  return value;
}

const NAMES = '(?:password|api[-_]?key|secret|token|passphrase|credential)s?';
// No word boundary before the name: `access_token` and `db_password` are
// credentials and an underscore is a word character, so \b excludes exactly the
// prefixed names worth catching. No JSON delimiters in the unquoted value
// either — a password may contain } or ] and truncating at one leaks the rest.
// Quoted JSON shapes are QUOTED_FIELD's job, below.
const PLAIN_SECRET = new RegExp(`(${NAMES}\\s*[=:]\\s*)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s,;]+)`, 'gi');
// A quoted FIELD name, for the lines that never reach the structured path:
// JSON behind a prefix, truncated JSON, pretty-printed JSON, a top-level array.
const QUOTED_FIELD = new RegExp(`("${NAMES}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^\\s,}\\]]+)`, 'gi');
const SENTINEL = /QG_FAKE_(?:CREDENTIAL|ROSTER)_[A-Za-z0-9_-]+/g;

function redactPlain(line: string): string {
  return line
    .replace(QUOTED_FIELD, '$1"[redacted]"')
    .replace(PLAIN_SECRET, '$1[redacted]')
    .replace(SENTINEL, '[redacted]');
}

export function redactForExport(text: string): string {
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    // A top-level array is a record too.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed !== null && typeof parsed === 'object') {
          return JSON.stringify(redactValue(parsed)).replace(SENTINEL, '[redacted]');
        }
      } catch { /* not a record; treat it as text */ }
    }
    return redactPlain(line);
  }).join('\n');
}

// The export itself. Reads the log folder, redacts what it finds, and writes
// one archive where the caller asks. Nothing is transmitted: the user chooses
// where this goes and whether to send it.
export async function exportDiagnostics(
  logs: string,
  destination: string
): Promise<{ files: number; bytes: number }> {
  const { readdir, readFile, stat, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const entries: ArchiveEntry[] = [];
  let names: string[];
  try { names = await readdir(logs); } catch { names = []; }

  for (const name of names.sort()) {
    const path = join(logs, name);
    let info;
    try { info = await stat(path); } catch { continue; }
    if (!info.isFile()) continue;
    const raw = await readFile(path, 'utf8').catch(() => undefined);
    if (raw === undefined) continue;
    entries.push({
      name,
      content: Buffer.from(redactForExport(raw), 'utf8'),
      modified: info.mtime
    });
  }

  const archive = zip(entries);
  await writeFile(destination, archive);
  return { files: entries.length, bytes: archive.length };
}
