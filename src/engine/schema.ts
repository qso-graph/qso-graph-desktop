// SPDX-License-Identifier: GPL-3.0-only
// The frame's own tables. QGD-ENG-0002: a TypeScript schema, from which the
// migrations are generated.
//
// Only the frame's. The reference data is P5, personas are P6 and QG ADIF is
// P8, and each brings its own schema when it is built — QGD-ENG-0001 gives
// every application its own schema and role, so none of them belongs here.
//
// What is here is what the frame needs to know about a database it is looking
// at: which installation it is, and which PostgreSQL major made it. The second
// is what QGD-ENG-0012 checks a backup against before restoring it.
import { integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

export const FRAME_SCHEMA = 'qg_frame';

export const frame = pgSchema(FRAME_SCHEMA);

export const installation = frame.table('installation', {
  // One row, and this is its name. A fixed primary key is what makes "one
  // row" something the database enforces rather than something we remember.
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // The major that created the data directory. A data directory does not move
  // between majors, so a backup taken from one cannot be restored into
  // another — this is what a restore compares against (QGD-ENG-0012).
  postgresMajor: integer('postgres_major').notNull(),
  createdByVersion: text('created_by_version').notNull()
});

// The single row's key.
export const INSTALLATION_ID = 'this';
