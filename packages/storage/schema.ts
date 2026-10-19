// SPDX-License-Identifier: GPL-3.0-only
// state.sqlite: what the core keeps (QGD-ENG-0001). The migrations in
// drizzle/state/ are generated from this file (QGD-ENG-0002).
//
// Times are ISO-8601 UTC text, set in TypeScript. SQLite has no timestamp
// type, and text sorts in time order and reads the same in every tool.
import { primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
export const extensionState = sqliteTable(
  'extension_state',
  {
    extensionId: text('extension_id').notNull(),
    key: text('key').notNull(),
    value: text('value', { mode: 'json' }).notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [primaryKey({ columns: [table.extensionId, table.key] })]
);

// The outcome of reference refreshes, per source (QGD-ENG-0015.1). What is
// loaded is not recorded here: reference.sqlite's own source table is the
// record of that, and this table is written after the swap. A failure is
// recorded as an error kind only (QGD-ENG-0016).
export const referenceRefresh = sqliteTable('reference_refresh', {
  sourceId: text('source_id').primaryKey(),
  lastAttempt: text('last_attempt'),
  lastCheck: text('last_check'),
  lastFailure: text('last_failure')
});

// Stations (QGD-STN-0001): where the operator is operating from, beside the
// persona that says who they are. The place is ADIF's own MY_* fields, kept
// as one JSON object under ADIF's field names (QGD-STN-0002), so a field ADIF
// adds is a change to the list in stations.ts and not to this table. The
// callsign is never here: it is the active persona's (QGD-STN-0009).
export const station = sqliteTable(
  'station',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    // Home, Portable, Mobile or Remote: a label and nothing more (QGD-STN-0004).
    kind: text('kind'),
    place: text('place', { mode: 'json' }).notNull(),
    // TQSL's Park, which ADIF has no field for (QGD-STN-0009).
    lotwPark: text('lotw_park'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [uniqueIndex('station_name').on(table.name)]
);

// Each persona's default station (QGD-STN-0005), by the persona's name, which
// is how the credential core keys a persona. Deleting the station deletes the
// default with it.
export const stationDefault = sqliteTable('station_default', {
  persona: text('persona').primaryKey(),
  stationId: text('station_id').notNull().references(() => station.id, { onDelete: 'cascade' })
});

// The active station, in one row like the installation. Deleting the station
// leaves none active rather than a dangling id.
export const activeStation = sqliteTable('active_station', {
  id: text('id').primaryKey(),
  stationId: text('station_id').references(() => station.id, { onDelete: 'set null' })
});

export const ACTIVE_STATION_ID = 'this';

export const stateSchema = { installation, extensionState, referenceRefresh, station, stationDefault, activeStation };
