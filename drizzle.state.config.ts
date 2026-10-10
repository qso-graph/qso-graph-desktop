// SPDX-License-Identifier: GPL-3.0-only
// QGD-ENG-0002. drizzle-kit generates state.sqlite's migrations from
// packages/storage/schema.ts into drizzle/state/. The application never reads
// this file, and no path to a database lives in it.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/storage/schema.ts',
  out: './drizzle/state',
  strict: true,
  verbose: false
});
