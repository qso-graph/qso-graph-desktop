// SPDX-License-Identifier: GPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginProcessRun, readRunRecord, recordUtilityProcess, startProcessRun } from '../packages/main/process-run.js';
import { macProcessInfo, sameProcess, type ProcessIdentity, type ProcessRow } from '../packages/main/process-platform.js';

const id = '00000000-0000-4000-8000-000000000001';
const birth = (pid: number, micros = 1): ProcessIdentity => ({ pid, start: `mac:1700000000:${micros}` });
const row = (pid: number, ppid = 900, micros = 1): ProcessRow => ({ ...birth(pid, micros), ppid });
const previous = () => ({ version: 1 as const, run: id, at: 1000, root: birth(20), children: [
  { ...birth(21), parent: birth(20) }, { ...birth(22), parent: birth(21) }
] });
function fixture(record: unknown = previous(), rows = [row(1), row(21), row(22)]) {
  let saved = structuredClone(record);
  const table = {
    read: vi.fn(() => structuredClone(rows)),
    end: vi.fn((identity: ProcessIdentity) => { const index = rows.findIndex(p => sameProcess(p, identity)); if (index >= 0) rows.splice(index, 1); })
  };
  let clock = 2000;
  const deps = { table, pid: 1, now: vi.fn(() => clock), wait: vi.fn(async (ms: number) => { clock += ms; }), id: () => id,
    read: vi.fn(() => saved), write: vi.fn(value => { saved = structuredClone(value); }) };
  return { table, deps, rows, saved: () => saved as ReturnType<typeof previous> };
}

