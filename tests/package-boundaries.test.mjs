// SPDX-License-Identifier: GPL-3.0-only
// QGD-REP-0006's guarantee: the boundary gate fails when a wrong-direction
// import is there to be found.
//
// Controls, not a clean run. A gate like this is worth exactly what it catches,
// and the whole reason it exists is that four gates in this project went quiet
// — ESLint reviewing no Svelte, svelte-check excluding every story, the network
// scan's scope, and svelte-check again when this restructure moved every
// component out from under its walk root. So each refusal below is proven by
// building a tree that should fail and watching it fail.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALLOWED, ALLOWED_FOR_APPS, FRAME_TO_APP_ALLOWANCE, crossings, judge, namedAllowance
} from '../scripts/package-boundaries.mjs';

let root;
beforeAll(async () => {
  // A miniature packages/ tree: who imports whom is the whole content.
  root = await mkdtemp(join(tmpdir(), 'qg-boundaries-'));
  const write = async (path, text) => {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  };
  await mkdir(join(root, 'ui'), { recursive: true });
  await mkdir(join(root, 'main'), { recursive: true });
  await mkdir(join(root, 'renderer'), { recursive: true });
  await mkdir(join(root, 'logging'), { recursive: true });
  await write('logging/logging.ts', 'export const LEVEL = 1;\n');
  await write('ui/Field.svelte', "<script lang=\"ts\">\n  import { LEVEL } from '../logging/logging.js';\n</script>\n");
  await write('ui/Rail.stories.svelte', "<script lang=\"ts\">\n  import { PAGES } from '../renderer/shell-store.js';\n</script>\n");
  await write('main/main.ts', "import Field from '../ui/Field.svelte';\n");
  await write('renderer/shell-store.ts', "import { LEVEL } from '../main/main.js';\n");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('the boundary gate reads the imports', () => {
  it('finds every crossing and no import that stays inside its package', async () => {
    const found = await crossings(root);
    const edges = found.map(crossing => `${crossing.owner}->${crossing.reached}`).sort();
    expect(edges).toEqual(['main->ui', 'renderer->main', 'ui->logging', 'ui->renderer']);
  });

  it('refuses a component reaching into the frame', async () => {
    // ui is a leaf: it may depend on no package at all. This is the edge the
    // restructure found for real — ThemeChoice.svelte took the words System,
    // Light and Dark from the frame's settings contract.
    const found = await crossings(root);
    const uiToLogging = found.find(crossing => crossing.owner === 'ui' && crossing.reached === 'logging');
    expect(judge(uiToLogging)).toEqual({ verdict: 'refused', why: 'ui may not depend on logging' });
  });

  it('refuses the frame reaching up into the renderer', async () => {
    const found = await crossings(root);
    const rendererToMain = found.find(crossing => crossing.owner === 'renderer');
    // The permitted direction, as a control on the refusals above: this gate
    // is not simply saying no to everything.
    expect(judge(rendererToMain)).toEqual({ verdict: 'allowed' });

    const mainToUi = found.find(crossing => crossing.owner === 'main');
    expect(judge(mainToUi)).toEqual({ verdict: 'allowed' });

    // And the same import, written the wrong way round, is refused.
    expect(judge({ owner: 'main', reached: 'renderer', story: false }))
      .toEqual({ verdict: 'refused', why: 'main may not depend on renderer' });
  });

  it('waives a story and only a story, and only where the direction is refused', async () => {
    const found = await crossings(root);
    const story = found.find(crossing => crossing.story);
    expect(story.owner).toBe('ui');
    expect(judge(story).verdict).toBe('waived');

    // The same crossing from a component that is not a story is refused, which
    // is what makes the waiver a waiver rather than a hole.
    expect(judge({ ...story, story: false }).verdict).toBe('refused');
  });

  it('refuses a package nobody has decided about', () => {
    expect(judge({ owner: 'invented', reached: 'main', story: false }))
      .toEqual({ verdict: 'refused', why: 'invented is not a package QGD-REP-0001 lists' });
  });
});

describe('the real tree', () => {
  it('has no refused crossing', async () => {
    const refused = (await crossings())
      .map(crossing => ({ crossing, ...judge(crossing) }))
      .filter(entry => entry.verdict === 'refused');
    expect(refused.map(entry => `${entry.crossing.file}: ${entry.why}`)).toEqual([]);
  });

  it('is not vacuous: the frame really does cross packages', async () => {
    // The failure this guards against is the gate's own walk root being wrong,
    // which is how svelte-check passed on an empty tree during this very
    // restructure.
    const found = await crossings();
    expect(found.length).toBeGreaterThan(20);
    expect(new Set(found.map(crossing => crossing.owner)).size).toBeGreaterThan(3);
  });

  it('decides about every package that exists, and invents none', async () => {
    // A package added without a line in ALLOWED would be refused the moment it
    // imported anything — but a package that imports nothing would slip past
    // undecided, so the set is compared directly.
    const onDisk = (await readdir('packages', { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    expect(Object.keys(ALLOWED).sort()).toEqual(onDisk);
  });

  it('describes a direction with no cycle in it', () => {
    // The table is the policy, so a cycle in the table would permit one in the
    // code. app-api was briefly written with main on both sides of the arrow.
    const seen = new Map();
    const visit = (name, trail) => {
      if (trail.includes(name)) throw new Error(`cycle: ${[...trail, name].join(' -> ')}`);
      if (seen.has(name)) return;
      for (const next of ALLOWED[name] ?? []) visit(next, [...trail, name]);
      seen.set(name, true);
    };
    for (const name of Object.keys(ALLOWED)) expect(() => visit(name, [])).not.toThrow();
  });

  it('holds an application to the app API and the components, and nothing else', () => {
    // QGD-REP-0003, structurally. apps/ is empty until QGD-PRT-0108, so what
    // is asserted here is the rule the first one will meet.
    expect([...ALLOWED_FOR_APPS].sort()).toEqual(['app-api', 'ui']);
    for (const reachable of ALLOWED_FOR_APPS) {
      expect(Object.keys(ALLOWED), `${reachable} is a real package`).toContain(reachable);
    }
    for (const frame of ['engine', 'storage', 'personas', 'persona-core', 'main', 'reference']) {
      expect(ALLOWED_FOR_APPS, `an application must not reach ${frame} directly`).not.toContain(frame);
    }
  });

  it('lets no package reach an application, there being no named exception', () => {
    // The table held one entry until 2026-10-10 — the host that mounted the
    // demonstration applications — and it is empty now that they are gone
    // (QGD-APP-0014). Empty is the rule as written: the frame must not depend
    // on an application.
    expect(Object.keys(FRAME_TO_APP_ALLOWANCE)).toEqual([]);
    for (const file of [
      'packages/renderer/Shell.svelte',
      'packages/main/main.ts',
      'packages/renderer/app.ts',
      'packages/ui/Rail.svelte'
    ]) {
      for (const target of [join('apps', 'qg-adif', 'AdifPage.svelte'), join('apps', 'other', 'private.ts')]) {
        expect(namedAllowance(file, target), `${file} may not reach ${target}`).toBe(false);
      }
    }
  });

  it('would still refuse an importer handed a whole directory', () => {
    // The defect the mechanism was fixed for, kept as a control so it cannot
    // come back when the sandboxed-tier Part needs its one exception: an
    // allowance is a named file reaching a named file, never an importer
    // granted everything under a root.
    const table = { 'packages/renderer/Shell.svelte': { target: join('apps', 'qg-adif', 'AdifPage.svelte'), why: 'hypothetical' } };
    const allows = (file, target) => {
      const allowance = table[file];
      return allowance !== undefined && target === allowance.target;
    };
    expect(allows('packages/renderer/Shell.svelte', join('apps', 'qg-adif', 'AdifPage.svelte'))).toBe(true);
    expect(allows('packages/renderer/Shell.svelte', join('apps', 'qg-adif', 'secret.ts'))).toBe(false);
    expect(allows('packages/main/main.ts', join('apps', 'qg-adif', 'AdifPage.svelte'))).toBe(false);
  });
});
