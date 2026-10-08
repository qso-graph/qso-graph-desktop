// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEVEL, MAX_AGE_MS, RAISED_LEVEL_MS, REDACTED_FIELDS,
  effectiveLevel, plan, redactionPaths, type LogFile
} from '../src/logging.js';

const file = (name: string, bytes: number, modifiedMs: number): LogFile => ({ name, bytes, modifiedMs });
const NOW = 1_800_000_000_000;

describe('QGD-LOG-0003 redaction by field name', () => {
  it('covers the names a credential travels under', () => {
    for (const field of ['password', 'apiKey', 'api_key', 'secret', 'token', 'credentials']) {
      expect(REDACTED_FIELDS).toContain(field);
    }
  });
  it('redacts a name wherever it appears, not only at the top level', () => {
    const paths = redactionPaths(['password']);
    expect(paths).toContain('password');
    expect(paths).toContain('*.password');
    expect(paths).toContain('*.*.password');
  });
});

describe('QGD-LOG-0006 rotate by size', () => {
  it('rotates when the active file reaches the limit', () => {
    expect(plan([file('qg.log', 5 * 1024 * 1024, NOW)], { active: 'qg.log', nowMs: NOW }).rotate).toBe(true);
  });
  it('does not rotate below it', () => {
    expect(plan([file('qg.log', 1024, NOW)], { active: 'qg.log', nowMs: NOW }).rotate).toBe(false);
  });
  it('does not rotate on another file being large', () => {
    const files = [file('qg.log', 10, NOW), file('old.log', 99 * 1024 * 1024, NOW)];
    expect(plan(files, { active: 'qg.log', nowMs: NOW, maxTotalBytes: Number.MAX_SAFE_INTEGER }).rotate).toBe(false);
  });
});

describe('QGD-LOG-0008 retention by age', () => {
  it('removes what is older than the limit', () => {
    const files = [file('qg.log', 10, NOW), file('old.log', 10, NOW - MAX_AGE_MS - 1)];
    expect(plan(files, { active: 'qg.log', nowMs: NOW }).remove).toEqual(['old.log']);
  });
  it('keeps what is inside it', () => {
    const files = [file('qg.log', 10, NOW), file('recent.log', 10, NOW - 1000)];
    expect(plan(files, { active: 'qg.log', nowMs: NOW }).remove).toEqual([]);
  });
  it('never removes the active file, however old', () => {
    const files = [file('qg.log', 10, NOW - MAX_AGE_MS * 10)];
    expect(plan(files, { active: 'qg.log', nowMs: NOW }).remove).toEqual([]);
  });
});

describe('QGD-LOG-0007 a hard total cap, oldest first', () => {
  it('removes oldest first until the folder is inside the cap', () => {
    const files = [
      file('qg.log', 100, NOW),
      file('a.log', 100, NOW - 3000),
      file('b.log', 100, NOW - 2000),
      file('c.log', 100, NOW - 1000)
    ];
    const result = plan(files, { active: 'qg.log', nowMs: NOW, maxTotalBytes: 250 });
    expect(result.remove).toEqual(['a.log', 'b.log']);
  });
  it('stops as soon as the cap is met rather than emptying the folder', () => {
    const files = [file('qg.log', 100, NOW), file('a.log', 100, NOW - 2000), file('b.log', 100, NOW - 1000)];
    expect(plan(files, { active: 'qg.log', nowMs: NOW, maxTotalBytes: 250 }).remove).toEqual(['a.log']);
  });
  it('counts the engine\'s files in the same folder against the same cap', () => {
    const files = [file('qg.log', 100, NOW), file('postgresql-1.log', 400, NOW - 1000)];
    expect(plan(files, { active: 'qg.log', nowMs: NOW, maxTotalBytes: 250 }).remove).toEqual(['postgresql-1.log']);
  });
  it('does not name a file twice when age and the cap both catch it', () => {
    const files = [file('qg.log', 100, NOW), file('old.log', 400, NOW - MAX_AGE_MS - 1)];
    const result = plan(files, { active: 'qg.log', nowMs: NOW, maxTotalBytes: 250 });
    expect(result.remove).toEqual(['old.log']);
  });
});

