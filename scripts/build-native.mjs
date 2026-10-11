// SPDX-License-Identifier: GPL-3.0-only
import { spawnSync } from 'node:child_process';
import { access, mkdir, copyFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cargoPath } from './cargo-path.mjs';
// QG_PERSONA_CORE_LIB: a credential core already built elsewhere, used as it
// is. CI builds the Linux one in a manylinux_2_28 container, against glibc
// 2.28, so the package loads on systems older than the runner: the Ubuntu
// 24.04 build needed glibc 2.39 and would not load on Pi OS Bookworm (2.36),
// Debian 12 or Rocky 9 (2.34). Electron itself needs 2.25.
const prebuilt = process.env.QG_PERSONA_CORE_LIB;
if (!prebuilt) {
  const cargo = await cargoPath();
  const run = spawnSync(cargo, ['build', '--release', '--manifest-path', 'packages/persona-core/Cargo.toml'], { stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status || 1);
}
await mkdir('dist/native', { recursive: true });
// Cargo names the library for the platform it built on.
const LIBRARY = {
  darwin: 'libqg_persona_core.dylib',
  linux: 'libqg_persona_core.so',
  win32: 'qg_persona_core.dll'
}[process.platform];
if (!LIBRARY) throw new Error(`The credential core is not built for ${process.platform}.`);
await copyFile(prebuilt ?? join('packages/persona-core/target/release', LIBRARY), 'dist/native/persona.node');
// QG_GLIBC_MAX: the newest glibc the core may need, checked from the symbol
// versions it imports. Set in CI, so a build that would not load on an older
// Linux fails here instead of on a user's machine.
if (process.platform === 'linux' && process.env.QG_GLIBC_MAX) {
  const dump = spawnSync('objdump', ['-T', 'dist/native/persona.node'], { encoding: 'utf8' });
  if (dump.status !== 0) throw new Error('The credential core\'s glibc needs could not be read.');
  const newer = (a, b) => { const [x, y] = [a, b].map(v => v.split('.').map(Number)); return x[0] - y[0] || x[1] - y[1]; };
  const needed = [...new Set(dump.stdout.match(/GLIBC_\d+\.\d+/g) ?? [])].map(v => v.slice(6)).sort(newer).at(-1);
  if (!needed) throw new Error('The credential core imports no versioned glibc symbol; the check would be checking nothing.');
  if (newer(needed, process.env.QG_GLIBC_MAX) > 0) {
    throw new Error(`The credential core needs glibc ${needed}; the most it may need is ${process.env.QG_GLIBC_MAX}.`);
  }
  console.log(`Credential core needs glibc ${needed} (at most ${process.env.QG_GLIBC_MAX}).`);
}
// On Linux the FIPS crypto module is linked into the library itself. On
// Windows it can arrive as a DLL of its own, which has to sit beside the addon
// for Node to load it (Node loads an addon's dependencies from its directory).
// AWS-LC builds them under its own build directory, as on macOS.
if (process.platform === 'win32') {
  const builds = 'packages/persona-core/target/release/build';
  let copied = 0;
  for (const directory of await readdir(builds)) {
    if (!directory.startsWith('aws-lc-fips-sys-')) continue;
    const artifacts = join(builds, directory, 'out', 'build', 'artifacts');
    let names = [];
    try { names = await readdir(artifacts); } catch { continue; }
    for (const name of names.filter(entry => /^aws_lc_fips.*\.dll$/i.test(entry))) {
      await copyFile(join(artifacts, name), join('dist/native', name));
      copied++;
    }
  }
  if (copied === 0) throw new Error('The FIPS crypto library could not be bundled.');
}
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
