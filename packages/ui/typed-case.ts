// SPDX-License-Identifier: GPL-3.0-only
// The case of what is typed, set as it is typed (QGD-CNV-0016, KI7MT
// 2026-10-22): `ki7mt` becomes `KI7MT` in the box. Only case: nothing else is
// changed, and what is typed is still checked and refused with the reason if
// it is wrong. Names the operator gives (descriptions, location names, notes)
// and logins are never touched (QGD-CNV-0015).
//
//   upper   callsigns and references: KI7MT/P, US-2233, W7I/SI-001 (CNV-0001, 0011, 0012)
//   grid    Maidenhead: field and square letters up, subsquare down: DN13tp (CNV-0002)
//   county  ADIF's ST,County: the state up, the name as typed (CNV-0008)
export type CaseRule = 'upper' | 'grid' | 'county';

function grid(one: string): string {
  // Pairs: field letters, square digits, subsquare letters, extended digits.
  return [...one].map((ch, at) => {
    const pair = Math.floor(at / 2);
    return pair === 0 ? ch.toUpperCase() : pair === 2 ? ch.toLowerCase() : ch;
  }).join('');
}

export function typedCase(rule: CaseRule, value: string): string {
  if (rule === 'upper') return value.toUpperCase();
  if (rule === 'grid') return value.split(',').map(grid).join(',');
  const comma = value.indexOf(',');
  return comma < 0 ? value.toUpperCase() : value.slice(0, comma).toUpperCase() + value.slice(comma);
}

// A Svelte action: `<input use:caseAsTyped={'upper'} />`. It runs in the
// capture phase, so the value is set before a bound handler reads it, and
// the caret stays where it was: a change of case never changes the length.
// No rule leaves the field as typed.
export function caseAsTyped(node: HTMLInputElement, rule: CaseRule | undefined) {
  let current = rule;
  const fix = () => {
    if (!current) return;
    const next = typedCase(current, node.value);
    if (next === node.value) return;
    const start = node.selectionStart;
    const end = node.selectionEnd;
    node.value = next;
    if (start !== null && end !== null) node.setSelectionRange(start, end);
  };
  node.addEventListener('input', fix, { capture: true });
  return {
    update(next: CaseRule | undefined) { current = next; },
    destroy() { node.removeEventListener('input', fix, { capture: true }); }
  };
}
