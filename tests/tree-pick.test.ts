// SPDX-License-Identifier: GPL-3.0-only
// The tick-box tree's logic (My Area, KI7MT, 2026-10-23).
import { describe, expect, it } from 'vitest';
import { toggled, visibleGroups, type PickGroup } from '../packages/ui/tree-pick.js';

const groups: PickGroup[] = [
  { id: 'JP', label: 'Japan', items: [{ id: 'JP-TK', label: 'Tokyo' }] },
  { id: 'US', label: 'United States of America', items: [{ id: 'US-ID', label: 'Idaho' }, { id: 'US-MT', label: 'Montana' }, { id: 'US-OR', label: 'Oregon' }] }
];

describe('a tick-box tree', () => {
  it('shows everything for no search, the matching items for a name or a code, a whole group for its own name', () => {
    expect(visibleGroups(groups, '  ')).toBe(groups);
    expect(visibleGroups(groups, 'ida')).toEqual([{ ...groups[1], items: [{ id: 'US-ID', label: 'Idaho' }] }]);
    expect(visibleGroups(groups, 'us-mt').flatMap(group => group.items.map(item => item.id))).toEqual(['US-MT']);
    expect(visibleGroups(groups, 'japan')).toEqual([groups[0]]);
    expect(visibleGroups(groups, 'nowhere')).toEqual([]);
  });

  it('holds a choice to its most, and takes an item out when ticked again', () => {
    expect(toggled([], 'US-ID', 2)).toEqual(['US-ID']);
    expect(toggled(['US-ID'], 'US-MT', 2)).toEqual(['US-ID', 'US-MT']);
    expect(toggled(['US-ID', 'US-MT'], 'US-OR', 2)).toEqual(['US-ID', 'US-MT']);
    expect(toggled(['US-ID', 'US-MT'], 'US-ID', 2)).toEqual(['US-MT']);
  });
});
