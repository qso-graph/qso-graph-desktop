// SPDX-License-Identifier: GPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sameProcess, type ProcessIdentity, type ProcessTable } from './process-platform.js';

interface Child extends ProcessIdentity { parent: ProcessIdentity }
interface RunRecord { version: 1; run: string; at: number; root: ProcessIdentity; children: Child[] }
interface RunDependencies {
  table: ProcessTable;
  pid: number;
  now(): number;
  wait(ms: number): Promise<void>;
  id(): string;
  read(): unknown;
  write(record: RunRecord): void;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const keys = (value: object, expected: string[]) => Object.keys(value).sort().join(',') === expected.sort().join(',');
function identity(value: unknown): value is ProcessIdentity {
  if (!value || typeof value !== 'object') return false;
  const v = value as ProcessIdentity;
  return Number.isSafeInteger(v.pid) && v.pid > 0 && v.pid <= 0x7fffffff && typeof v.start === 'string'
    && (/^(mac:[1-9]\d{0,15}:\d{1,6}|win:[1-9]\d{0,19})$/.test(v.start)
      || (v.start.startsWith('linux:') && UUID.test(v.start.slice(6, 42)) && /^:[1-9]\d{0,19}$/.test(v.start.slice(42))));
}
export function readRunRecord(value: unknown): RunRecord | undefined {
  if (!value || typeof value !== 'object' || !keys(value, ['version', 'run', 'at', 'root', 'children'])) return;
  const v = value as RunRecord;
  if (v.version !== 1 || typeof v.run !== 'string' || !UUID.test(v.run)
      || !Number.isSafeInteger(v.at) || v.at < 0 || !identity(v.root)
      || !keys(v.root, ['pid', 'start']) || !Array.isArray(v.children) || v.children.length > 4096) return;
  const known: ProcessIdentity[] = [v.root];
  for (const child of v.children) {
    if (!identity(child) || !keys(child, ['pid', 'start', 'parent']) || !identity(child.parent)
        || !keys(child.parent, ['pid', 'start']) || known.some(p => sameProcess(p, child))
        || child.start.split(':')[0] !== v.root.start.split(':')[0]
        || !known.some(p => sameProcess(p, child.parent))) return;
    known.push(child);
  }
  return v;
}

// Called only by the lock winner, before any utility process starts. A failed
// read proves nothing; a failed identity query never authorizes a signal.
export async function beginProcessRun(wonLock: boolean, deps: RunDependencies) {
  if (!wonLock) return;
  const initial = deps.table.read();
  const current = initial.find(row => row.pid === deps.pid);
  if (!current) throw new Error('The application process could not be identified.');
  let previous: RunRecord | undefined;
  try { previous = readRunRecord(deps.read()); } catch { /* absent/corrupt */ }
  const waitForExit = async (entries: ProcessIdentity[]) => {
    const deadline = deps.now() + 2_000;
    for (let attempt = 0; ; attempt++) {
      if (!deps.table.read().some(row => entries.some(old => sameProcess(row, old)))) return;
      if (attempt >= 40 || deps.now() >= deadline) throw new Error('An earlier application process could not be ended.');
      await deps.wait(50);
    }
  };
  if (previous) {
    // Refuse any record containing the current instance, even if damaged or
    // accidentally copied from it. Parents outlive no unverified tree-kill.
    const entries = [previous.root, ...previous.children];
    if (!entries.some(p => sameProcess(p, current))) {
      for (const old of [...entries].reverse()) {
        if (deps.table.read().some(row => sameProcess(row, old))) deps.table.end(old);
      }
      await waitForExit(entries);
    }
  }
  const root = { pid: current.pid, start: current.start };
  const record: RunRecord = { version: 1, run: deps.id(), at: deps.now(), root, children: [] };
  deps.write(record);
  let stopped = false;
  const capture = () => {
    if (stopped) return;
    const table = deps.table.read();
    const live = [root, ...record.children].filter(known => table.some(row => sameProcess(known, row)));
    let changed = false;
    // Only a contemporaneously identified descendant can join this run.
    for (let added = true; added;) {
      added = false;
      for (const row of table) {
        if (live.some(p => sameProcess(p, row))) continue;
        const parent = live.find(p => p.pid === row.ppid);
        if (!parent) continue;
        if (record.children.length >= 4096) throw new Error('Too many application processes.');
        const child = { pid: row.pid, start: row.start, parent: { pid: parent.pid, start: parent.start } };
        record.children.push(child); live.push(child); added = true; changed = true;
      }
    }
    if (changed) deps.write(record);
  };
  capture();
  return {
    capture,
    // Freeze before will-quit's updater spawns its detached installer. Keep
    // the journal after a clean quit too: only the next lock winner sweeps it.
    stop: () => { capture(); stopped = true; },
    endChildren: async () => {
      for (const child of [...record.children].reverse()) {
        if (deps.table.read().some(row => sameProcess(row, child))) deps.table.end(child);
      }
      await waitForExit(record.children);
    }
  };
}

let captureChild: (() => void) | undefined;
export function recordUtilityProcess(child: { once(event: 'spawn', listener: () => void): unknown }): void {
  // Recording is best effort: a child it could not identify is one the next
  // start cannot prove, and so leaves alone; it never takes the application down.
  child.once('spawn', () => { try { captureChild?.(); } catch { /* not recorded */ } });
}

export async function startProcessRun(wonLock: boolean, directory: string, table: ProcessTable) {
  const file = join(directory, 'process-run.json');
  // A sweep that cannot prove anything ends nothing and stops nothing: the
  // application starts as it would have without it (QGD-FRM-0030).
  let run: Awaited<ReturnType<typeof beginProcessRun>>;
  try { run = await beginProcessRun(wonLock, {
    table, pid: process.pid, now: Date.now, id: randomUUID, wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    read: () => {
      if (statSync(file).size > 1024 * 1024) return;
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      return raw;
    },
    write: record => {
      mkdirSync(directory, { recursive: true });
      const staged = `${file}.tmp`;
      const fd = openSync(staged, 'w', 0o600);
      try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(staged, file);
    }
  }); } catch { return; }
  if (!run) return;
  // Children are recorded as each utility process starts, never on a timer:
  // reading every process on the computer costs about 125 ms on a Mac, which
  // once a second would be an eighth of a core for as long as the
  // application runs.
  captureChild = run.capture;
  return {
    stop: () => { captureChild = undefined; try { run.stop(); } catch { /* not recorded */ } },
    endChildren: run.endChildren
  };
}
