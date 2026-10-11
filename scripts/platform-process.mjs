// SPDX-License-Identifier: GPL-3.0-only
// What the suites ask of the operating system about processes, answered by
// each platform's own tool: ps and lsof on macOS and Linux; PowerShell and
// netstat on Windows. A suite that called ps or sent SIGSTOP directly ran
// only where those exist.
import { spawnSync } from 'node:child_process';

const WINDOWS = process.platform === 'win32';

function powershell(command) {
  return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', timeout: 60_000 });
}

// Every process, with its parent and its command line.
export function listProcesses() {
  const found = [];
  if (WINDOWS) {
    const run = powershell(
      'Get-CimInstance Win32_Process | ForEach-Object { "{0}`t{1}`t{2}" -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine }');
    for (const line of (run.stdout || '').split(/\r?\n/)) {
      const [pid, ppid, ...command] = line.split('\t');
      if (/^\d+$/.test(pid ?? '') && /^\d+$/.test(ppid ?? '')) found.push({ pid: Number(pid), ppid: Number(ppid), command: command.join('\t') });
    }
    return found;
  }
  const run = spawnSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  for (const line of (run.stdout || '').split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (match) found.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return found;
}

// Stop a process without ending it, so it cannot answer. SIGSTOP where there
// are signals; on Windows, NtSuspendProcess, which a user may call on their own
// processes without administrator rights.
export function freeze(pid) {
  if (!WINDOWS) { process.kill(pid, 'SIGSTOP'); return; }
  const run = powershell(
    'Add-Type -Namespace QG -Name Suspend -MemberDefinition \'[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);\'; '
    + `$p = [System.Diagnostics.Process]::GetProcessById(${Number(pid)}); `
    + 'if ([QG.Suspend]::NtSuspendProcess($p.Handle) -ne 0) { exit 1 }');
  if (run.status !== 0) throw new Error(`Process ${pid} could not be suspended.`);
}

// One reading of a process's open network sockets: { ok, sockets }. lsof on
// macOS and Linux; netstat on Windows, whose last column is the owning pid.
export function socketsOf(pid) {
  if (WINDOWS) {
    const run = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 30_000 });
    if (run.error || run.status !== 0) return { ok: false, sockets: [] };
    const sockets = [];
    for (const line of (run.stdout || '').split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      if (!/^(TCP|UDP)$/.test(fields[0] ?? '') || Number(fields.at(-1)) !== pid) continue;
      // As lsof writes them: a listener by its own address, a connection as
      // local->remote.
      const listening = /^(0\.0\.0\.0:0|\[::\]:0|\*:\*)$/.test(fields[2] ?? '');
      sockets.push(listening ? fields[1] : `${fields[1]}->${fields[2]}`);
    }
    return { ok: true, sockets };
  }
  // -a, because lsof ORs its filters: without it this reads every socket on
  // the machine rather than this process's.
  const run = spawnSync('lsof', ['-a', '-p', String(pid), '-i', '-n', '-P', '-F', 'n'], { encoding: 'utf8' });
  if (run.error || (run.status !== 0 && (run.stderr || '').trim() !== '')) return { ok: false, sockets: [] };
  return { ok: true, sockets: (run.stdout || '').split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1)) };
}
