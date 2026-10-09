// SPDX-License-Identifier: GPL-3.0-only
import { spawnSync } from 'node:child_process';
import { access, mkdir, copyFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const cargo = join(homedir(), '.cargo', 'bin', 'cargo');
await access(cargo);
const run = spawnSync(cargo, ['build', '--release', '--manifest-path', 'packages/persona-core/Cargo.toml'], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status || 1);
await mkdir('dist/native', { recursive: true });
await copyFile('packages/persona-core/target/release/libqg_persona_core.dylib', 'dist/native/persona.node');
if (process.platform === 'darwin') {
  const linked = spawnSync('otool', ['-L', 'dist/native/persona.node'], { encoding: 'utf8' });
  if (linked.status !== 0) throw new Error('Native library dependencies could not be inspected.');
  const moduleName = linked.stdout.match(/@rpath\/(libaws_lc_fips_[\w]+\.dylib)/)?.[1];
  if (!moduleName) throw new Error('The required FIPS crypto library was not linked.');
  const builds = 'packages/persona-core/target/release/build';
  let found = false;
  for (const directory of await readdir(builds)) {
    if (!directory.startsWith('aws-lc-fips-sys-')) continue;
    const candidate = join(builds, directory, 'out', 'build', 'artifacts', moduleName);
    try { await access(candidate); } catch { continue; }
    await copyFile(candidate, join('dist/native', moduleName)); found = true; break;
  }
  if (!found) throw new Error('The FIPS crypto library could not be bundled.');
  // Change only our addon dependency. The crypto module itself is copied intact.
  const relocate = spawnSync('install_name_tool', ['-change', `@rpath/${moduleName}`, `@loader_path/${moduleName}`, 'dist/native/persona.node'], { stdio: 'inherit' });
  if (relocate.status !== 0) throw new Error('Native crypto library location could not be set.');
}
