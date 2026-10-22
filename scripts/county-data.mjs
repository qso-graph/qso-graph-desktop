// SPDX-License-Identifier: GPL-3.0-only
// Building the US county data a Location is checked and filled from
// (QGD-STN-0010). Pure functions, so tests/county-data.test.mjs runs them on
// the real files and on small cases; scripts/build-counties.mjs strings them
// together. Nothing here reaches the network.
//
// The rule (KI7MT, 2026-10-22, qso-graph-desktop#45): LoTW first. A county
// is named the way TQSL's US_COUNTY list names it, except in Alaska, where
// ADIF's own list governs because ADIF is the core and TQSL still uses names
// Alaska has retired.

import { resolve } from 'node:path';

// Where a fetched source is kept: vendor/.cache/, named by its hash, so a
// new pin is a new file and never mistaken for the old one.
export const cachedSource = source => resolve('vendor', '.cache', `county-${source.sha256.slice(0, 16)}`);

// ---- dBase III attributes (.dbf) -------------------------------------------
export function readDbf(buffer) {
  const records = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let at = 32; buffer[at] !== 0x0d; at += 32) {
    const end = buffer.indexOf(0, at);
    fields.push({ name: buffer.toString('latin1', at, Math.min(end, at + 11)), length: buffer[at + 16] });
  }
  const rows = [];
  for (let row = 0; row < records; row++) {
    const start = headerLength + row * recordLength;
    if (buffer[start] === 0x2a) continue; // deleted
    let at = start + 1;
    const values = {};
    for (const field of fields) {
      values[field.name] = buffer.toString('utf8', at, at + field.length).trim();
      at += field.length;
    }
    rows.push(values);
  }
  return rows;
}

// ---- polygons (.shp) --------------------------------------------------------
// Polygon shapes (type 5) only, which is what the county files are: each
// record a list of rings of [longitude, latitude].
export function readShp(buffer) {
  const shapes = [];
  for (let at = 100; at < buffer.length;) {
    const length = buffer.readInt32BE(at + 4) * 2;
    const record = at + 8;
    const type = buffer.readInt32LE(record);
    at = record + length;
    if (type === 0) { shapes.push([]); continue; }
    if (type !== 5) throw new Error(`shape type ${type} is not a polygon`);
    const parts = buffer.readInt32LE(record + 36);
    const points = buffer.readInt32LE(record + 40);
    const starts = [];
    for (let part = 0; part < parts; part++) starts.push(buffer.readInt32LE(record + 44 + part * 4));
    starts.push(points);
    const base = record + 44 + parts * 4;
    const rings = [];
    for (let part = 0; part < parts; part++) {
      const ring = [];
      for (let point = starts[part]; point < starts[part + 1]; point++) {
        ring.push([buffer.readDoubleLE(base + point * 16), buffer.readDoubleLE(base + point * 16 + 8)]);
      }
      rings.push(ring);
    }
    shapes.push(rings);
  }
  return shapes;
}

// ---- simplifying -------------------------------------------------------------
// Douglas-Peucker on one ring. A ring that would fall below four points is
// kept as it was, so no small island disappears.
export function simplify(ring, tolerance) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1; keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = ring[first];
    const [bx, by] = ring[last];
    const dx = bx - ax, dy = by - ay;
    const length = Math.hypot(dx, dy);
    let worst = 0, at = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = ring[i];
      const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
      if (distance > worst) { worst = distance; at = i; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([first, at], [at, last]); }
  }
  const kept = ring.filter((_, i) => keep[i]);
  return kept.length >= 4 ? kept : ring;
}

// Rings as integers in units of `quantum` degrees, the first point absolute
// and the rest as differences from the one before: small numbers, which is
// most of what makes the file small.
export function encodeRing(ring, quantum) {
  const out = [];
  let lastX = 0, lastY = 0;
  for (const [x, y] of ring) {
    const qx = Math.round(x / quantum), qy = Math.round(y / quantum);
    if (out.length && qx === lastX && qy === lastY) continue;
    out.push(qx - lastX, qy - lastY);
    lastX = qx; lastY = qy;
  }
  return out;
}

// ---- names ---------------------------------------------------------------
// TQSL's US_COUNTY list, per state: { ID: [{ value, label }], … }.
export function tqslCounties(configXml) {
  const start = configXml.indexOf('<field Id="US_COUNTY"');
  if (start < 0) throw new Error('TQSL config has no US_COUNTY field');
  const end = configXml.indexOf('</field>', start);
  const block = configXml.slice(start, end);
  const states = {};
  for (const [, state, body] of block.matchAll(/<enums dependency="([A-Z]{2})">([\s\S]*?)<\/enums>/g)) {
    states[state] = [...body.matchAll(/<enum value="([^"]*)">([^<]*)<\/enum>/g)].map(([, value, label]) => ({ value, label }));
  }
  return states;
}

// How two spellings of one county are compared: case, punctuation, accents,
// and Saint/St./Ste. set aside. "DeKalb" and "De Kalb", "St. Joseph" and
// "Saint Joseph", "Doña Ana" and "Dona Ana" compare equal.
export function comparable(name) {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\bsainte\b|\bsaint\b|\bste?\b\.?/g, 'st').replace(/[^a-z]/g, '');
}

const TERRITORIES = new Set(['PR', 'AS', 'GU', 'MP', 'VI', 'DC']);
const INDEPENDENT_CITY = '25';

// Each Census county matched to the name LoTW (or, in Alaska, ADIF) uses.
// Returns the matches and everything that did not match, so the build can
// refuse to publish a partial list.
export function nameCounties({ rows, tqsl, alaska, renamed }) {
  const matched = [];
  const unmatched = [];
  const used = new Map();
  for (const row of rows) {
    const state = row.STUSPS;
    if (TERRITORIES.has(state)) continue;
    let name;
    if (state === 'AK') {
      const wanted = comparable(renamed[row.NAME] ?? row.NAME);
      name = alaska.find(candidate => comparable(candidate) === wanted);
    } else {
      const keys = row.LSAD === INDEPENDENT_CITY
        ? [comparable(`${row.NAME} city`), comparable(row.NAMELSAD)]
        : [comparable(row.NAME), comparable(row.NAMELSAD)];
      const found = (tqsl[state] ?? []).find(entry =>
        keys.includes(comparable(entry.value)) || keys.includes(comparable(entry.label)));
      name = found?.value;
    }
    if (!name) { unmatched.push(`${state} ${row.NAMELSAD}`); continue; }
    const key = `${state},${name}`;
    // Two Census areas may share a name only where a rename says so (Alaska's
    // Copper River and Chugach are both ADIF's Valdez-Cordova).
    if (used.has(key) && state !== 'AK') unmatched.push(`${state} ${row.NAMELSAD} (again ${name})`);
    used.set(key, true);
    matched.push({ row, state, name });
  }
  return { matched, unmatched };
}

// Point in polygon by the even-odd rule over every ring of a shape, so a
// hole (a lake, or an independent city inside its county) is outside.
export function contains(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
