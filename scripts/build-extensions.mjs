// SPDX-License-Identifier: GPL-3.0-only
// The built-in extensions, into the package (QGD-APP-0017, QGD-REP-0001).
//
// Each extensions/<id>/ becomes dist/extensions/<id>/: its manifest, its
// icon, and its src/ compiled flat beside them, so the manifest's "main"
// names a file in the same directory. dist/ is what ships, so an extension
// is official because it is here, put here by this build.
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const built = '.cache/extensions-build/extensions';
const target = 'dist/extensions';
await rm(target, { recursive: true, force: true });
let count = 0;
for (const id of await readdir('extensions')) {
  const source = join('extensions', id);
  if (!(await stat(source)).isDirectory()) continue;
  const out = join(target, id);
  await mkdir(out, { recursive: true });
  await cp(join(source, 'manifest.json'), join(out, 'manifest.json'));
  await cp(join(source, 'icon.svg'), join(out, 'icon.svg'));
  await cp(join(built, id, 'src'), out, { recursive: true });
  count += 1;
}
await rm('.cache/extensions-build', { recursive: true, force: true });
console.log(`Built ${count} extension(s) into ${target}.`);
