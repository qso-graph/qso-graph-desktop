// SPDX-License-Identifier: GPL-3.0-only
// The build starts from an empty dist/. The compiler only ever adds files, so
// a module whose source was deleted stays in dist/ from an earlier build, and
// `build.files` packages all of dist/. That is how the removed PostgreSQL
// engine could have shipped after its source was gone; package-contents
// checks for exactly that.
import { rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
