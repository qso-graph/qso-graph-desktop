// SPDX-License-Identifier: GPL-3.0-only
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateLogsCommand, LOG_LEVELS } from '../src/logs-contract.js';
import { suggestedExportName } from '../src/logs-broker.js';
import { currentLevel, setLevel } from '../src/logger.js';
import { DEFAULT_LEVEL, LEVELS, RAISED_LEVEL_MS, effectiveLevel } from '../src/logging.js';

describe('QGD-SEC-0006 the logs channel rejects rather than coerces', () => {
  it('accepts exactly the three commands', () => {
    expect(validateLogsCommand({ type: 'read' })).toBe(true);
    expect(validateLogsCommand({ type: 'export' })).toBe(true);
    for (const level of LOG_LEVELS) {
      expect(validateLogsCommand({ type: 'set-level', level })).toBe(true);
    }
  });

  it('refuses a level that is not one', () => {
    for (const level of ['DEBUG', 'verbose', '', 'info ', 0, null, undefined, {}, ['debug']]) {
      expect(validateLogsCommand({ type: 'set-level', level }), `${String(level)} is not a level`).toBe(false);
    }
    expect(validateLogsCommand({ type: 'set-level' })).toBe(false);
  });

  it('refuses a prototype-polluting or unknown shape', () => {
    for (const command of [
      { type: '__proto__' },
      { type: 'constructor' },
      { type: 'read', extra: 1 },
      { type: 'set-level', level: 'debug', extra: 1 },
      { type: 'export', path: '/tmp/anywhere' },
      JSON.parse('{"type":"read","__proto__":{"polluted":true}}'),
      'read', 42, null, undefined, ['read'], () => {}
    ]) {
      expect(validateLogsCommand(command), `${JSON.stringify(command) ?? String(command)} must be refused`).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('offers no destination of its own', () => {
    // QGD-LOG-0012: the user chooses where the archive goes. A command that
    // carried a path would be the renderer choosing, which is the thing the
    // save dialog exists to prevent.
    expect(validateLogsCommand({ type: 'export', destination: '/tmp/x.zip' })).toBe(false);
  });
});

describe('the suggested export name', () => {
  it('is dated, so two exports are tellable apart', () => {
    const first = suggestedExportName(Date.UTC(2026, 9, 8, 14, 5, 9));
    expect(first).toBe('qg-desktop-diagnostics-2026-10-08-14-05-09.zip');
    expect(suggestedExportName(Date.UTC(2026, 9, 15, 14, 5, 9))).not.toBe(first);
  });

  it('is a plain file name with no separator in it', () => {
    expect(suggestedExportName(Date.now())).not.toContain('/');
    expect(suggestedExportName(Date.now())).not.toContain('..');
  });
});

describe('QGD-LOG-0009 and QGD-LOG-0010 the level switch', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'qg-logs-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('writes a level the running process then reads back', () => {
    expect(currentLevel(directory)).toBe(DEFAULT_LEVEL);
    expect(setLevel('debug', directory)).toBe(true);
    expect(currentLevel(directory)).toBe('debug');
  });

  it('records when a raise happened, so it can expire', async () => {
    const raisedAt = Date.now();
    setLevel('debug', directory, raisedAt);
    const state = JSON.parse(await readFile(join(directory, 'level.json'), 'utf8')) as Record<string, unknown>;
    expect(state.level).toBe('debug');
    expect(state.raisedAtMs).toBe(raisedAt);

    // The hour, and the restart. Both halves of QGD-LOG-0010, read off what
    // setLevel actually wrote rather than a hand-built state.
    const stillRaised = effectiveLevel(state, raisedAt + RAISED_LEVEL_MS - 1, raisedAt - 1000);
    expect(stillRaised).toBe('debug');
    expect(effectiveLevel(state, raisedAt + RAISED_LEVEL_MS, raisedAt - 1000)).toBe(DEFAULT_LEVEL);
    expect(effectiveLevel(state, raisedAt + 1000, raisedAt + 500)).toBe(DEFAULT_LEVEL);
  });

  it('records no raise time for the default, which cannot be left on', async () => {
    setLevel('debug', directory);
    setLevel(DEFAULT_LEVEL, directory);
    const state = JSON.parse(await readFile(join(directory, 'level.json'), 'utf8')) as Record<string, unknown>;
    expect(state).toEqual({ level: DEFAULT_LEVEL });
    expect(currentLevel(directory)).toBe(DEFAULT_LEVEL);
  });

  it('keeps a quietening, which hides nothing the default would have shown', () => {
    // warn and above are less verbose than info, so they are not a raise and
    // do not expire.
    for (const level of LEVELS.filter(name => LEVELS.indexOf(name) > LEVELS.indexOf(DEFAULT_LEVEL))) {
      setLevel(level, directory);
      expect(currentLevel(directory, Date.now() + RAISED_LEVEL_MS * 10)).toBe(level);
    }
  });

  it('leaves the level alone when the folder cannot be written', () => {
    expect(setLevel('debug', join(directory, 'missing', '\0bad'))).toBe(false);
  });

  it('writes the file atomically, leaving no temporary behind', async () => {
    setLevel('trace', directory);
    const { readdir } = await import('node:fs/promises');
    const names = await readdir(directory);
    expect(names).toEqual(['level.json']);
  });
});
