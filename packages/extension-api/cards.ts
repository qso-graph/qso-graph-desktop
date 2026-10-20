// SPDX-License-Identifier: GPL-3.0-only
// What an extension answers when the core asks for a card's data, and the
// check it passes before Home draws it (QGD-HOM-0002).
//
// The core draws every card. An extension returns data in one of these shapes
// and nothing else: no markup, no code, no colours of its own. That is what
// keeps extension code off Home, keeps every card looking like the rest of the
// application, and keeps a card cheap to draw on a Raspberry Pi 5.
//
// The shapes are versioned from the first extension (QGD-APP-0019): an
// extension written against version 1 must still draw when the core grows a
// version 2, so a new shape is added beside these, never by changing them.

// Version 2 added the table (KI7MT, 2026-10-20). The core draws both: data
// written against version 1 has no table and is drawn as it always was, and a
// table in data that says version 1 is refused, not guessed at.
export const CARD_DATA_VERSION = 2;
export const CARD_DATA_VERSIONS: readonly number[] = [1, 2];

// Bounds on everything an extension can put on Home. A card is a glance, so
// these are small; and bounded content is content the core can draw without
// trusting the sender (QGD-SEC-0006).
export const CARD_LIMITS = {
  sections: 3,
  figures: 8,
  items: 10,
  label: 40,
  value: 32,
  unit: 12,
  title: 80,
  detail: 120,
  alert: 200,
  reason: 160,
  columns: 4,
  rows: 12,
  cell: 80
} as const;

export interface Figure {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
}

export interface Item {
  readonly title: string;
  readonly detail?: string;
}

export type Section =
  // A few numbers with their names: solar flux, K index.
  | { readonly shape: 'figures'; readonly figures: readonly Figure[] }
  // A short list: spots, activations, nets.
  | { readonly shape: 'items'; readonly items: readonly Item[] }
  // Something happening now: a geomagnetic storm, a radio blackout.
  | { readonly shape: 'alert'; readonly level: 'info' | 'warning' | 'severe'; readonly text: string }
  // Rows under named columns: the bands with their outlook. Version 2.
  | { readonly shape: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };

export interface CardData {
  readonly version: number;
  // When the source observed what the card shows, as ISO 8601 UTC. The core
  // says how old it is; an extension cannot claim its data is fresh.
  readonly observedAt: string;
  readonly sections: readonly Section[];
}

// A card answer: its data, or why there is none, in words (QGD-HOM-0006).
export type CardAnswer =
  | { readonly ok: true; readonly data: CardData }
  | { readonly ok: false; readonly reason: string };

export class CardError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function only(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new CardError(`${where} has a field cards do not have: "${key}".`);
  }
}

// Text the core will draw: a bounded string with no markup in it. Svelte
// would escape markup anyway; refusing it says the extension sent something
// a card cannot hold, which is the finding (P8-shapes).
function text(value: unknown, limit: number, where: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > limit) {
    throw new CardError(`${where} is not text of at most ${limit} characters.`);
  }
  if (/[<>]/.test(value)) throw new CardError(`${where} holds markup, which a card does not draw.`);
  return value;
}

// Three flat patterns rather than one with nested optional groups, which the
// security lint reads as able to backtrack (QGD-SEC-0013).
const ISO_UTC = [
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
];

// Every index, holes included: .map() skips a hole in a sparse array, so a
// list with a gap in it would pass with nothing in the gap checked.
function each<T>(list: readonly unknown[], where: string, check: (value: unknown, at: number) => T): T[] {
  const out: T[] = [];
  for (let at = 0; at < list.length; at++) {
    if (!Object.hasOwn(list, at)) throw new CardError(`${where} has a gap at position ${at + 1}.`);
    out.push(check(list[at], at));
  }
  return out;
}

// A real calendar time. Date.parse rolls 30 February over to 2 March, so
// the parsed time is written back out and compared with what was sent.
function realTime(value: string): boolean {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const written = new Date(parsed).toISOString();
  return written.slice(0, 16) === value.slice(0, 16) && (value.length < 20 || written.slice(0, 19) === value.slice(0, 19));
}

