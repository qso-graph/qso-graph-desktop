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

// Watson, 2026-10-22: tokens, never hex. A colour written into a component,
// or anywhere in the stylesheet outside the theme blocks, is a colour the
// dark themes cannot redefine: the same defect as the --warn token that was
// missing from one dark block. Black shadows are not hues, and are allowed.
describe('no colour is written outside the theme blocks', () => {
  const blocks = [':root {', ':root:not([data-theme="light"]) {', ':root[data-theme="dark"] {'];

  it('in the stylesheet, every declaration outside the theme blocks names a token', () => {
    let rest = css;
    for (const marker of blocks) {
      const start = rest.indexOf(marker);
      rest = rest.slice(0, start) + rest.slice(rest.indexOf('}', start) + 1);
    }
    const bodies = [...rest.matchAll(/\{([^{}]*)\}/g)].map(match => match[1]);
    expect(bodies.length, 'the rules are found').toBeGreaterThan(50);
    const literal = bodies.filter(body => /#[0-9a-f]{3,8}\b/i.test(body) || /rgba?\((?!0 0 0)/.test(body) || /hsla?\(/.test(body));
    expect(literal).toEqual([]);
  });

  it('in every component, none at all', async () => {
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir('packages', { recursive: true })).filter(file => file.endsWith('.svelte') && !file.includes('stories'));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter(file => {
      const text = readFileSync(`packages/${file}`, 'utf8');
      const styles = [...text.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
      return /#[0-9a-f]{3,8}\b/i.test(styles) || /rgba?\((?!0 0 0)/.test(styles) || /style="[^"]*#[0-9a-f]{3,8}/i.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('gives each place in the rail a hue of its own, defined in every theme', () => {
    for (const hue of ['--hue-callsigns', '--hue-locations', '--hue-general', '--hue-settings']) {
      for (const marker of blocks) expect(tokensIn(blockAfter(marker)).has(hue), `${hue} in ${marker}`).toBe(true);
    }
  });
});
