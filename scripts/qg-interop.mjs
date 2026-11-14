// SPDX-License-Identifier: GPL-3.0-or-later
// QG Interop's qg-interop, the simulator the integration suites drive
// (QGD-INT-0024): plays a WSJT-X ALL.TXT as WSJT-X's own messages.
//
// Built from crates.io at an exact version with its lock file, into out/tools,
// so every machine runs the same program and nothing is installed beside the
// operator's own tools. cargo is already needed for Desktop's Rust cores.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const QG_INTEROP = { crate: 'qso-graph-interop-cli', version: '0.1.0' };

const root = resolve('out', 'tools', `qg-interop-${QG_INTEROP.version}`);
const binary = join(root, 'bin', process.platform === 'win32' ? 'qg-interop.exe' : 'qg-interop');

// The path to qg-interop, built first if this checkout has none. A suite that
// cannot have it fails and says why, rather than passing having checked nothing.
export function qgInterop() {
  if (!existsSync(binary)) {
    const built = spawnSync('cargo', ['install', QG_INTEROP.crate, '--version', `=${QG_INTEROP.version}`, '--locked', '--root', root],
      { stdio: ['ignore', 'inherit', 'inherit'] });
    if (built.error || built.status !== 0) {
      throw new Error(`could not build ${QG_INTEROP.crate} ${QG_INTEROP.version} with cargo: ${built.error?.message ?? `exit ${built.status}`}`);
    }
  }
  const said = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  if (said.stdout?.trim() !== `qg-interop ${QG_INTEROP.version}`) {
    throw new Error(`${binary} says ${JSON.stringify(said.stdout?.trim() ?? said.error?.message)}, not qg-interop ${QG_INTEROP.version}`);
  }
  return binary;
}
