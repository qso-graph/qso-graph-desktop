// SPDX-License-Identifier: GPL-3.0-only
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { isComponent, isStory, missingStories, orphanStories } from '../scripts/stories.mjs';

describe('QGD-FRM-0006 every component has a story', () => {
  // There are no components yet, so the check passes trivially on this repo.
  // These plant some, which is the only way to know the rule works at all.
  const tree = [
    'src/renderer/ui/Rail.svelte',
    'src/renderer/ui/Rail.stories.ts',
    'src/renderer/ui/StatusBar.svelte',
    'src/renderer/pages/Settings.svelte',
    'src/renderer/pages/Settings.stories.svelte'
  ];

  it('names the component that has no story', () => {
    expect(missingStories(tree)).toEqual(['src/renderer/ui/StatusBar.svelte']);
  });

  it('accepts a story in any of the three forms', () => {
    for (const extension of ['js', 'ts', 'svelte']) {
      expect(missingStories([`a/B.svelte`, `a/B.stories.${extension}`])).toEqual([]);
    }
  });

  it('does not mistake a story for a component needing its own story', () => {
    expect(isStory('a/B.stories.svelte')).toBe(true);
    expect(isComponent('a/B.stories.svelte')).toBe(false);
    expect(isComponent('a/B.svelte')).toBe(true);
    expect(missingStories(['a/B.svelte', 'a/B.stories.svelte'])).toEqual([]);
  });

  it('notices a story whose component was renamed or removed', () => {
    expect(orphanStories(['a/Old.stories.ts', 'a/New.svelte', 'a/New.stories.ts'])).toEqual(['a/Old.stories.ts']);
  });

  it('matches a story to its own component, not to a similarly named one', () => {
    // List.svelte must not be satisfied by ListItem.stories.ts.
    expect(missingStories(['a/List.svelte', 'a/ListItem.svelte', 'a/ListItem.stories.ts']))
      .toEqual(['a/List.svelte']);
  });
});

describe('QGD-FRM-0009 the gallery is development-only', () => {
  it('keeps Storybook out of the shipped dependencies', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    for (const name of ['storybook', '@storybook/svelte-vite', '@storybook/addon-themes']) {
      expect(manifest.devDependencies[name], `${name} must be a devDependency`).toBeTruthy();
      expect(manifest.dependencies?.[name], `${name} must not ship`).toBeUndefined();
      // Pinned exactly, like everything else on a packaging path.
      expect(manifest.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('packages nothing of the gallery into the application', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    const files = manifest.build.files.join(' ');
    expect(files).not.toContain('storybook');
    // What is packaged is the compiled application, its manifest, the register
    // the engine reads its version from, the register of reference sources it
    // fetches from, and the migrations it applies. Nothing of ADIF's or POTA's
    // own data is in that list: QGD-REF-0001 and QGD-REF-0009 have it fetched
    // at run time, so what ships is where to get it and nothing more.
    expect(manifest.build.files).toEqual([
      'dist/**/*', 'package.json', 'LICENSE', 'data/postgres-build.json',
      'data/reference-sources.json', 'data/service-profiles.json', 'drizzle/**/*'
    ]);
  });

  it('keeps the built gallery out of the repository', async () => {
    expect(await readFile('.gitignore', 'utf8')).toContain('storybook-static/');
  });

  it('reports nothing anywhere', async () => {
    const config = await readFile('.storybook/main.js', 'utf8');
    expect(config).toContain('disableTelemetry: true');
  });
});

describe('every advertised story format has an indexer', () => {
  // .stories.svelte is accepted by the glob and by missingStories. Storybook
  // cannot index that format on its own: without addon-svelte-csf it fails with
  // "No matching indexer found", so a developer writing the Svelte-native form
  // would satisfy the pairing check and break the gallery.
  it('configures the indexer for the Svelte story format', async () => {
    const config = await readFile('.storybook/main.js', 'utf8');
    expect(config).toContain('@storybook/addon-svelte-csf');
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    expect(manifest.devDependencies['@storybook/addon-svelte-csf']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('advertises exactly the formats the pairing rule accepts', async () => {
    const config = await readFile('.storybook/main.js', 'utf8');
    // The glob and scripts/stories.mjs have to agree, or one of them is lying.
    expect(config).toContain('*.stories.@(js|ts|svelte)');
    for (const extension of ['js', 'ts', 'svelte']) {
      expect(isStory(`a/B.stories.${extension}`), `${extension} stories must be recognised`).toBe(true);
    }
  });
});

describe('QGD-FRM-0010 the patterns register', () => {
  it('names the five patterns a later application should copy', async () => {
    const register = JSON.parse(await readFile('data/story-patterns.json', 'utf8'));
    expect(register.patterns.map(entry => entry.id)).toEqual([
      'page-layout', 'form-validation', 'list-states', 'confirm-dialog', 'credential-test'
    ]);
    for (const entry of register.patterns) expect(entry.what.length).toBeGreaterThan(10);
  });
});
