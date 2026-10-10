// SPDX-License-Identifier: GPL-3.0-only
// state.sqlite: what the frame keeps (QGD-ENG-0001). The migrations in
// drizzle/state/ are generated from this file (QGD-ENG-0002).
//
// Times are ISO-8601 UTC text, set in TypeScript. SQLite has no timestamp
// type, and text sorts in time order and reads the same in every tool.
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// The installation, in one row. A fixed primary key makes "one row"
// something the database enforces, not something remembered.
export const installation = sqliteTable('installation', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  createdByVersion: text('created_by_version').notNull()
});

export const INSTALLATION_ID = 'this';

// Small key-values that an application keeps through the API, stored under
// its identifier, as VS Code keeps an extension's state under its id. An
// application never names its id here: the broker supplies it from the
// manifest of the application making the request.
export const appState = sqliteTable(
  'app_state',
  {
    appId: text('app_id').notNull(),
    key: text('key').notNull(),
    value: text('value', { mode: 'json' }).notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [primaryKey({ columns: [table.appId, table.key] })]
);

export const stateSchema = { installation, appState };