function section(value: unknown, at: number, version: number): Section {
  const where = `Section ${at + 1}`;
  if (!isRecord(value)) throw new CardError(`${where} is not an object.`);
  if (value.shape === 'figures') {
    only(value, ['shape', 'figures'], where);
    if (!Array.isArray(value.figures) || value.figures.length === 0 || value.figures.length > CARD_LIMITS.figures) {
      throw new CardError(`${where} has no figures, or more than ${CARD_LIMITS.figures}.`);
    }
    return {
      shape: 'figures',
      figures: each(value.figures, where, (figure: unknown, i: number): Figure => {
        const name = `${where}, figure ${i + 1}`;
        if (!isRecord(figure)) throw new CardError(`${name} is not an object.`);
        only(figure, ['label', 'value', 'unit'], name);
        return {
          label: text(figure.label, CARD_LIMITS.label, `${name}'s label`),
          value: text(figure.value, CARD_LIMITS.value, `${name}'s value`),
          ...(figure.unit !== undefined ? { unit: text(figure.unit, CARD_LIMITS.unit, `${name}'s unit`) } : {})
        };
      })
    };
  }
  if (value.shape === 'items') {
    only(value, ['shape', 'items'], where);
    if (!Array.isArray(value.items) || value.items.length > CARD_LIMITS.items) {
      throw new CardError(`${where} has items as something other than a list of at most ${CARD_LIMITS.items}.`);
    }
    return {
      shape: 'items',
      items: each(value.items, where, (item: unknown, i: number): Item => {
        const name = `${where}, item ${i + 1}`;
        if (!isRecord(item)) throw new CardError(`${name} is not an object.`);
        only(item, ['title', 'detail'], name);
        return {
          title: text(item.title, CARD_LIMITS.title, `${name}'s title`),
          ...(item.detail !== undefined ? { detail: text(item.detail, CARD_LIMITS.detail, `${name}'s detail`) } : {})
        };
      })
    };
  }
  if (value.shape === 'alert') {
    only(value, ['shape', 'level', 'text'], where);
    if (value.level !== 'info' && value.level !== 'warning' && value.level !== 'severe') {
      throw new CardError(`${where} is an alert with no level of info, warning or severe.`);
    }
    return { shape: 'alert', level: value.level, text: text(value.text, CARD_LIMITS.alert, `${where}'s text`) };
  }
  if (value.shape === 'table') {
    if (version < 2) throw new CardError(`${where} is a table, which card data version ${version} does not have.`);
    only(value, ['shape', 'columns', 'rows'], where);
    if (!Array.isArray(value.columns) || value.columns.length === 0 || value.columns.length > CARD_LIMITS.columns) {
      throw new CardError(`${where} has no columns, or more than ${CARD_LIMITS.columns}.`);
    }
    const columns = each(value.columns, where, (column: unknown, i: number) =>
      text(column, CARD_LIMITS.label, `${where}, column ${i + 1}`));
    if (!Array.isArray(value.rows) || value.rows.length > CARD_LIMITS.rows) {
      throw new CardError(`${where} has rows as something other than a list of at most ${CARD_LIMITS.rows}.`);
    }
    const rows = each(value.rows, where, (row: unknown, i: number) => {
      const name = `${where}, row ${i + 1}`;
      // A row is exactly as wide as the columns: a short or long one would
      // put a value under the wrong heading.
      if (!Array.isArray(row) || row.length !== columns.length) throw new CardError(`${name} does not have ${columns.length} cells.`);
      return each(row, name, (cell: unknown, c: number) => text(cell, CARD_LIMITS.cell, `${name}, cell ${c + 1}`));
    });
    return { shape: 'table', columns, rows };
  }
  throw new CardError(`${where} is not a figures, items, alert or table section.`);
}

// The whole answer, checked before anything of it is drawn. Refused rather
// than coerced (QGD-SEC-0006): a card that cannot be shown says so.
export function validateCardAnswer(value: unknown): CardAnswer {
  if (!isRecord(value)) throw new CardError('A card answer is not an object.');
  if (value.ok === false) {
    only(value, ['ok', 'reason'], 'A card answer');
    return { ok: false, reason: text(value.reason, CARD_LIMITS.reason, 'The reason') };
  }
  if (value.ok !== true) throw new CardError('A card answer says neither ok nor not.');
  only(value, ['ok', 'data'], 'A card answer');
  const data = value.data;
  if (!isRecord(data)) throw new CardError('A card answer has no data.');
  only(data, ['version', 'observedAt', 'sections'], 'Card data');
  if (typeof data.version !== 'number' || !CARD_DATA_VERSIONS.includes(data.version)) {
    throw new CardError(`Card data is version ${String(data.version)}; this core draws versions ${CARD_DATA_VERSIONS.join(' and ')}.`);
  }
  const version = data.version;
  if (typeof data.observedAt !== 'string' || !ISO_UTC.some(pattern => pattern.test(data.observedAt as string)) || !realTime(data.observedAt)) {
    throw new CardError('Card data does not say, as an ISO 8601 UTC time, when it was observed.');
  }
  if (!Array.isArray(data.sections) || data.sections.length === 0 || data.sections.length > CARD_LIMITS.sections) {
    throw new CardError(`Card data has no sections, or more than ${CARD_LIMITS.sections}.`);
  }
  return {
    ok: true,
    data: { version, observedAt: data.observedAt, sections: each(data.sections, 'Card data', (entry, i) => section(entry, i, version)) }
  };
}
