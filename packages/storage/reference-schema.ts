// SPDX-License-Identifier: GPL-3.0-only
// reference.sqlite's tables (QGD-REF-0001, QGD-ENG-0015).
//
// Mapped to SQLite's types: a boolean is an integer in boolean mode, a list
// and a published row are JSON text, a coordinate is real, and a time is
// ISO-8601 UTC text set in TypeScript (QGD-HDBK-001 §13).
//
// The file is derived, never migrated (QGD-ENG-0015). Its DDL is rendered
// from this declaration into drizzle/reference/ by drizzle-kit and checked
// against it by tests/reference-build.test.ts. REFERENCE_SCHEMA_VERSION is
// stamped into the file, and a file with any other version is rebuilt rather
// than read.
import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const REFERENCE_SCHEMA_VERSION = 4;

export const source = sqliteTable('source', {
  id: text('id').primaryKey(),
  what: text('what').notNull(),
  url: text('url').notNull(),
  version: text('version'),
  sha256: text('sha256'),
  published: text('published'),
  etag: text('etag'),
  lastModified: text('last_modified'),
  fetchedAt: text('fetched_at').notNull(),
  rowCount: integer('row_count').notNull(),
  // The SHA-256 of the exact bytes this file was built from: the archive for
  // ADIF, the cached body for a POTA list. It is what says whether an input
  // has changed. `sha256` above is the pin, and POTA has none (QGD-REF-0010);
  // this is identity, and every source has one.
  contentSha256: text('content_sha256').notNull()
});

export const list = sqliteTable('list', {
  id: text('id').primaryKey(),
  what: text('what').notNull(),
  authority: text('authority').notNull(),
  copy: text('copy').notNull(),
  sourceId: text('source_id'),
  supplied: integer('supplied', { mode: 'boolean' }).notNull(),
  derived: integer('derived', { mode: 'boolean' }).notNull(),
  rowCount: integer('row_count')
});

export const dataType = sqliteTable('data_type', {
  name: text('name').primaryKey(),
  indicator: text('indicator'),
  description: text('description').notNull(),
  minimumValue: text('minimum_value'),
  maximumValue: text('maximum_value'),
  importOnly: integer('import_only', { mode: 'boolean' }).notNull().default(false),
  comments: text('comments')
});

export const field = sqliteTable('field', {
  name: text('name').primaryKey(),
  dataType: text('data_type').notNull(),
  dataTypes: text('data_types', { mode: 'json' }).$type<string[]>().notNull(),
  enumerationRef: text('enumeration_ref'),
  enumerationName: text('enumeration_name'),
  enumerationParameter: text('enumeration_parameter'),
  description: text('description').notNull(),
  headerField: integer('header_field', { mode: 'boolean' }).notNull().default(false),
  minimumValue: text('minimum_value'),
  maximumValue: text('maximum_value'),
  importOnly: integer('import_only', { mode: 'boolean' }).notNull().default(false),
  comments: text('comments')
});

export const enumeration = sqliteTable('enumeration', {
  name: text('name').primaryKey(),
  header: text('header', { mode: 'json' }).$type<string[]>().notNull(),
  valueColumn: text('value_column').notNull(),
  rowCount: integer('row_count').notNull()
});

export const enumerationValue = sqliteTable('enumeration_value', {
  enumeration: text('enumeration').notNull().references(() => enumeration.name),
  key: text('key').notNull(),
  value: text('value', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  importOnly: integer('import_only', { mode: 'boolean' }).notNull().default(false)
}, (table) => [primaryKey({ columns: [table.enumeration, table.key] })]);

export const zone = sqliteTable('zone', {
  kind: text('kind').notNull(),
  number: integer('number').notNull(),
  authority: text('authority').notNull(),
  derivedFrom: text('derived_from').notNull(),
  subdivisions: integer('subdivisions').notNull()
}, (table) => [primaryKey({ columns: [table.kind, table.number] })]);

export const uninterpreted = sqliteTable('uninterpreted', {
  sourceId: text('source_id').notNull(),
  relation: text('relation').notNull(),
  key: text('key').notNull(),
  column: text('column').notNull(),
  cell: text('cell').notNull(),
  note: text('note').notNull()
}, (table) => [primaryKey({ columns: [table.relation, table.key, table.column] })]);

export const potaProgram = sqliteTable('pota_program', {
  programId: integer('program_id').primaryKey(),
  prefix: text('prefix').notNull(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  isoCountry: text('iso_country'),
  locationUnit: text('location_unit'),
  isoLanguage: text('iso_language')
});

export const potaLocation = sqliteTable('pota_location', {
  locationId: integer('location_id').primaryKey(),
  entityId: integer('entity_id'),
  entityName: text('entity_name'),
  locationDesc: text('location_desc').notNull(),
  locationName: text('location_name'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  iso: text('iso')
});

export const potaPark = sqliteTable('pota_park', {
  reference: text('reference').primaryKey(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  entityId: integer('entity_id'),
  adifEntity: integer('adif_entity'),
  locationDesc: text('location_desc').notNull(),
  latitude: real('latitude'),
  longitude: real('longitude'),
  grid: text('grid'),
  coordinatesUsable: integer('coordinates_usable', { mode: 'boolean' }).notNull(),
  coordinatesNote: text('coordinates_note'),
  isTest: integer('is_test', { mode: 'boolean' }).notNull().default(false)
});

export const potaParkLocation = sqliteTable('pota_park_location', {
  reference: text('reference').notNull(),
  locationDesc: text('location_desc').notNull()
}, (table) => [primaryKey({ columns: [table.reference, table.locationDesc] })]);

// SOTA's summits (QGD-REF-0018): what a location needs, as SOTA publishes
// it. A retired summit is kept with its dates (QGD-REF-0011).
export const sotaSummit = sqliteTable('sota_summit', {
  code: text('code').primaryKey(),
  association: text('association').notNull(),
  region: text('region').notNull(),
  name: text('name').notNull(),
  altitudeM: integer('altitude_m'),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to').notNull()
});

// How many times each park in My Area has been activated (QGD-REF-0019), as
// POTA publishes it for each location: null where POTA publishes null, a park
// no one has attempted. No foreign key to pota_park: the two lists are fetched
// at different times, and a park new since the park list was is still POTA's
// record (QGD-REF-0011). A park in two locations of My Area is one row.
export const potaActivation = sqliteTable('pota_activation', {
  reference: text('reference').primaryKey(),
  activations: integer('activations')
});

export const referenceSchema = {
  source, list, dataType, field, enumeration, enumerationValue, zone, uninterpreted,
  potaProgram, potaLocation, potaPark, potaParkLocation, sotaSummit, potaActivation
};
