// SPDX-License-Identifier: GPL-3.0-only
// The tick-box tree's logic (My Area, KI7MT, 2026-10-23): POTA's programs,
// their entities and their locations, any of them chosen.
import { describe, expect, it } from 'vitest';
import { holdsChoice, labelOf, toggled, visibleNodes, type PickNode } from '../packages/ui/tree-pick.js';

const tree: PickNode[] = [
  { id: 'JP', label: 'Japan', children: [{ id: 'JP-TK', label: 'Tokyo' }] },
  { id: 'US', label: 'United States of America', children: [
    { id: '6', label: 'Alaska', children: [{ id: 'US-AK', label: 'Alaska' }] },
    { id: '291', label: 'United States of America', children: [{ id: 'US-ID', label: 'Idaho' }, { id: 'US-MT', label: 'Montana' }] }
  ] }
];

describe('a tick-box tree', () => {
  it('shows everything for no search, a matching node with all beneath it, and the way down to a match', () => {
    expect(visibleNodes(tree, '  ')).toBe(tree);
    expect(visibleNodes(tree, 'japan')).toEqual([tree[0]]);
    expect(visibleNodes(tree, 'ida')).toEqual([{ ...tree[1], children: [{ ...tree[1]!.children![1], children: [{ id: 'US-ID', label: 'Idaho' }] }] }]);
    // A match at the middle level keeps that level whole.
    expect(visibleNodes(tree, 'alaska')[0]!.children!.map(node => node.id)).toEqual(['6']);
    expect(visibleNodes(tree, '291')[0]!.children![0]!.children).toHaveLength(2);
    expect(visibleNodes(tree, 'nowhere')).toEqual([]);
  });

  it('opens what holds a choice, at any depth, and names a choice', () => {
    expect(holdsChoice(tree[1]!, ['US-MT'])).toBe(true);
    expect(holdsChoice(tree[1]!, ['291'])).toBe(true);
    expect(holdsChoice(tree[0]!, ['US-MT'])).toBe(false);
    expect(labelOf(tree, '6')).toBe('Alaska');
    expect(labelOf(tree, 'US-ID')).toBe('Idaho');
    expect(labelOf(tree, 'XX')).toBeUndefined();
  });

  it('holds a choice to its most, and takes an item out when ticked again', () => {
    expect(toggled([], 'US-ID', 2)).toEqual(['US-ID']);
    expect(toggled(['US-ID'], 'US', 2)).toEqual(['US-ID', 'US']);
    expect(toggled(['US-ID', 'US'], 'US-OR', 2)).toEqual(['US-ID', 'US']);
    expect(toggled(['US-ID', 'US'], 'US-ID', 2)).toEqual(['US']);
  });
});
