// SPDX-License-Identifier: GPL-3.0-only
// Every colour the light theme defines is defined again by both dark blocks:
// the one that follows a dark system and the one the operator picks. A token
// left out keeps the light value inside a dark page. --warn was, in the
// chosen-dark block only, so with Dark the default and the system Light, the
// Home notice was a near-white box on a near-black page (found by Watson,
// 2026-10-22). No screenshot could see it: baselines are taken on one system
// appearance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/renderer/style.css', 'utf8');
const tokensIn = block => new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]));
const blockAfter = (marker) => {
  const start = css.indexOf(marker);
  expect(start, `${marker} is in the stylesheet`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

describe('the dark themes redefine every colour the light theme has', () => {
  const light = tokensIn(blockAfter(':root {'));
  const followsSystem = tokensIn(blockAfter(':root:not([data-theme="light"]) {'));
  const chosen = tokensIn(blockAfter(':root[data-theme="dark"] {'));
  const colours = [...light].filter(token => /#[0-9a-f]{3,8}\b|rgb|hsl/i.test(blockAfter(':root {').split(`${token}:`)[1]?.split(';')[0] ?? ''));

  it('finds the light theme\'s colours', () => {
    expect(colours.length).toBeGreaterThan(10);
  });

  it.each([['following a dark system', followsSystem], ['chosen in Settings', chosen]])('dark, %s', (_which, dark) => {
    expect(colours.filter(token => !dark.has(token))).toEqual([]);
  });

  it('the two dark blocks define the same colours', () => {
    expect([...followsSystem].sort()).toEqual([...chosen].sort());
  });
});
