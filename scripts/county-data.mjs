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

// ---- ARRL sections -----------------------------------------------------------
// ARRL's Section Boundaries page as text: division headings, each section's
// name on its own line, and for a section that is part of a state, a line
// after it starting "--" that lists its counties. Returns the sections in
// page order: { name, counties } with counties null for a whole-state
// section, or the line's other text where it lists none ("Hawaii and U.S.
// possessions in the Pacific").
export function parseSections(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, "'")
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const start = text.indexOf('Atlantic Division');
  if (start < 0) throw new Error('ARRL\'s page has no Atlantic Division: not the shape this reads');
  const sections = [];
  for (let i = start; i < text.length; i++) {
    const line = text[i];
    if (line === 'Back to Top') break;
    if (/ Division$/.test(line)) continue;
    if (line.startsWith('--') || line.startsWith('-DC')) {
      const last = sections.at(-1);
      if (!last) continue;
      if (line === '-DC') { last.name += '-DC'; continue; }
      const listed = /counties of (.*)$/.exec(line);
      if (listed) {
        last.counties = listed[1].replace(/\s+and\s+/g, ', ').split(',').map(name => name.trim()).filter(Boolean);
      } else {
        last.note = line.replace(/^--\s*/, '');
      }
      continue;
    }
    // The section list ends where the page's own text resumes.
    if (sections.length > 0 && !/^[A-Z][A-Za-z.\- ]+$/.test(line)) break;
    if (line.length > 40) break;
    sections.push({ name: line, counties: null });
  }
  return sections;
}

// Every US county's ARRL section (ADIF's abbreviation), from the page's
// sections, ADIF's ARRL_Section list and the county names the data uses.
// Whole-state sections are matched to a state by name; listed counties to
// the one state holding them all; Los Angeles, which the page lists without
// counties, is its county. Returns { byState, byCounty, problems }: byState
// for a state with one section, byCounty for a state with several.
export function assignSections({ sections, adifSections, countiesOf, stateNames, corrections }) {
  const problems = [];
  const abbreviation = new Map(adifSections.map(entry => [comparable(entry.name), entry.abbreviation]));
  const byState = {};
  const byCounty = {};
  const split = new Map();
  for (const section of sections) {
    // Puerto Rico and the US Virgin Islands are DXCC entities of their own,
    // with no counties here.
    if (['Puerto Rico', 'US Virgin Islands'].includes(section.name)) continue;
    const code = abbreviation.get(comparable(section.name));
    if (!code) { problems.push(`ARRL's section "${section.name}" is not in ADIF's ARRL_Section list`); continue; }
    if (section.counties) {
      // The one state that has every county listed.
      const fits = Object.keys(countiesOf).filter(state => {
        const have = new Set(countiesOf[state].map(comparable));
        const listed = section.counties.flatMap(name => [corrections[state]?.[name] ?? name].flat());
        return listed.every(name => have.has(comparable(name)));
      });
      if (fits.length !== 1) { problems.push(`${section.name}: its counties fit ${fits.length} states`); continue; }
      const state = fits[0];
      const names = new Map(countiesOf[state].map(name => [comparable(name), name]));
      for (const listedName of section.counties.flatMap(name => [corrections[state]?.[name] ?? name].flat())) {
        const county = `${state},${names.get(comparable(listedName))}`;
        if (byCounty[county]) problems.push(`${county} is in two sections`);
        byCounty[county] = code;
      }
      split.set(state, [...(split.get(state) ?? []), code]);
      continue;
    }
    const state = Object.entries(stateNames).find(([, name]) => comparable(name) === comparable(section.name))?.[0];
    if (state) { byState[state] = code; continue; }
    if (section.name === 'Maryland-DC') { byState.MD = code; continue; }
    if (section.name === 'Pacific') { byState.HI = code; continue; }
    if (section.name === 'Los Angeles') { byCounty['CA,Los Angeles'] = code; split.set('CA', [...(split.get('CA') ?? []), code]); continue; }
    problems.push(`ARRL's section "${section.name}" names no state this list has`);
  }
  // A state split into sections has every county in one of them.
  for (const state of split.keys()) {
    for (const name of countiesOf[state]) {
      if (!byCounty[`${state},${name}`]) problems.push(`${state},${name} is in no section`);
    }
  }
  for (const state of Object.keys(countiesOf)) {
    if (!split.has(state) && !byState[state]) problems.push(`${state} has no section`);
  }
  return { byState, byCounty, problems };
}