describe('P14-clean-run (QGD-FRM-0030, QGD-PRC-0007)', () => {
  it('ends matched orphans, leaf first, before writing the new run identity', async () => {
    const f = fixture();
    f.deps.write.mockImplementation(record => { expect(f.rows.map(p => p.pid)).toEqual([1]); });
    await beginProcessRun(true, f.deps);
    expect(f.table.end.mock.calls.map(([p]) => p.pid)).toEqual([22, 21]);
    expect(f.deps.write).toHaveBeenCalledWith({ version: 1, run: id, at: 2000, root: birth(1), children: [] });
  });

  it('ends a still-matching old root too, but never follows its unrecorded descendants', async () => {
    const f = fixture(previous(), [row(1), row(20), row(21, 20), row(22, 21), row(23, 22)]);
    await beginProcessRun(true, f.deps);
    expect(f.table.end.mock.calls.map(([p]) => p.pid)).toEqual([22, 21, 20]);
    expect(f.rows.map(p => p.pid)).toEqual([1, 23]);
  });

  it('leaves a reused pid alone, including reuse within the same second', async () => {
    const f = fixture(previous(), [row(1), row(21, 900, 2), row(22, 900, 2)]);
    await beginProcessRun(true, f.deps);
    expect(f.table.end).not.toHaveBeenCalled(); expect(f.rows).toHaveLength(3);
  });

  it('does absolutely nothing on a launch that loses the lock', async () => {
    const f = fixture(); expect(await beginProcessRun(false, f.deps)).toBeUndefined();
    expect(f.table.read).not.toHaveBeenCalled(); expect(f.table.end).not.toHaveBeenCalled();
    expect(f.deps.read).not.toHaveBeenCalled(); expect(f.deps.write).not.toHaveBeenCalled(); expect(f.deps.now).not.toHaveBeenCalled();
  });

  it('leaves the detached installer alone even while its recorded parent still lives', async () => {
    const f = fixture(previous(), [row(1), row(20), row(21, 20), row(22, 21), row(30, 20)]);
    await beginProcessRun(true, f.deps);
    expect(f.rows).toContainEqual(row(30, 20));
    expect(f.table.end.mock.calls.map(([p]) => p.pid)).not.toContain(30);
  });

  it('does not end the running instance or anything in a record containing it', async () => {
    const record = previous(); record.root = birth(1); record.children[0].parent = birth(1);
    const f = fixture(record); await beginProcessRun(true, f.deps);
    expect(f.table.end).not.toHaveBeenCalled();
  });

  it.each([null, 'broken', {}, { ...previous(), version: 2 }, { ...previous(), extra: true },
    { ...previous(), run: '../foreign' }, { ...previous(), at: NaN },
    { ...previous(), root: { ...birth(20), pid: -1 } },
    { ...previous(), children: [{ ...birth(21), parent: birth(999) }] },
    { ...previous(), children: [{ ...birth(21), start: 'program-name', parent: birth(20) }] },
    { ...previous(), children: [previous().children[1], previous().children[0]] },
    { ...previous(), children: [...previous().children, previous().children[0]] },
    { ...previous(), children: [{ ...birth(21), parent: { ...birth(20), extra: true } }] }
  ])('ignores malformed records without ending anything: %j', async record => {
    const f = fixture(record); await beginProcessRun(true, f.deps);
    expect(f.table.end).not.toHaveBeenCalled(); expect(f.deps.write).toHaveBeenCalledOnce();
  });

  it('ignores unreadable/truncated JSON and never uses a partial record', async () => {
    const f = fixture(); f.deps.read.mockImplementation(() => JSON.parse('{"root":'));
    await beginProcessRun(true, f.deps); expect(f.table.end).not.toHaveBeenCalled();
  });

  it('waits for an asynchronous OS termination with the injected clock', async () => {
    const f = fixture(); f.table.end.mockImplementation(() => {});
    f.deps.wait.mockImplementation(async () => { f.rows.splice(1); });
    await beginProcessRun(true, f.deps);
    expect(f.deps.wait).toHaveBeenCalledWith(50); expect(f.deps.write).toHaveBeenCalledOnce();
  });

  it('cleans a prior run even when the wall clock has moved backwards', async () => {
    const f = fixture(); f.deps.now.mockReturnValue(0); await beginProcessRun(true, f.deps);
    expect(f.table.end).toHaveBeenCalledTimes(2); expect(f.saved().at).toBe(0);
  });

  it('stops startup if a proven orphan cannot be ended, preserving its journal', async () => {
    const f = fixture(); f.table.end.mockImplementation(() => {});
    await expect(beginProcessRun(true, f.deps)).rejects.toThrow('could not be ended');
    expect(f.deps.write).not.toHaveBeenCalled(); expect(f.deps.wait).toHaveBeenCalledTimes(40);
  });

  it('checks again immediately before ending a previously matched identity', async () => {
    const f = fixture(); let reads = 0;
    f.table.read.mockImplementation(() => { reads++; return [row(1), row(21, 900, reads === 1 ? 1 : 2), row(22, 900, 2)]; });
    await beginProcessRun(true, f.deps); expect(f.table.end).not.toHaveBeenCalled();
  });

  it('records current descendants with their identified parents and the injected clock', async () => {
    const f = fixture(null, [row(1), row(4, 3), row(3, 1), row(99)]);
    const run = (await beginProcessRun(true, f.deps))!; run.capture();
    expect(f.saved().children).toEqual([{ ...birth(3), parent: birth(1) }, { ...birth(4), parent: birth(3) }]);
    expect(readRunRecord(f.saved())).toEqual(f.saved());
    expect(f.saved().at).toBe(2000); expect(f.saved().run).toBe(id);
  });

  it('records replacement children but never adopts children of a reused former parent', async () => {
    const f = fixture(null, [row(1), row(3, 1)]); const run = (await beginProcessRun(true, f.deps))!; run.capture();
    f.rows.splice(1, 1, row(3, 999, 2), row(4, 3)); run.capture();
    expect(f.saved().children).toEqual([{ ...birth(3), parent: birth(1) }]);
    f.rows.push(row(5, 1, 3)); run.capture();
    expect(f.saved().children).toContainEqual({ ...birth(5, 3), parent: birth(1) });
  });

  it('freezes before the installer launches; ends every matched application child and descendant at shutdown', async () => {
    const f = fixture(null, [row(1), row(3, 1), row(4, 3)]);
    const run = (await beginProcessRun(true, f.deps))!; run.stop();
    f.rows.push(row(30, 1)); run.capture(); await run.endChildren();
    expect(f.table.end.mock.calls.map(([p]) => p.pid)).toEqual([4, 3]);
    expect(f.rows).toEqual([row(1), row(30, 1)]); expect(f.saved().children).toHaveLength(2);
  });

  it('does not kill a pid reused between recording and clean shutdown', async () => {
    const f = fixture(null, [row(1), row(3, 1)]); const run = (await beginProcessRun(true, f.deps))!; run.stop();
    f.rows.splice(1, 1, row(3, 999, 2)); run.endChildren(); expect(f.table.end).not.toHaveBeenCalled();
  });
});

