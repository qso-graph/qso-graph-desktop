// SPDX-License-Identifier: GPL-3.0-only
// Where extensions are read from (QGD-APP-0017).
//
// The package's own directory is the only one whose extensions may be
// official. A development run may name more directories, for an extension
// being written; a packaged application never reads them, whatever the
// environment says, and what is found there is never official.
import { join } from 'node:path';

export interface ExtensionDirectories {
  readonly shipped: readonly string[];
  readonly others: readonly string[];
}

export function extensionDirectories(packaged: boolean, appPath: string, extra: string | undefined): ExtensionDirectories {
  return {
    // The built-in extensions, as the build placed them (build-extensions.mjs).
    shipped: [join(appPath, 'dist', 'extensions')],
    others: packaged || !extra ? [] : extra.split(':').filter(Boolean)
  };
}
