// SPDX-License-Identifier: GPL-3.0-only
// P5-validation-is-data, P5-unsupplied-enumeration and P5-adif-cases — the
// exit gate (QGD-PRT-0105, QGD-REF-0005, QGD-REF-0006, QGD-REF-0008,
// QGD-REF-0016).
//
// The validator answers from the loaded data, so this runs a real engine,
// loads ADIF's definitions into it, reads the rules back out of PostgreSQL and
// validates ADIF's own 6,197 test QSOs with them. A field this product calls
// invalid is a finding against this product until shown otherwise, which is
// what QGD-REF-0008 says and what the run below holds to.
//
// Three properties, and the controls that stop each from passing vacuously:
//
// - the rules come from the database, not from this repository. Proved by
//   adding a mode to the database and seeing a QSO using it accepted with no
//   code change — and by removing one and seeing it refused.
// - "not checked against a list" is a third answer. Proved by the count of
//   them being what ADIF's archive accounts for, each with its reason.
// - a value the lists do cover and do not hold is still invalid. Without this,
//   QGD-REF-0016's coverage rule would be a way of passing everything.
import { expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redact } from './report.mjs';
import { binariesDirectory } from './postgres-build.mjs';
import { initialise, stop } from '../dist/engine/supervisor.js';
import { bringUp } from '../dist/engine/start.js';
import { chooseSocketDirectory, socketCandidates } from '../dist/engine/endpoint.js';
import { connectAsSuperuser } from '../dist/engine/roles.js';
import { REFERENCE_SCHEMA } from '../dist/engine/reference/schema.js';
import { openArchive } from '../dist/engine/reference/fetch.js';
import { parseAdi } from '../dist/engine/reference/adi.js';
import { readRuleset, rulesetOf, validateRecord } from '../dist/engine/reference/validate.js';

const build = JSON.parse(await readFile('data/postgres-build.json', 'utf8'));
const register = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const release = register.adif;
const cached = resolve('vendor', '.cache', `adif-${release.version}.zip`);
const archiveBytes = await readFile(cached).catch(() => undefined);
if (!archiveBytes) {
  console.error(`ADIF ${release.version}'s archive is not in ${cached}. Fetch it with: make setup`);
  process.exit(1);
}
const handOver = async () => archiveBytes;

const root = await mkdtemp(join(tmpdir(), 'qg-adif-cases-'));
const base = join(root, 'Application Support', 'QSO Graph Desktop');
const paths = {
  binaries: join(binariesDirectory(build), 'bin'),
  data: join(base, 'data'),
  sockets: chooseSocketDirectory(socketCandidates(join(base, 'data'), join(base, 'sockets'))),
  logs: join(base, 'logs')
};
const endpoint = { kind: 'socket', directory: paths.sockets };
const cache = join(base, 'reference');
const notes = [];

// One tag, as the ADI reader would have produced it.
const tag = (name, value, indicator) => ({
  name, value, length: Buffer.byteLength(value, 'utf8'), ...(indicator ? { indicator } : {})
});
const verdictOf = (ruleset, tags, field) => {
  const results = validateRecord(ruleset, { tags });
  return results.find(result => result.field === field);
};

