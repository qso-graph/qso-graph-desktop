// SPDX-License-Identifier: GPL-3.0-only
// integrations-sim stops the simulator's whole tree on Windows: killing uvx
// alone left its child holding the suite's stderr (scripts/stop-process-tree.mjs).
import { describe, expect, it, vi } from 'vitest';
import { stopProcessTree } from '../scripts/stop-process-tree.mjs';

const child = () => ({ pid: 4242, exitCode: null, signalCode: null, kill: vi.fn() });

describe('stopping the simulator', () => {
  it('stops the tree on Windows, with taskkill /T', () => {
    const running = child();
    const run = vi.fn();
    stopProcessTree(running, 'win32', run, 'C:\\Windows');
    expect(run).toHaveBeenCalledTimes(1);
    const [program, args] = run.mock.calls[0];
    expect(program).toMatch(/System32[\\/]taskkill\.exe$/);
    expect(args).toEqual(['/PID', '4242', '/T', '/F']);
    expect(running.kill).not.toHaveBeenCalled();
  });

  it('kills the child elsewhere', () => {
    const running = child();
    const run = vi.fn();
    stopProcessTree(running, 'linux', run);
    expect(running.kill).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('leaves one that has already gone', () => {
    const run = vi.fn();
    for (const gone of [undefined, { ...child(), exitCode: 0 }, { ...child(), signalCode: 'SIGTERM' }]) {
      stopProcessTree(gone, 'win32', run);
    }
    expect(run).not.toHaveBeenCalled();
  });
});
