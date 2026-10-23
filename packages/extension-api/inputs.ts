// SPDX-License-Identifier: GPL-3.0-only
// The typed fields a page may ask the operator for (KI7MT, 2026-10-22): a
// grid, a callsign or a short text, at most four to a page. The core draws
// each field and checks what is typed, by its kind, before the extension is
// given it; an extension never receives a value the core refused, and never
// draws a field of its own. Astro's DX grid and ADIF Lookup's search are the
// first users.
//
// No dependencies: this package depends on nothing (QGD-REP-0006).

export const INPUT_KINDS = ['grid', 'callsign', 'text'] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

export interface PageInput {
  readonly id: string;
  readonly label: string;
  readonly kind: InputKind;
  // For text: the longest value, at most TEXT_MAX.
  readonly max?: number;
  // What the field is for, said under it, at most HINT_MAX characters
  // (KI7MT, 2026-10-23: a box marked "DX grid" did not say what it did).
  // Without one, the core says what the kind wants.
  readonly hint?: string;
}

export const HINT_MAX = 80;

export const MAX_INPUTS = 4;
export const TEXT_MAX = 64;

// A Maidenhead locator of 2, 4, 6 or 8 characters, written as hams write
// one: the field letters capitals, the subsquare letters small (FN31pr).
// Checked pair by pair rather than by one pattern with nested optional
// groups, which security-lint rightly calls a regex worth avoiding.
const PAIRS = [/^[A-R]{2}$/i, /^[0-9]{2}$/, /^[A-X]{2}$/i, /^[0-9]{2}$/];
function grid(value: string): string | undefined {
  if (value.length < 2 || value.length > 8 || value.length % 2 !== 0) return undefined;
  let out = '';
  for (let at = 0; at < value.length; at += 2) {
    const pair = value.slice(at, at + 2);
    if (!PAIRS[at / 2].test(pair)) return undefined;
    out += at === 0 ? pair.toUpperCase() : at === 4 ? pair.toLowerCase() : pair;
  }
  return out;
}
// A callsign as the credential core's plain_callsign takes one, with the
// portable or maritime suffix that is part of a call (W1AW/P).
const CALLSIGN = /^[A-Z0-9][A-Z0-9/]{0,31}$/i;

// The value as the extension will be given it, or undefined when the kind
// refuses it. Refused, not coerced (QGD-SEC-0006): a grid with one letter too
// many is not a grid with that letter dropped.
export function inputValue(input: Pick<PageInput, 'kind' | 'max'>, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (input.kind === 'grid') return grid(trimmed);
  if (input.kind === 'callsign') return CALLSIGN.test(trimmed) ? trimmed.toUpperCase() : undefined;
  const max = Math.min(input.max ?? TEXT_MAX, TEXT_MAX);
  if (trimmed.length > max || /[<>]/.test(trimmed)) return undefined;
  for (let at = 0; at < trimmed.length; at += 1) {
    const code = trimmed.charCodeAt(at);
    if (code < 0x20 || code === 0x7f) return undefined;
  }
  return trimmed;
}

// The values a page is asked with: one per declared input that has one, each
// checked by its kind. An id the page did not declare, or a value its kind
// refuses, makes the whole set refused: the operator is told, not ignored.
export function inputValues(inputs: readonly PageInput[], values: unknown): Record<string, string> | undefined {
  if (values === undefined) return {};
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return undefined;
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(values)) {
    const input = inputs.find(entry => entry.id === id);
    if (!input) return undefined;
    if (value === '') continue;
    const checked = inputValue(input, value);
    if (checked === undefined) return undefined;
    out[id] = checked;
  }
  return out;
}
