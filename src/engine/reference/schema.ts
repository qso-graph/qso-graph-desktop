// SPDX-License-Identifier: GPL-3.0-only
// The reference data's tables.
//
// QGD-REF-0001 puts the reference data in the engine rather than in a file
// beside the application or compiled into it, and QGD-ENG-0001 makes it frame
// — its own schema, owned by the frame, reached by an application through a
// role rather than owned by one. QGD-ENG-0013 brings these tables in by
// migration like everything else, which is why they are declared here and not
// written as SQL.
//
// Two decisions shape the whole of it:
//
// **Published values are stored as published** (QGD-REF-0011). An enumeration
// row keeps every column ADIF publishes for it, under the column names ADIF
// publishes, in one jsonb document. The alternative — a table per enumeration
// with the columns this product happens to care about — throws away the rest
// and has to be migrated every time an authority adds a column. Twenty-five
// enumerations carry between five and twelve different columns each; there is
// no single set of columns to give them.
//
// **What is derived says so.** The CQ and ITU zones are not lists in ADIF
// (QGD-REF-0007): they are columns on the administrative subdivisions. So they
// get a table that records what they were derived from and who owns them,
// rather than one that looks exactly like a list ADIF published.
import { boolean, integer, jsonb, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const REFERENCE_SCHEMA = 'qg_ref';

export const reference = pgSchema(REFERENCE_SCHEMA);

// Where a body of reference data came from, and when. One row per source, not
// per list: the ADIF archive carries seven of the lists below.
//
// `sha256` is null for a source that is not pinned, which is not a gap —
// QGD-REF-0010 says POTA's park list must not be pinned, because it changes
// daily and a checksum would make every load a refusal. What stands in for it
// there is `etag`, `lastModified` and `rowCount`: enough to ask conditionally
// and to notice a list that arrived the wrong size.
export const source = reference.table('source', {
  id: text('id').primaryKey(),
  what: text('what').notNull(),
  url: text('url').notNull(),
  version: text('version'),
  sha256: text('sha256'),
  published: text('published'),
  etag: text('etag'),
  lastModified: text('last_modified'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  rowCount: integer('row_count').notNull()
});

// The register, in the database. QGD-REF-0002 asks for the owner of a list and
// the origin of this copy as two separate facts, so they are two columns and
// neither is allowed to be null. `supplied` and `derived` are the same facts in
// a form the loader can act on.
export const list = reference.table('list', {
  id: text('id').primaryKey(),
  what: text('what').notNull(),
  authority: text('authority').notNull(),
  copy: text('copy').notNull(),
  sourceId: text('source_id'),
  supplied: boolean('supplied').notNull(),
  derived: boolean('derived').notNull(),
  rowCount: integer('row_count')
});

// ADIF's 28 data types.
export const dataType = reference.table('data_type', {
  name: text('name').primaryKey(),
  indicator: text('indicator'),
  description: text('description').notNull(),
  minimumValue: text('minimum_value'),
  maximumValue: text('maximum_value'),
  importOnly: boolean('import_only').notNull().default(false),
  comments: text('comments')
});

// ADIF's 186 fields.
//
// `enumerationRef` is the reference exactly as ADIF writes it, brackets and
// all: STATE's is `Primary_Administrative_Subdivision[DXCC]`, which means "the
// subdivisions of the entity in the DXCC field". `enumerationName` is the
// enumeration that reference names, and `enumerationParameter` the field it
// is selected by. Keeping all three means the parameterised form is not lost
// and the validator does not have to parse the string again.
//
// All three are null for DARC_DOK and MY_DARC_DOK, which are typed
// Enumeration and name no enumeration at all (QGD-REF-0006).
export const field = reference.table('field', {
  name: text('name').primaryKey(),
  // The data type exactly as ADIF publishes it, and the type names resolved
  // out of it. They differ for two of the 186 fields: CREDIT_SUBMITTED and
  // CREDIT_GRANTED publish "CreditList,AwardList" — one cell naming two types,
  // neither of which is a data type by that name. A foreign key here would
  // have refused both fields, which is QGD-REF-0012's lesson in ADIF's own
  // data: the cell is kept as published (QGD-REF-0011) and the resolution is
  // recorded beside it as a derivation.
  dataType: text('data_type').notNull(),
  dataTypes: text('data_types').array().notNull(),
  enumerationRef: text('enumeration_ref'),
  enumerationName: text('enumeration_name'),
  enumerationParameter: text('enumeration_parameter'),
  description: text('description').notNull(),
  headerField: boolean('header_field').notNull().default(false),
  minimumValue: text('minimum_value'),
  maximumValue: text('maximum_value'),
  importOnly: boolean('import_only').notNull().default(false),
  comments: text('comments')
});

// One row per enumeration, carrying the columns it publishes. The header is
// what makes a jsonb row below readable without consulting the archive.
//
// `valueColumn` is which of those columns holds the value a QSO field carries.
// It is not always the key: ADIF keys Mode by "AM" and the Region enumeration
// by "IV.206" — the region code and the DXCC entity together — so a validator
// that looks a value up by key answers "not in ADIF's Region" for nine of
// ADIF's own test QSOs, which is what the first version of this did. The
// second column of the header is the value column in all 25 enumerations, so
// it is read from the header rather than listed here.
export const enumeration = reference.table('enumeration', {
  name: text('name').primaryKey(),
  header: text('header').array().notNull(),
  valueColumn: text('value_column').notNull(),
  rowCount: integer('row_count').notNull()
});

// One row per value, with every column ADIF publishes for it.
//
// `deleted` and `importOnly` are lifted out of the document because validation
// turns on them — a deleted DXCC entity is still valid in an old QSO, and an
// import-only value must not be written. They are conveniences over `value`,
// never a replacement for it: the document is the record.
export const enumerationValue = reference.table('enumeration_value', {
  // This one is a foreign key, where field.data_type above is not: both sides
  // come out of the same archive in the same load, so a value whose
  // enumeration is not there is a loader defect and not a disagreement between
  // two authorities about how the world is numbered.
  enumeration: text('enumeration').notNull().references(() => enumeration.name),
  key: text('key').notNull(),
  value: jsonb('value').$type<Record<string, string>>().notNull(),
  deleted: boolean('deleted').notNull().default(false),
  importOnly: boolean('import_only').notNull().default(false)
}, table => [primaryKey({ columns: [table.enumeration, table.key] })]);

// The zones, recorded as the derivation they are (QGD-REF-0007). `authority`
// is CQ Magazine or the ITU; `derivedFrom` names the column the numbers were
// read off, and `subdivisions` how many rows carried each one — which is the
// evidence for the derivation being what it claims.
export const zone = reference.table('zone', {
  kind: text('kind').notNull(),
  number: integer('number').notNull(),
  authority: text('authority').notNull(),
  derivedFrom: text('derived_from').notNull(),
  subdivisions: integer('subdivisions').notNull()
}, table => [primaryKey({ columns: [table.kind, table.number] })]);

// A published cell this product could not interpret.
//
// QGD-REF-0015. The cell is kept exactly as published and flagged, which is
// QGD-REF-0011's rule — the flag is this product's opinion and the value stays
// the authority's record. The reason this is a table rather than a log line is
// that a derivation which quietly drops what it cannot read is
// indistinguishable from one that read everything: three of ADIF's zone cells
// are not numbers, and the first version of the derivation above skipped all
// three without saying so.
export const uninterpreted = reference.table('uninterpreted', {
  sourceId: text('source_id').notNull(),
  // Where it was: the relation, and the key within it.
  relation: text('relation').notNull(),
  key: text('key').notNull(),
  column: text('column').notNull(),
  // As published.
  cell: text('cell').notNull(),
  note: text('note').notNull()
}, table => [primaryKey({ columns: [table.relation, table.key, table.column] })]);

// ---------------------------------------------------------------------------
// POTA's parks, programs and locations (QGD-REF-0009 to QGD-REF-0013).
//
// Held like the rest of the reference data and shaped by three facts about
// POTA's lists that ADIF's do not have:
//
// - **The park list changes daily**, so it is not pinned by checksum: the
//   source row carries an ETag and a Last-Modified instead (QGD-REF-0010).
// - **A published value is stored as published and never corrected**
//   (QGD-REF-0011). Four parks publish coordinates that cannot exist — one of
//   them with the latitude and longitude plainly transposed — and they are
//   stored exactly as POTA publishes them with a flag beside them. The flag is
//   this product's opinion; the value stays POTA's record.
// - **POTA's entity number is POTA's**, not ADIF's DXCC code, however often
//   the two agree (QGD-REF-0012). So it is a plain column, and the ADIF entity
//   is a nullable derived link set only where the numbers do agree. As a
//   foreign key it would have refused 113 parks.
import { doublePrecision } from 'drizzle-orm/pg-core';

export const potaProgram = reference.table('pota_program', {
  programId: integer('program_id').primaryKey(),
  prefix: text('prefix').notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  isoCountry: text('iso_country'),
  // What this program calls its locations: Province, State, Prefecture…
  locationUnit: text('location_unit'),
  isoLanguage: text('iso_language')
});

export const potaLocation = reference.table('pota_location', {
  locationId: integer('location_id').primaryKey(),
  // POTA's own entity number, as on the parks (QGD-REF-0012).
  entityId: integer('entity_id'),
  entityName: text('entity_name'),
  // "US-ME" and the like: what a park's locationDesc holds.
  locationDesc: text('location_desc').notNull(),
  locationName: text('location_name'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  iso: text('iso')
});

export const potaPark = reference.table('pota_park', {
  reference: text('reference').primaryKey(),
  name: text('name').notNull(),
  // Retired parks are kept, so a QSO from 2019 still resolves (QGD-REF-0011).
  active: boolean('active').notNull(),
  entityId: integer('entity_id'),
  // The derived link: equal to entityId where that number is also an ADIF
  // DXCC entity code, and null where POTA numbers the world differently.
  adifEntity: integer('adif_entity'),
  // Exactly as published, comma-separated list and all. The split-out rows
  // are in pota_park_location (QGD-REF-0013).
  locationDesc: text('location_desc').notNull(),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  grid: text('grid'),
  // This product's opinions about the row, never changes to it:
  // whether the coordinates can be used to measure or map with, and whether
  // this is POTA's own test park rather than a place.
  coordinatesUsable: boolean('coordinates_usable').notNull(),
  coordinatesNote: text('coordinates_note'),
  isTest: boolean('is_test').notNull().default(false)
});

// One row per park per location: 1,618 parks publish more than one
// (QGD-REF-0013). A column holding a list cannot be joined on.
export const potaParkLocation = reference.table('pota_park_location', {
  reference: text('reference').notNull(),
  locationDesc: text('location_desc').notNull()
}, table => [primaryKey({ columns: [table.reference, table.locationDesc] })]);
