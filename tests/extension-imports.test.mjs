// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { relocateImports } from '../scripts/extension-imports.mjs';
describe('packaged public API runtime imports', () => {
  it('relocates imports and re-exports after flattening src, including nested modules', () => {
    const code = "import { check } from '../../../../packages/extension-api/actions.js';\nexport { shape } from '../../../../packages/ui/page-shapes.js';\nimport { local } from './local.js';";
    const relocated = relocateImports(code, join('cache', 'extensions', 'test-extension', 'src', 'nested', 'main.js'), join('dist', 'extensions', 'test-extension', 'nested', 'main.js'), join('cache', 'packages'), 'dist');
    expect(relocated).toContain('"../../../extension-api/actions.js"');
    expect(relocated).toContain('"../../../ui/page-shapes.js"');
    expect(relocated).toContain("from './local.js'");
    // A planted sibling with the same prefix is not inside the API package.
    expect(relocateImports("import x from '../../../../packages/extension-api-extra/x.js';", join('cache', 'extensions', 'test-extension', 'src', 'nested', 'main.js'), join('dist', 'extensions', 'test-extension', 'nested', 'main.js'), join('cache', 'packages'), 'dist')).toContain('extension-api-extra');
  });
});
