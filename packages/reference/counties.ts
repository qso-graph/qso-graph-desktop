// SPDX-License-Identifier: GPL-3.0-only
// The US counties a Location's MY_CNTY is checked against and filled from
// (QGD-STN-0010). The data is built by scripts/build-counties.mjs and ships
// with the application; this reads it and answers three questions: which
// county is at a position, which counties a grid square touches, and which
// counties a state has.
//
// A county is named as LoTW names it (TQSL's US_COUNTY list), and in Alaska
// as ADIF's own list does (KI7MT, 2026-10-22, qso-graph-desktop#45). The value
// is ADIF's MY_CNTY form, "ID,Ada".

export interface CountyData {
  format: 1;
  quantum: number;
  counties: { cnty: string; codes: string[]; box: [number, number, number, number]; rings: number[][] }[];
  names: Record<string, string[]>;
  // ARRL sections (ADIF's abbreviations): a state's one section, or for a
  // state with several, each county's.
  sections: { byState: Record<string, string>; byCounty: Record<string, string> };
}

interface Shape {
  cnty: string;
  box: [number, number, number, number];
  rings: Float64Array[];
}

export interface Counties {
  // MY_CNTY at a position, or undefined outside every county (at sea, in
  // Canada, in a territory).
  at(latitude: number, longitude: number): string | undefined;
  // Every county a grid square's area reaches, in MY_CNTY form.
  inGrid(south: number, west: number, north: number, east: number): string[];
  // A state's counties, by name, for a pick list; empty for a state with none.
  of(state: string): string[];
  // A state's ARRL sections: one for most, several where ARRL splits it.
  sectionsOf(state: string): string[];
  // The ARRL section a county is in, or a state's where it has one.
  sectionOf(state: string, cnty?: string): string | undefined;
  // Whether a MY_CNTY value names a county this list has, spelled exactly as
  // the list spells it: a value is refused, never altered to fit (QGD-STN-0002).
  has(cnty: string): boolean;
}

function isData(value: unknown): value is CountyData {
  const data = value as CountyData;
  return typeof value === 'object' && value !== null && data.format === 1 && typeof data.quantum === 'number'
    && Array.isArray(data.counties) && typeof data.names === 'object' && data.names !== null
    && typeof data.sections === 'object' && data.sections !== null
    && typeof data.sections.byState === 'object' && typeof data.sections.byCounty === 'object';
}

function decode(ring: number[], quantum: number): Float64Array {
  const out = new Float64Array(ring.length);
  let x = 0, y = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i]; y += ring[i + 1];
    out[i] = x * quantum; out[i + 1] = y * quantum;
  }
  return out;
}

// Even-odd over every ring, so a hole (an independent city inside its county,
// a lake) is outside.
function contains(rings: Float64Array[], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function countiesFrom(parsed: unknown): Counties {
  if (!isData(parsed)) throw new Error('The county data is not the shape this version reads.');
  const quantum = parsed.quantum;
  const shapes: Shape[] = parsed.counties.map(county => ({
    cnty: county.cnty,
    box: county.box.map(value => value * quantum) as [number, number, number, number],
    rings: county.rings.map(ring => decode(ring, quantum))
  }));
  const names = new Map(Object.entries(parsed.names).map(([state, list]) => [state, list]));
  const all = new Set<string>();
  for (const [state, list] of names) for (const name of list) all.add(`${state},${name}`);

  const at = (latitude: number, longitude: number): string | undefined => {
    for (const shape of shapes) {
      const [x0, y0, x1, y1] = shape.box;
      if (longitude < x0 || longitude > x1 || latitude < y0 || latitude > y1) continue;
      if (contains(shape.rings, longitude, latitude)) return shape.cnty;
    }
    return undefined;
  };

  return {
    at,
    inGrid(south, west, north, east) {
      // Sampled on a 9 by 9 lattice, edges included. A county that reaches a
      // grid square only in a sliver narrower than a ninth of it can be
      // missed, which is why the answer is a set of choices for the operator
      // and not a value filled in for them.
      const found = new Set<string>();
      for (let row = 0; row <= 8; row++) {
        for (let column = 0; column <= 8; column++) {
          const latitude = south + ((north - south) * row) / 8;
          const longitude = west + ((east - west) * column) / 8;
          const county = at(latitude, longitude);
          if (county) found.add(county);
        }
      }
      return [...found].sort((a, b) => a.localeCompare(b));
    },
    of(state) {
      return [...(names.get(state) ?? [])];
    },
    sectionsOf(state) {
      const whole = parsed.sections.byState[state];
      if (whole) return [whole];
      return [...new Set(Object.entries(parsed.sections.byCounty)
        .filter(([cnty]) => cnty.startsWith(`${state},`)).map(([, section]) => section))].sort();
    },
    sectionOf(state, cnty) {
      return parsed.sections.byState[state] ?? (cnty ? parsed.sections.byCounty[cnty] : undefined);
    },
    has(cnty) {
      return all.has(cnty);
    }
  };
}
