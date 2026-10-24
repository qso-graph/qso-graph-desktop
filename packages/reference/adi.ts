// SPDX-License-Identifier: GPL-3.0-only
// Reading an ADI file.
//
// Needed by QGD-REF-0008: the validation has to answer ADIF's own test QSOs,
// and they ship as an ADI file. This is the reader for it — not the QSO store,
// which QGD-PRT-0108 keeps out of P5.
//
// The format is `<NAME:LENGTH>data` or `<NAME:LENGTH:TYPE>data`, with anything
// outside a tag's data being free text that ADIF says to ignore. The length is
// authoritative: it is how a value containing `<` or a line break is read back,
// so this reads exactly that many bytes and does not look for a delimiter.
//
// Two things in the format are declarations rather than data, and both are in
// ADIF's test file:
//
// - `USERDEFn` in the header declares a field of the user's own, with a type
//   indicator and optionally an enumeration `{A,B,C}` or a range `{-50:150}`.
//   A validator that does not read these cannot say anything about the records
//   that use them.
// - `APP_<program>_<name>` carries its own type indicator inline.

export interface Tag {
  name: string;
  length: number;
  indicator?: string;
  value: string;
}

export interface UserDefined {
  number: number;
  name: string;
  indicator?: string;
  // One of these at most: ADIF's own syntax allows an enumeration or a range.
  members?: string[];
  range?: { low: number; high: number };
}

export interface AdiFile {
  // Free text before the first tag, which ADIF reserves for a comment.
  preamble: string;
  header: Tag[];
  userDefined: UserDefined[];
  records: Tag[][];
}

// A tag's data length is a byte count, so the file is walked as bytes and
// decoded per value. An ADI file is ASCII by the specification — the Intl
// types are ADX-only — but a file that is not would otherwise be cut through
// the middle of a character with no indication.
export function parseAdi(text: string): AdiFile {
  const bytes = Buffer.from(text, 'utf8');
  const tags: Tag[] = [];
  let at = 0;
  let preamble: string | undefined;

  while (at < bytes.length) {
    const open = bytes.indexOf(0x3c, at); // '<'
    if (open === -1) break;
    if (preamble === undefined) preamble = bytes.toString('utf8', 0, open);
    const close = bytes.indexOf(0x3e, open); // '>'
    if (close === -1) throw new Error(`a tag at byte ${open} is never closed`);
    const inside = bytes.toString('utf8', open + 1, close);
    const parts = inside.split(':');
    const name = parts[0].toUpperCase();

    // <EOH> and <EOR> carry no length and no data.
    if (parts.length === 1) {
      tags.push({ name, length: 0, value: '' });
      at = close + 1;
      continue;
    }
    if (!/^\d+$/.test(parts[1])) {
      throw new Error(`the tag <${inside}> has no length`);
    }
    const length = Number(parts[1]);
    const indicator = parts[2]?.toUpperCase();
    const value = bytes.toString('utf8', close + 1, close + 1 + length);
    if (Buffer.byteLength(value, 'utf8') !== length) {
      throw new Error(`<${name}> says ${length} bytes and the file ends after ${Buffer.byteLength(value, 'utf8')}`);
    }
    tags.push({ name, length, ...(indicator ? { indicator } : {}), value });
    at = close + 1 + length;
  }

  // Split on EOH and EOR. A file with no EOH has no header, which ADIF allows.
  const endOfHeader = tags.findIndex(tag => tag.name === 'EOH');
  const header = endOfHeader === -1 ? [] : tags.slice(0, endOfHeader);
  const rest = tags.slice(endOfHeader + 1);
  const records: Tag[][] = [];
  let current: Tag[] = [];
  for (const tag of rest) {
    if (tag.name === 'EOR') {
      // A trailing EOR with nothing before it is not a record.
      if (current.length) records.push(current);
      current = [];
      continue;
    }
    current.push(tag);
  }
  // Tags after the last EOR are a record nobody closed. Kept, because
  // dropping them would hide a truncated file.
  if (current.length) records.push(current);

  return {
    preamble: preamble ?? text,
    header,
    userDefined: header.filter(tag => /^USERDEF\d+$/.test(tag.name)).map(readUserDefined),
    records
  };
}

// `MY_POWER_CATEGORY,{QRPP,QRP,QRO}` or `MY_TEMP,{-50:150}` or just a name.
export function readUserDefined(tag: Tag): UserDefined {
  const number = Number(/^USERDEF(\d+)$/.exec(tag.name)?.[1] ?? 0);
  const brace = tag.value.indexOf('{');
  if (brace === -1) {
    return { number, name: tag.value.toUpperCase(), ...(tag.indicator ? { indicator: tag.indicator } : {}) };
  }
  if (!tag.value.trimEnd().endsWith('}')) {
    throw new Error(`USERDEF${number} opens a brace and does not close it`);
  }
  const name = tag.value.slice(0, brace).replace(/,\s*$/, '').toUpperCase();
  const inside = tag.value.slice(brace + 1, tag.value.lastIndexOf('}'));
  const common = { number, name, ...(tag.indicator ? { indicator: tag.indicator } : {}) };
  // A range is two numbers separated by a colon. An enumeration is a
  // comma-separated list. ADIF's syntax distinguishes them by the separator.
  //
  // Split rather than matched: this value came out of a file fetched over the
  // network, and a pattern with a quantifier inside a quantifier is refused
  // in that position whether or not this one could backtrack.
  const halves = inside.split(':');
  if (halves.length === 2) {
    const low = halves[0].trim();
    const high = halves[1].trim();
    if (isDecimal(low) && isDecimal(high)) {
      return { ...common, range: { low: Number(low), high: Number(high) } };
    }
  }
  return { ...common, members: inside.split(',').map(member => member.trim()).filter(Boolean) };
}

// Digits, optionally signed, optionally one decimal point — ADIF's Number,
// which is what a USERDEF range is written in.
function isDecimal(value: string): boolean {
  const body = value.startsWith('-') ? value.slice(1) : value;
  const point = body.indexOf('.');
  if (point !== body.lastIndexOf('.')) return false;
  const digits = point === -1 ? body : body.slice(0, point) + body.slice(point + 1);
  return digits.length > 0 && /^[0-9]+$/.test(digits);
}

// The record as a map, which is how a validator wants it. The last value wins,
// and a duplicated field is reported rather than hidden: ADIF allows a field
// once per record.
export function asRecord(tags: Tag[]): { fields: Map<string, Tag>; duplicated: string[] } {
  const fields = new Map<string, Tag>();
  const duplicated: string[] = [];
  for (const tag of tags) {
    if (fields.has(tag.name)) duplicated.push(tag.name);
    fields.set(tag.name, tag);
  }
  return { fields, duplicated };
}