describe('OS identity decoding and durable application journal', () => {
  it('decodes macOS microseconds, parent and pid without rounding same-second reuse', async () => {
    const data = Buffer.alloc(136); data.writeUInt32LE(42, 12); data.writeUInt32LE(10, 16);
    data.writeBigUInt64LE(1_700_000_000n, 120); data.writeBigUInt64LE(123456n, 128);
    const first = macProcessInfo(data)!; expect(first).toEqual({ pid: 42, ppid: 10, start: 'mac:1700000000:123456' });
    data.writeBigUInt64LE(123457n, 128); expect(sameProcess(first, macProcessInfo(data)!)).toBe(false);
    data.writeBigUInt64LE(1_000_000n, 128); expect(macProcessInfo(data)).toBeUndefined();
    expect(macProcessInfo(Buffer.alloc(100))).toBeUndefined();
  });

  const directories: string[] = []; const stops: (() => void)[] = [];
  afterEach(() => { stops.splice(0).forEach(stop => stop()); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
  it('records utility spawn identities immediately and wires every production utility fork', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qg-test-run-')); directories.push(directory);
    const f = fixture(null, [row(process.pid)]);
    const run = (await startProcessRun(true, directory, f.table))!; stops.push(run.stop);
    const child = new EventEmitter(); recordUtilityProcess(child); f.rows.push(row(50, process.pid)); child.emit('spawn');
    const record = JSON.parse(readFileSync(join(directory, 'process-run.json'), 'utf8'));
    expect(record.children).toEqual([{ ...birth(50), parent: birth(process.pid) }]);
    for (const file of ['callsign-broker', 'storage-broker', 'extension-broker', 'integrations-broker']) {
      expect(readFileSync('packages/main/' + file + '.ts', 'utf8')).toMatch(/recordUtilityProcess\((worker|child)\)/);
    }
  });

  it('writes the run before returning and persists child identities to a private atomic record', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qg-test-run-')); directories.push(directory);
    const f = fixture(null, [row(process.pid), row(50, process.pid)]);
    const run = (await startProcessRun(true, directory, f.table))!; stops.push(run.stop); run.stop();
    const path = join(directory, 'process-run.json');
    const record = JSON.parse(readFileSync(path, 'utf8'));
    expect(readRunRecord(record)).toEqual(record);
    expect(record.children).toEqual([{ ...birth(50), parent: birth(process.pid) }]);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

// Execute the generated platform script too: injected identity rows alone
// cannot catch a broken wire delimiter or a rounded native creation time.
describe('isolated system process queries', () => {
  it('executes the generated macOS bridge and decodes multiple exact identities', async () => {
    const { runInNewContext } = await import('node:vm');
    const { systemProcessTable } = await import('../packages/main/process-platform.js');
    const execute = vi.fn((file: string, args: string[]) => {
      if (file === '/bin/ps') return '42\n43\nnot-a-pid\n';
      expect(file).toBe('/usr/bin/osascript');
      const bytes = Buffer.alloc(136);
      const data = { mutableBytes: bytes, base64EncodedStringWithOptions: () => bytes.toString('base64') };
      const result = runInNewContext(args[3], {
        ObjC: { import: () => {}, bindFunction: vi.fn(), unwrap: (v: unknown) => v },
        $: { NSMutableData: { dataWithLength: () => data }, proc_pidinfo: (pid: number) => {
          bytes.writeUInt32LE(pid, 12); bytes.writeUInt32LE(10, 16);
          bytes.writeBigUInt64LE(1_700_000_000n, 120); bytes.writeBigUInt64LE(BigInt(pid), 128); return 136;
        } }
      });
      expect(typeof result).toBe('string'); return result as string;
    });
    expect(systemProcessTable('darwin', execute).read()).toEqual([
      { pid: 42, ppid: 10, start: 'mac:1700000000:42' }, { pid: 43, ppid: 10, start: 'mac:1700000000:43' }
    ]);
  });

  it('uses Windows native creation ticks and pins the process handle before checking and ending it', async () => {
    const { systemProcessTable } = await import('../packages/main/process-platform.js');
    const execute = vi.fn((_file: string, _args: string[]) => '42 10 638000000000000001\r\n43 10 638000000000000002\r\n');
    const table = systemProcessTable('win32', execute);
    expect(table.read()).toEqual([
      { pid: 42, ppid: 10, start: 'win:638000000000000001' }, { pid: 43, ppid: 10, start: 'win:638000000000000002' }
    ]);
    table.end({ pid: 42, start: 'win:638000000000000001' });
    const script = execute.mock.calls.at(-1)![1][3];
    expect(script).toContain('$p.Handle'); expect(script).toContain('$p.StartTime.ToUniversalTime().Ticks -eq 638000000000000001');
    expect(script.indexOf('$p.Handle')).toBeLessThan(script.indexOf('$p.StartTime'));
    expect(script).toContain('$p.Kill()'); expect(script).not.toContain('taskkill');
  });
});

describe('a sweep that cannot read the process table (QGD-FRM-0030)', () => {
  it('starts the application without cleaning up, and a spawn it cannot record does not throw', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qgd-run-'));
    try {
      const broken = { read: () => { throw new Error('The process identities could not be read.'); }, end: vi.fn() };
      await expect(startProcessRun(true, directory, broken)).resolves.toBeUndefined();
      expect(broken.end).not.toHaveBeenCalled();
      const child = new EventEmitter();
      recordUtilityProcess(child);
      expect(() => child.emit('spawn')).not.toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