try {
  await initialise(paths);
  await bringUp(paths, endpoint, {
    migrations: resolve('drizzle'),
    buildFile: resolve('data/postgres-build.json'),
    reference: { register, cacheDirectory: cache, fetchArchive: handOver }
  });
  const archive = await openArchive(release, cache, handOver);
  const client = await connectAsSuperuser(endpoint);

  try {
    // ---- the rules come out of the database ------------------------------
    const ruleset = await readRuleset(client);
    expect(ruleset.version).toBe(release.version);
    const fromArchive = rulesetOf(archive.definitions);
    // The load must lose nothing: the ruleset read back from PostgreSQL is
    // the one the archive describes, field for field and value for value.
    expect([...ruleset.fields.keys()].sort()).toEqual([...fromArchive.fields.keys()].sort());
    expect([...ruleset.enumerations.keys()].sort()).toEqual([...fromArchive.enumerations.keys()].sort());
    for (const [name, index] of ruleset.enumerations) {
      const other = fromArchive.enumerations.get(name);
      expect(index.valueColumn, `${name}'s value column`).toBe(other.valueColumn);
      expect(index.byValue.size, `${name}'s distinct values`).toBe(other.byValue.size);
    }
    for (const [name, rule] of ruleset.fields) {
      expect(rule, name).toEqual(fromArchive.fields.get(name));
    }
    notes.push(`the ruleset read back from PostgreSQL is the archive's, for all ${ruleset.fields.size} fields ` +
      `and ${ruleset.enumerations.size} enumerations`);

    // ---- P5-adif-cases: ADIF's own test QSOs -----------------------------
    const file = parseAdi(archive.testQsos);
    expect(file.records.length, "ADIF's test file must hold its QSOs").toBeGreaterThan(1000);
    expect(file.userDefined.length, 'and declare the fields of its own that it uses').toBeGreaterThan(0);

    const tally = { valid: 0, invalid: 0, unchecked: 0 };
    const disagreements = [];
    const unchecked = new Map();
    for (const [at, tags] of file.records.entries()) {
      for (const result of validateRecord(ruleset, { tags, userDefined: file.userDefined })) {
        tally[result.verdict] += 1;
        if (result.verdict === 'invalid') {
          const value = tags.find(entry => entry.name === result.field.toUpperCase())?.value;
          disagreements.push(`record ${at + 1}: ${result.field} = "${value}" — ${result.reason}`);
        }
        if (result.verdict === 'unchecked') {
          unchecked.set(result.reason, (unchecked.get(result.reason) ?? 0) + 1);
        }
      }
    }
    // QGD-REF-0008. Every one of these is listed, and the run fails on one
    // that is not accounted for — which is to say, on any of them.
    expect(disagreements, `this product disagrees with ADIF about ${disagreements.length} value(s):\n` +
      disagreements.slice(0, 20).join('\n')).toEqual([]);
    expect(tally.valid, 'and it must have actually checked them').toBeGreaterThan(10_000);
    notes.push(`${file.records.length} of ADIF's own test QSOs, ${tally.valid} values valid, ` +
      `${tally.unchecked} not checked against a list, 0 disagreements`);

    // ---- P5-unsupplied-enumeration: the third answer ---------------------
    // Every "not checked" has to be one of four causes, each a fact about
    // ADIF's archive rather than a gap in this product. Asserted both ways:
    // no reason outside the four, and none of the four missing — so a new
    // cause appears here as an unaccounted reason instead of merging into a
    // number, and a cause that stops happening is noticed too.
    const causes = {
      'DARC_DOK is typed Enumeration and names none': /types DARC_DOK as an enumeration and names none/,
      'MY_DARC_DOK is typed Enumeration and names none': /types MY_DARC_DOK as an enumeration and names none/,
      'SponsoredAwardList names an enumeration ADIF does not ship': /Sponsored_Award enumeration and ships no enumeration by that name/,
      'Secondary_Administrative_Subdivision does not cover the value': /Secondary_Administrative_Subdivision does not cover/
    };
    const kinds = [...unchecked.keys()].sort();
    const unaccounted = kinds.filter(reason => !Object.values(causes).some(pattern => pattern.test(reason)));
    expect(unaccounted, `a value was not checked for a reason nobody accounted for:\n${unaccounted.join('\n')}`)
      .toEqual([]);
    for (const [cause, pattern] of Object.entries(causes)) {
      expect(kinds.some(reason => pattern.test(reason)), `no value was unchecked because ${cause}`).toBe(true);
    }
    notes.push(`${Object.keys(causes).length} causes of "not checked against a list" across ${kinds.length} ` +
      "wordings, each a fact about ADIF's archive");

    // A DOK is checked for format and reported as not checked, which is
    // neither a pass nor a failure. Recording it as either fails this.
    for (const field of ['DARC_DOK', 'MY_DARC_DOK']) {
      const result = verdictOf(ruleset, [tag(field, 'A01')], field);
      expect(result.verdict, `${field} must be neither valid nor invalid`).toBe('unchecked');
      expect(result.reason).toContain('names none');
    }
    notes.push('a DOK is reported as not checked against a list, not as valid and not as invalid');

    // ---- QGD-REF-0016: coverage, and the control that it is not a loophole
    {
      // Massachusetts: the enumeration reaches one entity and not this one.
      const outside = verdictOf(
        ruleset, [tag('CNTY', 'MA,Middlesex'), tag('DXCC', '291')], 'CNTY');
      expect(outside.verdict).toBe('unchecked');
      expect(outside.reason).toContain('does not cover');

      // Alaska: the enumeration does reach this entity, so a county that is
      // not in it is invalid. Without this the rule above would be a way of
      // passing anything with a comma in it.
      const inside = verdictOf(
        ruleset, [tag('CNTY', 'AK,Nowhere At All'), tag('DXCC', '6')], 'CNTY');
      expect(inside.verdict, 'a county in a covered entity that ADIF does not list is invalid').toBe('invalid');
      const real = verdictOf(ruleset, [tag('CNTY', 'AK,Aleutians East'), tag('DXCC', '6')], 'CNTY');
      expect(real.verdict).toBe('valid');

      // And a plain enumeration has no coverage question at all.
      expect(verdictOf(ruleset, [tag('MODE', 'SSB')], 'MODE').verdict).toBe('valid');
      expect(verdictOf(ruleset, [tag('MODE', 'NOT_A_MODE')], 'MODE').verdict).toBe('invalid');
      expect(verdictOf(ruleset, [tag('BAND', '20m')], 'BAND').verdict).toBe('valid');
      expect(verdictOf(ruleset, [tag('BAND', '21m')], 'BAND').verdict).toBe('invalid');
      notes.push('a value the lists cover and do not hold is still invalid; coverage is not a way of passing');
    }

    // ---- a parameterised enumeration picks the row for the entity --------
    {
      // Nova Scotia is a subdivision of entity 1, not of 291.
      expect(verdictOf(ruleset, [tag('STATE', 'NS'), tag('DXCC', '1')], 'STATE').verdict).toBe('valid');
      const wrongEntity = verdictOf(ruleset, [tag('STATE', 'NS'), tag('DXCC', '291')], 'STATE');
      expect(wrongEntity.verdict, 'a subdivision of another entity is invalid, not valid').toBe('invalid');
      expect(wrongEntity.reason).toContain('not for DXCC 291');
      // With no DXCC to select by, there is no answer to give.
      expect(verdictOf(ruleset, [tag('STATE', 'NS')], 'STATE').verdict).toBe('unchecked');
      notes.push('a parameterised enumeration is checked against the entity its parameter names');
    }

    // ---- P5-validation-is-data: the data decides, not the code -----------
    {
      const mode = 'QGTEST';
      expect(verdictOf(ruleset, [tag('MODE', mode)], 'MODE').verdict).toBe('invalid');
      // A mode added to the data is accepted, with nothing recompiled and no
      // code aware of it (QGD-REF-0005).
      await client.query(
        `INSERT INTO ${REFERENCE_SCHEMA}.enumeration_value (enumeration, key, value) VALUES ($1, $2, $3)`,
        ['Mode', mode, JSON.stringify({ 'Enumeration Name': 'Mode', Mode: mode })]);
      const afterAdding = await readRuleset(client);
      expect(verdictOf(afterAdding, [tag('MODE', mode)], 'MODE').verdict,
        'a mode added to the data must be accepted without a code change').toBe('valid');

      // And the reverse, which is the control: removing a real one refuses it.
      await client.query(
        `DELETE FROM ${REFERENCE_SCHEMA}.enumeration_value WHERE enumeration = 'Mode' AND key = 'SSB'`);
      const afterRemoving = await readRuleset(client);
      expect(verdictOf(afterRemoving, [tag('MODE', 'SSB')], 'MODE').verdict,
        'and a mode taken out of the data must stop being accepted').toBe('invalid');

      // Put the data back as it was, so what follows reads the real thing.
      await client.query(
        `DELETE FROM ${REFERENCE_SCHEMA}.enumeration_value WHERE enumeration = 'Mode' AND key = $1`, [mode]);
      await client.query(
        `INSERT INTO ${REFERENCE_SCHEMA}.enumeration_value (enumeration, key, value) VALUES ($1, $2, $3)`,
        ['Mode', 'SSB', JSON.stringify({ 'Enumeration Name': 'Mode', Mode: 'SSB' })]);
      const restored = await readRuleset(client);
      expect(verdictOf(restored, [tag('MODE', 'SSB')], 'MODE').verdict).toBe('valid');
      notes.push('a mode added to the data is accepted and one removed is refused, with no code change');
    }

    // ---- an import-only value, and a deleted one -------------------------
    {
      // ADIF marks some modes import-only: they may be read, not written.
      const importOnly = await client.query(
        `SELECT key FROM ${REFERENCE_SCHEMA}.enumeration_value
         WHERE enumeration = 'Mode' AND import_only LIMIT 1`);
      const result = verdictOf(ruleset, [tag('MODE', importOnly.rows[0].key)], 'MODE');
      expect(result.verdict, 'an import-only value is valid to read').toBe('valid');
      expect(result.importOnly, 'and is marked as one, so nothing writes it back').toBe(true);

      // A deleted DXCC entity is still right in a QSO from 1991.
      const deleted = await client.query(
        `SELECT key FROM ${REFERENCE_SCHEMA}.enumeration_value
         WHERE enumeration = 'DXCC_Entity_Code' AND deleted LIMIT 1`);
      const old = verdictOf(ruleset, [tag('DXCC', deleted.rows[0].key)], 'DXCC');
      expect(old.verdict).toBe('valid');
      expect(old.deleted).toBe(true);
      notes.push('an import-only value is valid and marked; a deleted entity is valid and marked');
    }

    // ---- the data types, from ADIF's own descriptions ---------------------
    {
      const cases = [
        ['QSO_DATE', '20260122', 'valid'],
        ['QSO_DATE', '19291231', 'invalid'],
        ['QSO_DATE', '20260230', 'invalid'],
        ['TIME_ON', '000000', 'valid'],
        ['TIME_ON', '2460', 'invalid'],
        ['FREQ', '14.05', 'valid'],
        ['FREQ', '14.05.1', 'invalid'],
        ['GRIDSQUARE', 'FN31pr', 'valid'],
        ['GRIDSQUARE', 'ZZ99', 'invalid'],
        ['LAT', 'N041 23.000', 'valid'],
        ['LAT', 'N041 60.000', 'invalid'],
        ['POTA_REF', 'K-4578@US-WY', 'valid'],
        ['POTA_REF', 'K-4578@US-WYOMING', 'invalid'],
        ['WWFF_REF', 'KFF-4583', 'valid'],
        ['WWFF_REF', 'KF-4583', 'invalid'],
        ['SOTA_REF', 'W2/WE-003', 'valid'],
        ['SOTA_REF', 'W2/WE-3', 'invalid'],
        ['IOTA', 'NA-001', 'valid'],
        ['IOTA', 'XX-001', 'invalid'],
        ['EQSL_QSL_SENT', 'Y', 'valid'],
        ['EQSL_QSL_SENT', 'MAYBE', 'invalid']
      ];
      for (const [field, value, expected] of cases) {
        const result = verdictOf(ruleset, [tag(field, value)], field);
        expect(result.verdict, `${field} = "${value}" — ${result.reason ?? ''}`).toBe(expected);
      }
      notes.push(`${cases.length} data-type cases, each written from ADIF's own description of the type`);
    }

    // ---- a field ADIF does not define, and one of the user's own ---------
    {
      const unknown = verdictOf(ruleset, [tag('NOT_AN_ADIF_FIELD', 'x')], 'NOT_AN_ADIF_FIELD');
      expect(unknown.verdict, 'ADIF says to ignore a field it does not define, which is not a pass').toBe('unchecked');

      const declared = [{ number: 1, name: 'MY_POWER_CATEGORY', indicator: 'E', members: ['QRPP', 'QRP', 'QRO'] }];
      const good = validateRecord(ruleset, { tags: [tag('MY_POWER_CATEGORY', 'qrp')], userDefined: declared });
      expect(good[0].verdict, "a user-defined enumeration is case-insensitive, like ADIF's own").toBe('valid');
      const bad = validateRecord(ruleset, { tags: [tag('MY_POWER_CATEGORY', 'QRO+')], userDefined: declared });
      expect(bad[0].verdict).toBe('invalid');

      const ranged = [{ number: 1, name: 'MY_TEMP', indicator: 'N', range: { low: -50, high: 150 } }];
      expect(validateRecord(ruleset, { tags: [tag('MY_TEMP', '66')], userDefined: ranged })[0].verdict).toBe('valid');
      expect(validateRecord(ruleset, { tags: [tag('MY_TEMP', '200')], userDefined: ranged })[0].verdict).toBe('invalid');
      notes.push("a user-defined field is checked against the type, enumeration or range its header declared");
    }
  } finally {
    await client.end();
  }

  console.log(`ADIF validation: ${notes.length} checks: PASS`);
  for (const note of notes) console.log(`  ${note}`);
} catch (error) {
  console.error('ADIF validation failed.');
  console.error(redact(error.message).split('\n').slice(0, 24).join('\n'));
  if (error.detail) console.error(redact(String(error.detail)).split('\n').slice(0, 10).join('\n'));
  process.exitCode = 1;
} finally {
  await stop(paths).catch(() => {});
  await rm(root, { recursive: true, force: true });
  await rm(paths.sockets, { recursive: true, force: true });
}
