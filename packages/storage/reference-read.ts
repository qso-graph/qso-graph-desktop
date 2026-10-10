// SPDX-License-Identifier: GPL-3.0-only
// Reading what reference.sqlite holds, for the frame's own use and, through
// the API, an application's (QGD-APP-0009).
//
// The validator's ruleset is read whole into memory, once, and validation is
// then TypeScript over that. Nothing joins across files (QGD-ENG-0015).
import { eq } from 'drizzle-orm';
import { type Ruleset, rulesetFromRows } from '../reference/validate.js';
import { ADIF_SOURCE } from './reference-build.js';
import { dataType, enumeration, enumerationValue, field, type referenceSchema, source } from './reference-schema.js';
import type { Store } from './sqlite.js';

// QGD-REF-0014: without ADIF's definitions there is nothing to validate
// against. That is an answer, not an error, and a validator that gets it
// reports every value as not checked rather than passing or failing it.
export async function readReferenceRuleset(
  reader: Store<typeof referenceSchema> | undefined
): Promise<Ruleset | 'not loaded'> {
  if (!reader) return 'not loaded';
  return reader.unit(async (db) => {
    const adif = await db.select({ version: source.version }).from(source).where(eq(source.id, ADIF_SOURCE)).get();
    if (!adif?.version) return 'not loaded';
    return rulesetFromRows({
      version: adif.version,
      fields: await db.select({
        name: field.name, dataTypes: field.dataTypes, enumerationName: field.enumerationName,
        enumerationParameter: field.enumerationParameter, importOnly: field.importOnly
      }).from(field).all(),
      dataTypes: (await db.select({ name: dataType.name }).from(dataType).all()).map((row) => row.name),
      enumerations: await db.select({ name: enumeration.name, valueColumn: enumeration.valueColumn }).from(enumeration).all(),
      values: await db.select({
        enumeration: enumerationValue.enumeration, key: enumerationValue.key, value: enumerationValue.value,
        deleted: enumerationValue.deleted, importOnly: enumerationValue.importOnly
      }).from(enumerationValue).all()
    });
  });
}