describe('QGD-LOG-0009 and QGD-LOG-0010 level and its reversion', () => {
  const started = NOW - 60_000;
  it('defaults to info with no state at all', () => {
    expect(effectiveLevel(undefined, NOW, started)).toBe(DEFAULT_LEVEL);
    expect(effectiveLevel({}, NOW, started)).toBe(DEFAULT_LEVEL);
    expect(effectiveLevel({ level: 'nonsense' }, NOW, started)).toBe(DEFAULT_LEVEL);
  });
  it('honours a level raised in this session, inside the window', () => {
    expect(effectiveLevel({ level: 'debug', raisedAtMs: NOW - 1000 }, NOW, started)).toBe('debug');
  });
  it('reverts once the window has passed', () => {
    expect(effectiveLevel({ level: 'debug', raisedAtMs: NOW - RAISED_LEVEL_MS }, NOW, started)).toBe(DEFAULT_LEVEL);
  });
  it('reverts at restart, even well inside the window', () => {
    // Raised a second before this process started: a restart must lose it.
    expect(effectiveLevel({ level: 'debug', raisedAtMs: started - 1 }, NOW, started)).toBe(DEFAULT_LEVEL);
  });
  it('reverts when the raise carries no timestamp', () => {
    expect(effectiveLevel({ level: 'trace' }, NOW, started)).toBe(DEFAULT_LEVEL);
  });
  it('keeps a quieter level, which hides nothing the default would show', () => {
    expect(effectiveLevel({ level: 'error' }, NOW, started)).toBe('error');
  });
});

// The pure decisions are above. These exercise the logger itself, because
// QGD-LOG-0003 is a property of the configured logger, not of a decision: the
// point is that a caller who passes a secret by name still cannot log it.
describe('QGD-LOG-0003 redaction happens in the logger', () => {
  it('redacts a secret a caller passed, at the top level and nested', async () => {
    const { createLogger, ACTIVE_LOG } = await import('../src/logger.js');
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'qg-log-redaction-'));
    try {
      const log = createLogger('test', directory);
      log.warn({
        password: 'QG_FAKE_CREDENTIAL_top',
        credentials: { apiKey: 'QG_FAKE_CREDENTIAL_nested' },
        persona: 'home'
      }, 'a caller passed secrets');
      const text = await readFile(join(directory, ACTIVE_LOG), 'utf8');
      expect(text).not.toContain('QG_FAKE_CREDENTIAL');
      expect(text).toContain('[redacted]');
      // Non-secret context survives, or the log is useless.
      expect(text).toContain('home');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes one JSON object per line, naming the process that wrote it', async () => {
    const { createLogger, ACTIVE_LOG } = await import('../src/logger.js');
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'qg-log-shape-'));
    try {
      const log = createLogger('persona', directory);
      log.info({ command: 'list' }, 'first');
      log.info({ command: 'upsert' }, 'second');
      const lines = (await readFile(join(directory, ACTIVE_LOG), 'utf8')).split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        const record = JSON.parse(line);
        expect(record.process).toBe('persona');
        expect(typeof record.time).toBe('string');
        expect(typeof record.pid).toBe('number');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('QGD-LOG-0006 and QGD-LOG-0007 enforced on disk', () => {
  it('rotates an oversized active file and removes what the cap requires', async () => {
    const { enforceCaps, ACTIVE_LOG } = await import('../src/logger.js');
    const { mkdtemp, readdir, rm, writeFile, utimes } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'qg-log-caps-'));
    try {
      await writeFile(join(directory, ACTIVE_LOG), 'x'.repeat(6 * 1024 * 1024));
      const stale = join(directory, 'qg-desktop-old.log');
      await writeFile(stale, 'y');
      const ancient = new Date(Date.now() - MAX_AGE_MS - 60_000);
      await utimes(stale, ancient, ancient);

      const result = enforceCaps(directory);
      expect(result.rotated).toBe(true);
      expect(result.removed).toContain('qg-desktop-old.log');

      const after = await readdir(directory);
      // The oversized file was moved aside, not deleted: it is still the record.
      expect(after.some(name => /^qg-desktop-.*\.log$/.test(name) && name !== 'qg-desktop-old.log')).toBe(true);
      expect(after).not.toContain(ACTIVE_LOG);
      expect(after).not.toContain('qg-desktop-old.log');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
