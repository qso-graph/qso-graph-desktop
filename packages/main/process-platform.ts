// SPDX-License-Identifier: GPL-3.0-or-later
// OS process identities, kept out of lifecycle policy. No command lines or
// environments are read. macOS uses libproc's microseconds, not ps's rounded
// lstart: two uses of a pid within the same second must remain distinguishable.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ProcessIdentity { pid: number; start: string }
export interface ProcessRow extends ProcessIdentity { ppid: number }
export interface ProcessTable {
  read(): ProcessRow[];
  end(identity: ProcessIdentity): void;
}
export const sameProcess = (a: ProcessIdentity, b: ProcessIdentity) => a.pid === b.pid && a.start === b.start;

// proc_bsdinfo, sys/proc_info.h in Apple's SDK: pid/ppid at 12/16,
// pbi_start_tvsec/pbi_start_tvusec at 120/128. All supported Macs are LE64.
export function macProcessInfo(data: Buffer): ProcessRow | undefined {
  if (data.length !== 136 || data.readUInt32LE(4) === 5) return; // SZOMB holds no port
  const seconds = data.readBigUInt64LE(120), micros = data.readBigUInt64LE(128);
  if (seconds <= 0n || micros >= 1_000_000n) return;
  return { pid: data.readUInt32LE(12), ppid: data.readUInt32LE(16), start: `mac:${seconds}:${micros}` };
}

function command(file: string, args: string[]): string {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 5_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('The process identities could not be read.');
  return result.stdout;
}
const powershell = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

export function systemProcessTable(platform = process.platform, execute = command): ProcessTable {
  const read = (): ProcessRow[] => {
    if (platform === 'linux') {
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      const rows: ProcessRow[] = [];
      for (const name of readdirSync('/proc')) {
        if (!/^\d+$/.test(name)) continue;
        try {
          const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          // Fields 4 (parent) and 22 (start ticks since this boot).
          if (fields[0] === 'Z' || !/^\d+$/.test(fields[19])) continue;
          rows.push({ pid: Number(name), ppid: Number(fields[1]), start: `linux:${boot}:${fields[19]}` });
        } catch { /* exited while reading */ }
      }
      return rows;
    }
    if (platform === 'win32') {
      return execute(powershell(), ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p -and $_.CreationDate) { $ticks = $p.StartTime.ToUniversalTime().Ticks; if ([long]([decimal]::Floor([decimal]$ticks / 10) * 10) -eq $_.CreationDate.ToUniversalTime().Ticks) { "{0} {1} {2}" -f $_.ProcessId,$_.ParentProcessId,$ticks } } }'])
        .split(/\r?\n/).flatMap(line => {
          const match = /^(\d+) (\d+) (\d+)$/.exec(line.trim());
          return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), start: `win:${match[3]}` }] : [];
        });
    }
    if (platform !== 'darwin') throw new Error('Unsupported process platform.');
    const pids = execute('/bin/ps', ['-axo', 'pid=']).trim().split(/\s+/).filter(pid => /^\d+$/.test(pid));
    // JXA is the system bridge to libproc; no automation target or UI access.
    const data = execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
      ObjC.import('Foundation');
      ObjC.bindFunction('proc_pidinfo', ['int', ['int', 'int', 'uint64_t', 'void *', 'int']]);
      var buffer = $.NSMutableData.dataWithLength(136);
      ${JSON.stringify(pids)}.map(function(pid) {
        return $.proc_pidinfo(Number(pid), 3, 0, buffer.mutableBytes, 136) === 136
          ? ObjC.unwrap(buffer.base64EncodedStringWithOptions(0)) : '';
      }).filter(Boolean).join('\\n');
    `]);
    return data.trim().split('\n').flatMap(line => {
      const row = macProcessInfo(Buffer.from(line, 'base64'));
      return row ? [row] : [];
    });
  };
  return {
    read,
    end: identity => {
      if (identity.pid === process.pid) return;
      if (platform === 'win32') {
        // Get-Process acquires the process handle before checking StartTime;
        // Kill uses that handle. Never taskkill /T over unverified descendants.
        if (!/^win:\d+$/.test(identity.start)) return;
        execute(powershell(), ['-NoProfile', '-NonInteractive', '-Command',
          `$p = Get-Process -Id ${identity.pid} -ErrorAction SilentlyContinue; if ($p) { $null = $p.Handle }; if ($p -and $p.StartTime.ToUniversalTime().Ticks -eq ${identity.start.slice(4)}) { $p.Kill() }`]);
      } else if (read().some(row => sameProcess(row, identity))) {
        try { process.kill(identity.pid, 'SIGKILL'); } catch { /* gone or no longer accessible */ }
      }
    }
  };
}
