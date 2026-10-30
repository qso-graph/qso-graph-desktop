// SPDX-License-Identifier: GPL-3.0-only
// Stops a child and what it started. uvx runs the simulator as a child of its
// own, and on Windows killing uvx leaves that child running, holding the
// stderr it inherited from the suite: the runner waited on the pipe until
// integrations-sim's time limit with every check passed (CI, windows-latest,
// 2026-10-30). taskkill /T stops the tree; elsewhere uvx's child goes with it.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export function stopProcessTree(child, platform = process.platform, run = spawnSync, root = process.env.SystemRoot) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') {
    run(join(root ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}
