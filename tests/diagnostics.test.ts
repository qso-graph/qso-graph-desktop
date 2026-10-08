// SPDX-License-Identifier: GPL-3.0-only
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, redactForExport, zip } from '../src/diagnostics.js';

describe('QGD-LOG-0012 the archive', () => {
  it('computes the checksum the format requires', () => {
    // The published check value for this input.
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.from(''))).toBe(0);
  });

  it('writes an archive the operating system can open and extract', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qg-zip-'));
    try {
      const small = Buffer.from('short');
      const large = Buffer.from('a log line that repeats itself. '.repeat(200));
      const archive = zip([
        { name: 'qg-desktop.log', content: large },
        { name: 'notes.txt', content: small }
      ]);
      const path = join(directory, 'diagnostics.zip');
      await writeFile(path, archive);

      // The system's own unzip is the arbiter, not our reading of our writing.
      const tested = execFileSync('/usr/bin/unzip', ['-t', path], { encoding: 'utf8' });
      expect(tested).toContain('No errors detected');

      execFileSync('/usr/bin/unzip', ['-q', '-o', path, '-d', join(directory, 'out')]);
      expect(await readFile(join(directory, 'out', 'qg-desktop.log'))).toEqual(large);
      expect(await readFile(join(directory, 'out', 'notes.txt'))).toEqual(small);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes a well-formed empty archive rather than a corrupt one', async () => {
    const archive = zip([]);
    // An empty zip is just the end-of-central-directory record.
    expect(archive).toHaveLength(22);
    expect(archive.readUInt32LE(0)).toBe(0x06054b50);
    expect(archive.readUInt16LE(10)).toBe(0);

    const directory = await mkdtemp(join(tmpdir(), 'qg-zip-empty-'));
    try {
      const path = join(directory, 'empty.zip');
      await writeFile(path, archive);
      // unzip warns on an empty archive and exits non-zero. The distinction
      // that matters is empty rather than damaged.
      let output = '';
      try { output = execFileSync('/usr/bin/unzip', ['-l', path], { encoding: 'utf8' }); }
      catch (error) { output = `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`; }
      expect(output).toContain('zipfile is empty');
      expect(output).not.toContain('cannot find');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('QGD-LOG-0012 redaction before export', () => {
  it('removes a secret from a structured line', () => {
    const line = '{"level":30,"password":"hunter2","apiKey":"abcd","persona":"home","msg":"saved"}';
    const out = redactForExport(line);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abcd');
    // Context a reader needs survives.
    expect(out).toContain('home');
    expect(out).toContain('saved');
  });

  it('removes a sentinel wherever it appears', () => {
    expect(redactForExport('value QG_FAKE_CREDENTIAL_abc123 here')).not.toContain('QG_FAKE_CREDENTIAL');
  });

  it('removes a secret from a plain-text line, which the logger never wrote', () => {
    // The engine's own log, from P4, does not come through our logger.
    expect(redactForExport('connection failed password=s3cret host=localhost')).not.toContain('s3cret');
    expect(redactForExport('connection failed password=s3cret host=localhost')).toContain('localhost');
  });

  it('leaves an ordinary line alone', () => {
    const line = '{"level":30,"process":"persona","command":"list","msg":"handled"}';
    expect(redactForExport(line)).toBe(line);
  });
});

describe('QGD-LOG-0012 the export', () => {
  it('archives the log folder with secrets removed, and leaves the originals alone', async () => {
    const { mkdir } = await import('node:fs/promises');
    const { exportDiagnostics } = await import('../src/diagnostics.js');
    const directory = await mkdtemp(join(tmpdir(), 'qg-export-'));
    const logs = join(directory, 'logs');
    await mkdir(logs, { recursive: true });
    try {
      // A line as the logger writes it, and one that reached the folder some
      // other way carrying a secret the logger never saw.
      await writeFile(join(logs, 'qg-desktop.log'),
        '{"level":30,"process":"persona","command":"list","msg":"handled"}\n' +
        '{"level":40,"password":"QG_FAKE_CREDENTIAL_slipped","msg":"something"}\n');
      await writeFile(join(logs, 'postgresql.log'), 'FATAL password=s3cret for user qg\n');

      const destination = join(directory, 'diagnostics.zip');
      const summary = await exportDiagnostics(logs, destination);
      expect(summary.files).toBe(2);
      expect(summary.bytes).toBeGreaterThan(0);

      expect(execFileSync('/usr/bin/unzip', ['-t', destination], { encoding: 'utf8' })).toContain('No errors detected');
      execFileSync('/usr/bin/unzip', ['-q', '-o', destination, '-d', join(directory, 'out')]);

      const exported = await readFile(join(directory, 'out', 'qg-desktop.log'), 'utf8');
      expect(exported).not.toContain('QG_FAKE_CREDENTIAL');
      expect(exported).toContain('[redacted]');
      // What a reader needs is still there.
      expect(exported).toContain('"command":"list"');

      const engine = await readFile(join(directory, 'out', 'postgresql.log'), 'utf8');
      expect(engine).not.toContain('s3cret');
      expect(engine).toContain('for user qg');

      // The export reads; it does not rewrite the logs it came from.
      expect(await readFile(join(logs, 'postgresql.log'), 'utf8')).toContain('s3cret');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('produces an archive even when there is nothing to export', async () => {
    const { mkdir } = await import('node:fs/promises');
    const { exportDiagnostics } = await import('../src/diagnostics.js');
    const directory = await mkdtemp(join(tmpdir(), 'qg-export-empty-'));
    try {
      const logs = join(directory, 'logs');
      await mkdir(logs, { recursive: true });
      const summary = await exportDiagnostics(logs, join(directory, 'diagnostics.zip'));
      expect(summary.files).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('QGD-LOG-0012 redaction by field, whatever the value is', () => {
  it.each([
    ['{"credentials":{"value":"synthetic"},"msg":"x"}', 'synthetic', 'an object under a sensitive key'],
    ['{"token":123456,"msg":"x"}', '123456', 'a number'],
    ['{"secret":["a","b"],"msg":"x"}', '"a"', 'an array'],
    ['{"password":null,"apiKey":true,"msg":"x"}', 'true', 'null and boolean'],
    ['{"outer":{"inner":{"password":"deep"}},"msg":"x"}', 'deep', 'nested two levels down'],
    ['{"list":[{"apiKey":"inArray"}],"msg":"x"}', 'inArray', 'inside an array of objects']
  ])('removes %#: %s', (line, secret) => {
    const out = redactForExport(line);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
    expect(out).toContain('"msg":"x"');
  });

  it.each([
    ["password='synthetic demo secret'", 'synthetic demo secret', 'single quotes'],
    ['password="synthetic demo secret"', 'synthetic demo secret', 'double quotes'],
    ['api_key = "spaced out value"', 'spaced out value', 'spacing and an underscore'],
    ['FATAL token: bare-value here', 'bare-value', 'an unquoted value']
  ])('removes a quoted plain-text value %#: %s', (line, secret) => {
    expect(redactForExport(line)).not.toContain(secret);
  });

  it('keeps a line that is not a record readable', () => {
    const line = 'FATAL connection refused for user qg on port 5432';
    expect(redactForExport(line)).toBe(line);
  });

  it('keeps the shape of a multi-line file, trailing newline included', () => {
    const text = '{"a":1}\n{"password":"x"}\n';
    const out = redactForExport(text);
    expect(out.split('\n')).toHaveLength(3);
    expect(out.endsWith('\n')).toBe(true);
    expect(out).not.toContain('"x"');
  });
});

describe('QGD-LOG-0012 the lines that do not take the structured path', () => {
  it.each([
    ['{"msg":"connection failed password=synthetic host=localhost"}', 'synthetic', 'a secret inside a message string'],
    ['ERROR {"password":"synthetic"}', 'synthetic', 'a record behind a prefix'],
    ['{"password":"synthetic","msg":', 'synthetic', 'a truncated record'],
    ['  "password": "synthetic",', 'synthetic', 'one line of pretty-printed JSON'],
    ['[{"apiKey":"synthetic"}]', 'synthetic', 'a top-level array'],
    ['{"nested":{"msg":"token=synthetic"}}', 'synthetic', 'an assignment nested in a string value']
  ])('removes %#: %s', (line, secret) => {
    expect(redactForExport(line)).not.toContain(secret);
  });

  it('still leaves an ordinary message intact', () => {
    const line = '{"level":30,"process":"persona","command":"list","msg":"handled"}';
    expect(redactForExport(line)).toBe(line);
  });

  it('keeps the host and the reason a reader needs', () => {
    const out = redactForExport('{"msg":"connection failed password=synthetic host=localhost"}');
    expect(out).toContain('host=localhost');
    expect(out).toContain('connection failed');
  });
});

// Every shape that has ever been found to leak, in one place. A rewrite that
// loses coverage fails here immediately — which is how the last three rounds of
// regressions would have been caught before they were committed. This list only
// grows.
const LEAK_CORPUS: readonly [string, string][] = [
  ['{"password":"synthetic"}', 'synthetic'],
  ['{"credentials":{"value":"synthetic"}}', 'synthetic'],
  ['{"token":123456}', '123456'],
  ['{"secret":["synthetic"]}', 'synthetic'],
  ['{"outer":{"inner":{"password":"synthetic"}}}', 'synthetic'],
  ['{"list":[{"apiKey":"synthetic"}]}', 'synthetic'],
  ['{"msg":"connection failed password=synthetic host=localhost"}', 'synthetic'],
  ['{"nested":{"msg":"token=synthetic"}}', 'synthetic'],
  ['ERROR {"password":"synthetic"}', 'synthetic'],
  ['{"password":"synthetic","msg":', 'synthetic'],
  ['  "password": "synthetic",', 'synthetic'],
  ['[{"apiKey":"synthetic"}]', 'synthetic'],
  ["password='synthetic demo'", 'synthetic demo'],
  ['password="synthetic demo"', 'synthetic demo'],
  ['api_key = "synthetic demo"', 'synthetic demo'],
  ['FATAL token: synthetic', 'synthetic'],
  ['access_token=synthetic', 'synthetic'],
  ['db_password=synthetic', 'synthetic'],
  ['password=abc]synthetic', 'abc]synthetic'],
  ['password=}synthetic', '}synthetic'],
  ['passphrase=synthetic', 'synthetic'],
  ['value QG_FAKE_CREDENTIAL_abc here', 'QG_FAKE_CREDENTIAL_abc']
];

describe('QGD-LOG-0012 nothing in the corpus survives an export', () => {
  it.each(LEAK_CORPUS)('removes the secret from %s', (line, secret) => {
    expect(redactForExport(line)).not.toContain(secret);
  });

  it('removes every one of them when they arrive as one file', () => {
    const file = LEAK_CORPUS.map(([line]) => line).join('\n') + '\n';
    const out = redactForExport(file);
    for (const [, secret] of LEAK_CORPUS) expect(out).not.toContain(secret);
    expect(out.split('\n')).toHaveLength(LEAK_CORPUS.length + 1);
  });
});
