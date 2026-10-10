// SPDX-License-Identifier: GPL-3.0-only
// QGD-ENG-0015. drizzle-kit renders reference.sqlite's DDL from
// packages/storage/reference-schema.ts into drizzle/reference/. The file is
// derived and never migrated, so there is only ever one rendering: a change to
// the schema regenerates it from nothing and raises REFERENCE_SCHEMA_VERSION.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/storage/reference-schema.ts',
  out: './drizzle/reference',
  strict: true,
  verbose: false
});
