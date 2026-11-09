// SPDX-License-Identifier: GPL-3.0-or-later
// Extension src/ is flattened when packaged. Preserve runtime API imports
// against the core's built public modules, as well as type-only imports.
import ts from 'typescript';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function relocateImports(code, sourceFile, outputFile, sourcePackages, outputPackages) {
  const parsed = ts.createSourceFile(sourceFile, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const changes = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier;
      const target = resolve(dirname(sourceFile), specifier.text);
      for (const name of ['extension-api', 'ui']) {
        const root = resolve(sourcePackages, name);
        const within = relative(root, target);
        if (isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) continue;
        let to = relative(dirname(outputFile), resolve(outputPackages, name, within)).split(sep).join('/');
        if (!to.startsWith('.')) to = './' + to;
        changes.push({ start: specifier.getStart(parsed), end: specifier.getEnd(), text: JSON.stringify(to) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const change of changes.sort((a, b) => b.start - a.start)) code = code.slice(0, change.start) + change.text + code.slice(change.end);
  return code;
}
