// SPDX-License-Identifier: GPL-3.0-only
// QGD-CNV-0016: the case of what is typed, set as it is typed.
import { describe, expect, it } from 'vitest';
import { typedCase } from '../packages/ui/typed-case.js';

describe('the case of what is typed', () => {
  it.each([
    ['ki7mt', 'KI7MT'], ['ki7mt/p', 'KI7MT/P'], ['ve3/ki7mt', 'VE3/KI7MT'],
    ['us-2233', 'US-2233'], ['us-2233@us-id', 'US-2233@US-ID'], ['w7i/si-001', 'W7I/SI-001'], ['kff-0001', 'KFF-0001']
  ])('upper: %s becomes %s', (typed, shown) => expect(typedCase('upper', typed)).toBe(shown));

  it.each([
    ['dn13', 'DN13'], ['dn13TP', 'DN13tp'], ['Dn13tP42', 'DN13tp42'], ['dn13,dn14', 'DN13,DN14'], ['d', 'D'], ['dn1', 'DN1']
  ])('grid: %s becomes %s', (typed, shown) => expect(typedCase('grid', typed)).toBe(shown));

  it.each([
    ['id,Ada', 'ID,Ada'], ['ca,Los Angeles', 'CA,Los Angeles'], ['id', 'ID'], ['ga,Dekalb', 'GA,Dekalb']
  ])('county: %s becomes %s, the name as typed', (typed, shown) => expect(typedCase('county', typed)).toBe(shown));

  it('changes nothing but case: same length, same characters', () => {
    for (const [rule, typed] of [['upper', 'ki7mt/p '], ['grid', 'dn13tp'], ['county', 'id,ada ']] as const) {
      const shown = typedCase(rule, typed);
      expect(shown).toHaveLength(typed.length);
      expect(shown.toLowerCase()).toBe(typed.toLowerCase());
    }
  });
});
