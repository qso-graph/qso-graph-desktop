// SPDX-License-Identifier: GPL-3.0-only
// P5-archive and P5-provenance: the ADIF release is the one that was pinned,
// and every list it carries records who owns it separately from where this
// copy came from (QGD-REF-0002, QGD-REF-0003).
//
// Its own suite, like engine-binaries, so a missing archive says "run make
// setup" once rather than failing everything built on it for the same reason.
import { readFile } from 'node:fs/promises';
import { definitionsPath, releaseDirectory, testQsosPath, verifyRelease } from './adif-release.mjs';

const sources = JSON.parse(await readFile('data/reference-sources.json', 'utf8'));
const release = sources.adif;
const check = await verifyRelease(release);
const failures = [];

if (!check.ok) {
  for (const problem of check.problems) failures.push(problem);
  failures.push('Fetch and verify it with: make setup');
} else {
  const definitions = JSON.parse(await readFile(definitionsPath(release), 'utf8')).Adif;

  // What the archive actually contains, counted rather than assumed.
  const fields = Object.keys(definitions.Fields?.Records ?? {}).length;
  const enumerations = Object.keys(definitions.Enumerations ?? {}).length;
  if (fields < 150) failures.push(`the definitions hold ${fields} fields, which is too few to be ADIF`);
  if (enumerations < 20) failures.push(`the definitions hold ${enumerations} enumerations, which is too few to be ADIF`);

  // QGD-REF-0006: ADIF types these as enumerations and supplies neither. If a
  // later release ever does supply them, the validator's "not checked against
  // a list" answer stops being the right one and this says so.
  for (const name of ['DARC_DOK', 'MY_DARC_DOK']) {
    const field = definitions.Fields?.Records?.[name];
    if (!field) { failures.push(`${name} is not in the definitions at all`); continue; }
    if (field['Data Type'] !== 'Enumeration') {
      failures.push(`${name} is typed ${field['Data Type']}, not Enumeration — QGD-REF-0006 was written about the Enumeration case`);
    }
    const supplied = field.Enumeration && definitions.Enumerations?.[field.Enumeration];
    if (supplied) {
      failures.push(`${name} now has an enumeration in the archive; QGD-REF-0006 and data/reference-sources.json say ADIF supplies none`);
    }
  }

  // QGD-REF-0007: the zones are columns on the subdivisions, not lists.
  const subdivisions = definitions.Enumerations?.Primary_Administrative_Subdivision;
  for (const column of ['CQ Zone', 'ITU Zone']) {
    if (!subdivisions?.Header?.includes(column)) {
      failures.push(`Primary_Administrative_Subdivision no longer carries "${column}"; QGD-REF-0007 derives the zones from it`);
    }
  }
  for (const name of Object.keys(definitions.Enumerations ?? {})) {
    if (/^(CQ|ITU)_?Zone/i.test(name)) {
      failures.push(`ADIF now publishes ${name} as an enumeration; QGD-REF-0007 says it does not, and deriving them would be the wrong answer`);
    }
  }

  // QGD-REF-0002: who owns it, and where this copy came from, as two facts.
  for (const list of sources.lists) {
    for (const field of ['id', 'what', 'authority', 'copy']) {
      if (!list[field]) failures.push(`the "${list.id ?? '?'}" list has no ${field}`);
    }
    for (const field of ['supplied', 'derived']) {
      if (typeof list[field] !== 'boolean') {
        failures.push(`the "${list.id}" list's ${field} is not a boolean; the loader acts on it`);
      }
    }
    if (list.authority === list.copy) {
      failures.push(`the "${list.id}" list gives the same answer for who owns it and where it came from; they are different questions`);
    }
    // The flag and the sentence have to say the same thing. The loader reads
    // the flag and a person reads the sentence, so a register where they
    // disagree misleads one of them — and before the flags existed, the
    // loader read the sentence's first word, which is not a fact.
    const saysNot = list.copy.startsWith('NOT');
    if (saysNot === list.supplied) {
      failures.push(`the "${list.id}" list says "${list.copy.slice(0, 24)}…" and has supplied: ${list.supplied}; those disagree`);
    }
  }

  const unsupplied = sources.lists.filter(list => !list.supplied);
  if (unsupplied.length < 3) {
    failures.push('the register no longer records the lists ADIF does not supply; CQ zones, ITU zones and DARC DOKs were three of them');
  }
  // QGD-REF-0015: a derived list is derived from something that is there.
  for (const list of sources.lists.filter(entry => entry.derived)) {
    if (list.supplied) failures.push(`the "${list.id}" list is marked both derived and supplied`);
    if (!/QGD-REF-0015/.test(list.copy)) {
      failures.push(`the "${list.id}" list is derived and does not say how far the derivation reaches (QGD-REF-0015)`);
    }
  }

  const qsos = (await readFile(testQsosPath(release), 'utf8'));
  if (!/<eor>/i.test(qsos)) failures.push("ADIF's test QSOs do not look like an ADI file");
}

if (failures.length) {
  console.error('ADIF reference check failed.');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  const definitions = JSON.parse(await readFile(definitionsPath(release), 'utf8')).Adif;
  console.log(`ADIF reference: ${check.version} from ${releaseDirectory(release)} — ` +
    `${Object.keys(definitions.Fields.Records).length} fields, ${Object.keys(definitions.Enumerations).length} enumerations, ` +
    `${sources.lists.length} lists with their owners recorded (${sources.lists.filter(l => !l.supplied).length} not supplied, ` +
    `${sources.lists.filter(l => l.derived).length} derived): PASS`);
}
