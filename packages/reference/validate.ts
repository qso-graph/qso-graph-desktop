// SPDX-License-Identifier: GPL-3.0-only
// Validating a QSO against what was loaded, not against what was written here.
//
// QGD-REF-0005: a field is checked against the data type and the enumeration
// ADIF gives it, so a release that adds a field, a mode or an entity changes
// the data and not this file. What is code here is one checker per ADIF data
// type — the rule that a Date is eight digits with a month between 1 and 12 is
// ADIF's prose, and prose has to be written down as code somewhere. What is
// never code here is which fields exist, what type each has, which enumeration
// it draws on, or what is in that enumeration.
//
// QGD-REF-0006: there are three answers, not two. A value can be valid,
// invalid, or **not checked against a list** — and the third is neither of the
// others and must not be recorded as one. Three cases reach it:
//
// - ADIF types a field `Enumeration` and ships no enumeration for it
//   (`DARC_DOK`, `MY_DARC_DOK`).
// - ADIF names an enumeration in a data type's own description and ships no
//   enumeration by that name. `SponsoredAwardList` is "a comma-delimited list
//   of members of the Sponsored_Award enumeration", and there is no
//   `Sponsored_Award` among the 25 — found by building this, not by reading.
// - This product has no checker for a data type ADIF defines, which keeps the
//   gap visible instead of letting it pass as a success.
import type { Tag, UserDefined } from './adi.js';
import { type Definitions, enumerations as enumerationsOf, fields as fieldsOf, values as valuesOf } from './adif.js';

export type Verdict = 'valid' | 'invalid' | 'unchecked';

export interface Result {
  field: string;
  verdict: Verdict;
  // Why, in a sentence a person can act on. Always present for invalid and
  // unchecked; absent for valid.
  reason?: string;
  // ADIF marks some values import-only: they may be read and must not be
  // written. Valid, with a note.
  importOnly?: boolean;
  // The value was in a list, and ADIF marks it deleted — a deleted DXCC entity
  // is still right in a QSO from 1991.
  deleted?: boolean;
}

export interface FieldRule {
  name: string;
  dataTypes: string[];
  enumerationName: string | null;
  enumerationParameter: string | null;
  importOnly: boolean;
}

export interface EnumerationValue {
  key: string;
  row: Record<string, string>;
  deleted: boolean;
  importOnly: boolean;
}

// An enumeration, indexed the way a validator has to ask about it: by the
// value a QSO field carries, which is the column ADIF puts second in the
// header — not by the archive's key, which for some enumerations is the value
// and the DXCC entity joined together.
//
// A value maps to a list of rows, not to one: "Code" is MA in Massachusetts
// and in Manitoba, and which is meant depends on the DXCC entity. That is what
// the parameter in `Secondary_Administrative_Subdivision[DXCC]` selects.
export interface EnumerationIndex {
  name: string;
  valueColumn: string;
  byValue: Map<string, EnumerationValue[]>;
}

export interface Ruleset {
  version: string;
  fields: Map<string, FieldRule>;
  dataTypes: Set<string>;
  enumerations: Map<string, EnumerationIndex>;
}

function index(name: string, valueColumn: string): EnumerationIndex {
  return { name, valueColumn, byValue: new Map() };
}

// Whether the list holds anything in the same part of the world as this
// value, which decides whether a miss is "invalid" or "not checked"
// (QGD-REF-0016).
//
// ADIF's Secondary_Administrative_Subdivision holds 58 rows, all in one DXCC
// entity, while CNTY is typed against it for every entity — so checking a
// Massachusetts county against it calls ADIF's own documented example invalid.
// A list that does not reach the value's domain cannot judge the value.
//
// Coverage is read off the data two ways, in this order:
//
// - by the entity, where the reference is parameterised: does the list hold
//   any row for the entity the parameter names?
// - by the leading segment, where the list's codes are composite: ADIF keys
//   this enumeration "AK,Aleutians East", so "MA,Franklin" is outside what it
//   covers if nothing in it begins "MA,".
//
// A plain value with neither — a mode, a band — is always covered, so a miss
// there is invalid, which is what it should be.
export function covers(index: EnumerationIndex, value: string, entity?: { column: string; value: string }): boolean {
  if (entity) {
    for (const rows of index.byValue.values()) {
      if (rows.some(row => row.row[entity.column] === entity.value)) return true;
    }
    return false;
  }
  const comma = value.indexOf(',');
  if (comma === -1) return true;
  const prefix = value.slice(0, comma + 1).toUpperCase();
  for (const key of index.byValue.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function add(into: EnumerationIndex, value: EnumerationValue): void {
  // ADIF's enumerations are case-insensitive by their own definition.
  const key = (value.row[into.valueColumn] ?? value.key).toUpperCase();
  const rows = into.byValue.get(key);
  if (rows) rows.push(value);
  else into.byValue.set(key, [value]);
}

// The rows a ruleset is made from. reference.sqlite's reader
// (packages/storage/reference-read.ts) hands its rows here, and nothing below
// knows a field name or an enumeration member: the data decides (QGD-REF-0005).
export interface RulesetRows {
  version: string;
  fields: { name: string; dataTypes: string[]; enumerationName: string | null;
    enumerationParameter: string | null; importOnly: boolean }[];
  dataTypes: string[];
  enumerations: { name: string; valueColumn: string }[];
  values: { enumeration: string; key: string; value: Record<string, string>; deleted: boolean; importOnly: boolean }[];
}

export function rulesetFromRows(rows: RulesetRows): Ruleset {
  // Every enumeration, including one that is in the archive with no values:
  // "empty" and "absent" are different answers and QGD-REF-0006 turns on it.
  const enumerations = new Map(rows.enumerations.map(row => [row.name, index(row.name, row.valueColumn)]));
  for (const row of rows.values) {
    const into = enumerations.get(row.enumeration);
    if (!into) throw new Error(`${row.enumeration} has values and is not an enumeration`);
    add(into, { key: row.key, row: row.value, deleted: row.deleted, importOnly: row.importOnly });
  }
  return {
    version: rows.version,
    fields: new Map(rows.fields.map(row => [row.name, {
      name: row.name,
      dataTypes: row.dataTypes,
      enumerationName: row.enumerationName,
      enumerationParameter: row.enumerationParameter,
      importOnly: row.importOnly
    }])),
    dataTypes: new Set(rows.dataTypes),
    enumerations
  };
}

export function rulesetOf(definitions: Definitions): Ruleset {
  const enumerations = new Map(enumerationsOf(definitions).map(
    row => [row.name, index(row.name, row.valueColumn)]));
  for (const row of valuesOf(definitions)) {
    const into = enumerations.get(row.enumeration);
    if (!into) throw new Error(`${row.enumeration} has values and is not an enumeration`);
    add(into, { key: row.key, row: row.value, deleted: row.deleted, importOnly: row.importOnly });
  }
  return {
    version: definitions.Version,
    fields: new Map(fieldsOf(definitions).map(row => [row.name, {
      name: row.name,
      dataTypes: row.dataTypes,
      enumerationName: row.enumerationName,
      enumerationParameter: row.enumerationParameter,
      importOnly: row.importOnly
    }])),
    dataTypes: new Set(Object.keys(definitions.DataTypes.Records)),
    enumerations
  };
}

// Printable ASCII: ADIF's Character is "code 32 through 126, inclusive".
const PRINTABLE = /^[ -~]*$/;
const DIGITS = /^[0-9]+$/;
// ADIF's Number: digits, optionally signed, optionally one decimal point.
//
// Written out rather than as one pattern. Every regular expression in this
// file reads a value that arrived over the network, and the security lint
// rejects a nested quantifier whether or not this particular one could
// backtrack — which is the right default in exactly this place, so these are
// linear by construction instead of by argument.
function isNumber(value: string): boolean {
  const body = value.startsWith('-') ? value.slice(1) : value;
  const point = body.indexOf('.');
  if (point !== body.lastIndexOf('.')) return false;
  const digits = point === -1 ? body : body.slice(0, point) + body.slice(point + 1);
  return digits.length > 0 && DIGITS.test(digits);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ADIF's Date: "8 Digits ... YYYYMMDD, where 1930 <= YYYY".
function checkDate(value: string): string | undefined {
  if (!/^\d{8}$/.test(value)) return 'not 8 digits';
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (year < 1930) return `the year ${year} is before 1930, which ADIF sets as the earliest`;
  if (month < 1 || month > 12) return `${month} is not a month`;
  if (day < 1 || day > daysInMonth(year, month)) return `${value.slice(6)} is not a day in ${value.slice(0, 6)}`;
  return undefined;
}

// ADIF's Time: 6 digits HHMMSS or 4 digits HHMM.
function checkTime(value: string): string | undefined {
  if (!/^\d{4}$/.test(value) && !/^\d{6}$/.test(value)) return 'not 4 or 6 digits';
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2, 4));
  const second = value.length === 6 ? Number(value.slice(4, 6)) : 0;
  if (hour > 23) return `${hour} is not an hour`;
  if (minute > 59) return `${minute} is not a minute`;
  if (second > 59) return `${second} is not a second`;
  return undefined;
}

// 2, 4, 6 or 8 characters, case-insensitive: a field pair, then a square
// pair, then a subsquare pair, then an extended-square pair. Checked pair by
// pair rather than with one nested pattern.
const LOCATOR_PAIRS = [/^[A-R][A-R]$/i, /^[0-9][0-9]$/, /^[A-X][A-X]$/i, /^[0-9][0-9]$/];

function checkGridSquare(value: string): string | undefined {
  const wrong = 'not a 2, 4, 6 or 8 character Maidenhead locator';
  if (value.length % 2 !== 0 || value.length < 2 || value.length > 8) return wrong;
  for (let pair = 0; pair < value.length / 2; pair += 1) {
    if (!LOCATOR_PAIRS[pair].test(value.slice(pair * 2, pair * 2 + 2))) return wrong;
  }
  return undefined;
}

// "XDDD MM.MMM", 11 characters.
function checkLocation(value: string): string | undefined {
  const wrong = 'not in XDDD MM.MMM form';
  if (value.length !== 11) return wrong;
  if (!/^[EWNS]$/i.test(value[0])) return wrong;
  const degrees = value.slice(1, 4);
  if (!/^[0-9]{3}$/.test(degrees) || value[4] !== ' ') return wrong;
  const minutes = value.slice(5);
  if (!/^[0-9]{2}\.[0-9]{3}$/.test(minutes)) return wrong;
  if (Number(degrees) > 180) return `${degrees} degrees is beyond 180`;
  if (Number(minutes) >= 60) return `${minutes} minutes is 60 or more`;
  return undefined;
}

// "xxxx-nnnnn[@yyyyyy]", 6 to 17 characters.
//
// The optional suffix is "the 4 to 6 character ISO 3166-2 code", so
// K-4578@US-WY is a valid reference. Required to be six characters, this
// called two of ADIF's own test QSOs invalid.
const PROGRAM = /^[0-9A-Z]{1,4}$/i;
const PARK_NUMBER = /^[0-9]{4,5}$/;
const ISO_3166_2 = /^[0-9A-Z-]{4,6}$/i;

function checkPotaRef(value: string): string | undefined {
  if (value.length < 6 || value.length > 17) return `${value.length} characters, not 6 to 17`;
  const wrong = 'not in xxxx-nnnnn[@yyyyyy] form';
  const at = value.indexOf('@');
  const reference = at === -1 ? value : value.slice(0, at);
  if (at !== -1) {
    const location = value.slice(at + 1);
    if (location.includes('@') || !ISO_3166_2.test(location)) return wrong;
  }
  const dash = reference.indexOf('-');
  if (dash === -1) return wrong;
  if (!PROGRAM.test(reference.slice(0, dash)) || !PARK_NUMBER.test(reference.slice(dash + 1))) return wrong;
  return undefined;
}

// "xxFF-nnnn", 8 to 11 characters.
function checkWwffRef(value: string): string | undefined {
  if (value.length < 8 || value.length > 11) return `${value.length} characters, not 8 to 11`;
  const wrong = 'not in xxFF-nnnn form';
  const dash = value.indexOf('-');
  if (dash === -1) return wrong;
  const program = value.slice(0, dash);
  if (!/^[0-9]{4}$/.test(value.slice(dash + 1))) return wrong;
  if (!program.toUpperCase().endsWith('FF')) return wrong;
  return PROGRAM.test(program.slice(0, -2)) ? undefined : wrong;
}

function checkSotaRef(value: string): string | undefined {
  const wrong = 'not in prefix/XX-nnn form';
  const slash = value.lastIndexOf('/');
  if (slash < 1) return wrong;
  if (!/^[0-9A-Z/]{1,8}$/i.test(value.slice(0, slash))) return wrong;
  const summit = value.slice(slash + 1);
  if (summit.length !== 6 || summit[2] !== '-') return wrong;
  if (!/^[A-Z][A-Z]$/i.test(summit.slice(0, 2))) return wrong;
  return /^[0-9]{3}$/.test(summit.slice(3)) ? undefined : wrong;
}

// A checker per data type, each written from ADIF's own description of it.
// `undefined` means valid; a string says what is wrong.
type Check = (value: string, ruleset: Ruleset) => string | undefined;

// The sentinel a check returns when the list it needs is not in the archive.
// A caller that could not tell "not in the list" from "there is no list" would
// answer the first when it meant the second (QGD-REF-0006).
export const UNSUPPLIED = 'ADIF supplies no such list';

const CHECKS: Record<string, Check> = {
  Boolean: value => (/^[YN]$/i.test(value) ? undefined : 'not Y or N'),
  Digit: value => (/^[0-9]$/.test(value) ? undefined : 'not a single digit'),
  Integer: value => (/^-?[0-9]+$/.test(value) ? undefined : 'not an integer'),
  Number: value => (isNumber(value) ? undefined : 'not a number'),
  PositiveInteger: value => {
    if (!DIGITS.test(value)) return 'not an unsigned integer';
    return Number(value) > 0 ? undefined : 'not greater than 0';
  },
  Character: value => (value.length === 1 && PRINTABLE.test(value) ? undefined : 'not one printable ASCII character'),
  IntlCharacter: value => ([...value].length === 1 && !/[\r\n]/.test(value) ? undefined : 'not one character'),
  String: value => (PRINTABLE.test(value) ? undefined : 'holds a character outside printable ASCII'),
  IntlString: value => (/[\r\n]/.test(value) ? 'holds a line break' : undefined),
  MultilineString: value => {
    // Characters and line breaks, where a line break is CR followed by LF.
    const withoutBreaks = value.replace(/\r\n/g, '');
    if (/[\r\n]/.test(withoutBreaks)) return 'holds a CR or LF that is not part of a CRLF pair';
    return PRINTABLE.test(withoutBreaks) ? undefined : 'holds a character outside printable ASCII';
  },
  IntlMultilineString: value => {
    const withoutBreaks = value.replace(/\r\n/g, '');
    return /[\r\n]/.test(withoutBreaks) ? 'holds a CR or LF that is not part of a CRLF pair' : undefined;
  },
  Date: checkDate,
  Time: checkTime,
  GridSquare: checkGridSquare,
  GridSquareExt: value => {
    const wrong = 'not 2 or 4 characters of an extended locator';
    if (value.length !== 2 && value.length !== 4) return wrong;
    if (!/^[A-X][A-X]$/i.test(value.slice(0, 2))) return wrong;
    if (value.length === 4 && !/^[0-9][0-9]$/.test(value.slice(2))) return wrong;
    return undefined;
  },
  GridSquareList: value => listOf(value, ',', checkGridSquare),
  Location: checkLocation,
  POTARef: checkPotaRef,
  POTARefList: value => listOf(value, ',', checkPotaRef),
  SOTARef: checkSotaRef,
  WWFFRef: checkWwffRef,
  IOTARefNo: (value, ruleset) => {
    const match = /^([A-Z]{2})-([0-9]{3})$/i.exec(value);
    if (!match) return 'not in CC-XXX form';
    const continents = ruleset.enumerations.get('Continent');
    if (!continents) return UNSUPPLIED;
    if (!continents.byValue.has(match[1].toUpperCase())) return `${match[1]} is not a continent ADIF lists`;
    if (Number(match[2]) < 1) return 'the group designator is 000';
    return undefined;
  },
  AwardList: (value, ruleset) => listOf(value, ',', item => inEnumeration(ruleset, 'Award', item)),
  CreditList: (value, ruleset) => listOf(value, ',', item => {
    // "A member of Credit, optionally followed by a colon and an
    // ampersand-delimited list of members of QSL_Medium."
    const [credit, media] = item.split(':');
    const wrong = inEnumeration(ruleset, 'Credit', credit);
    if (wrong) return wrong;
    if (media === undefined) return undefined;
    return listOf(media, '&', medium => inEnumeration(ruleset, 'QSL_Medium', medium));
  }),
  SecondarySubdivisionList: (value, ruleset) =>
    listOf(value, ':', item => inEnumeration(ruleset, 'Secondary_Administrative_Subdivision', item)),
  SecondaryAdministrativeSubdivisionListAlt: (value, ruleset) =>
    listOf(value, ';', item => inEnumeration(ruleset, 'Secondary_Administrative_Subdivision_Alt', item))
};

function listOf(value: string, separator: string, check: (item: string) => string | undefined): string | undefined {
  for (const item of value.split(separator)) {
    if (item === '') return 'has an empty item';
    const wrong = check(item);
    if (wrong === UNSUPPLIED) return UNSUPPLIED;
    if (wrong?.startsWith(UNCOVERED)) return wrong;
    if (wrong) return `"${item}": ${wrong}`;
  }
  return undefined;
}

function inEnumeration(ruleset: Ruleset, name: string, value: string): string | undefined {
  const found = ruleset.enumerations.get(name);
  if (!found) return UNSUPPLIED;
  if (found.byValue.has(value.toUpperCase())) return undefined;
  // QGD-REF-0016: outside what the list covers is not the same as absent
  // from it. ADIF's own example for this type is three counties of a state
  // the enumeration does not reach.
  if (!covers(found, value)) return `${UNCOVERED}${name}`;
  return `not in ADIF's ${name}`;
}

// The sentinel for a value the list does not reach, carrying the list's name.
export const UNCOVERED = 'outside the coverage of ';

// The data types for which ADIF names an enumeration it does not ship.
// Discovered by running this against ADIF's own test QSOs, not by reading.
export const UNSUPPLIED_LIST_TYPES: Record<string, string> = {
  SponsoredAwardList:
    'ADIF describes this as a list of members of the Sponsored_Award enumeration and ships no enumeration by that name'
};

export interface RecordInput {
  tags: Tag[];
  userDefined?: UserDefined[];
}

export function validateRecord(ruleset: Ruleset, input: RecordInput): Result[] {
  const userDefined = new Map((input.userDefined ?? []).map(entry => [entry.name.toUpperCase(), entry]));
  const values = new Map(input.tags.map(tag => [tag.name.toUpperCase(), tag.value]));
  return input.tags.map(tag => validateField(ruleset, tag, values, userDefined));
}

// ADIF's own indicators, used by USERDEF and APP_ fields, which carry a type
// letter rather than a type name.
const BY_INDICATOR: Record<string, string> = {
  B: 'Boolean', N: 'Number', D: 'Date', T: 'Time', S: 'String', I: 'IntlString',
  M: 'MultilineString', G: 'IntlMultilineString', E: 'Enumeration', L: 'Location'
};

function validateField(
  ruleset: Ruleset,
  tag: Tag,
  values: Map<string, string>,
  userDefined: Map<string, UserDefined>
): Result {
  const name = tag.name.toUpperCase();

  // A field of the user's own, declared in the header with its own type and
  // its own enumeration or range. Checked against what was declared.
  const declared = userDefined.get(name);
  if (declared) return validateUserDefined(ruleset, tag, declared);

  // An application's own field. ADIF gives it a type indicator inline and
  // nothing else, so the type is all there is to check.
  if (name.startsWith('APP_')) {
    const type = tag.indicator ? BY_INDICATOR[tag.indicator] : undefined;
    if (!type) {
      return { field: tag.name, verdict: 'unchecked', reason: 'an application field with no type indicator' };
    }
    return byDataType(ruleset, tag, [type]);
  }

  const rule = ruleset.fields.get(name);
  if (!rule) {
    // ADIF says to ignore a field it does not define, so this is not a
    // failure of the record — but it is not a pass either.
    return { field: tag.name, verdict: 'unchecked', reason: 'not a field ADIF defines' };
  }

  // An enumeration field is checked against its own enumeration, which may be
  // selected by another field's value.
  if (rule.dataTypes.includes('Enumeration')) {
    return byEnumeration(ruleset, tag, rule, values);
  }
  return byDataType(ruleset, tag, rule.dataTypes, rule);
}

function validateUserDefined(ruleset: Ruleset, tag: Tag, declared: UserDefined): Result {
  if (declared.members) {
    const allowed = declared.members.some(member => member.toUpperCase() === tag.value.toUpperCase());
    return allowed
      ? { field: tag.name, verdict: 'valid' }
      : { field: tag.name, verdict: 'invalid', reason: `not one of ${declared.members.join(', ')}` };
  }
  if (declared.range) {
    if (!isNumber(tag.value)) {
      return { field: tag.name, verdict: 'invalid', reason: 'not a number' };
    }
    const number = Number(tag.value);
    return number >= declared.range.low && number <= declared.range.high
      ? { field: tag.name, verdict: 'valid' }
      : { field: tag.name, verdict: 'invalid', reason: `outside ${declared.range.low} to ${declared.range.high}` };
  }
  const type = declared.indicator ? BY_INDICATOR[declared.indicator] : undefined;
  if (!type) {
    return { field: tag.name, verdict: 'unchecked', reason: 'a user-defined field with no type indicator' };
  }
  return byDataType(ruleset, tag, [type]);
}

function byEnumeration(
  ruleset: Ruleset,
  tag: Tag,
  rule: FieldRule,
  values: Map<string, string>
): Result {
  if (!rule.enumerationName) {
    // QGD-REF-0006: typed Enumeration with no enumeration named. Not a pass
    // and not a failure.
    return {
      field: tag.name,
      verdict: 'unchecked',
      reason: `ADIF types ${rule.name} as an enumeration and names none, so there is no list to check it against`
    };
  }
  const list = ruleset.enumerations.get(rule.enumerationName);
  if (!list) {
    return {
      field: tag.name,
      verdict: 'unchecked',
      reason: `ADIF names the ${rule.enumerationName} enumeration and does not supply it`
    };
  }

  const column = rule.enumerationParameter ? parameterColumn(ruleset, rule.enumerationParameter) : undefined;
  const parameter = rule.enumerationParameter
    ? values.get(rule.enumerationParameter.toUpperCase())
    : undefined;
  // QGD-REF-0016, asked before the value is judged: a list that does not
  // reach this value's domain cannot say the value is wrong.
  const reach = column && parameter !== undefined
    ? covers(list, tag.value, { column, value: parameter })
    : covers(list, tag.value);
  if (!reach) {
    return {
      field: tag.name,
      verdict: 'unchecked',
      reason: `ADIF's ${rule.enumerationName} does not cover this value` +
        (parameter !== undefined ? ` for ${rule.enumerationParameter} ${parameter}` : '') +
        ', so there is no list to check it against (QGD-REF-0016)'
    };
  }

  const candidates = list.byValue.get(tag.value.toUpperCase());
  if (!candidates) {
    return { field: tag.name, verdict: 'invalid', reason: `not in ADIF's ${rule.enumerationName}` };
  }

  // A parameterised reference — STATE is
  // `Primary_Administrative_Subdivision[DXCC]` — means "the subdivisions of
  // the entity in the DXCC field", so the matching row has to be the one for
  // that entity.
  //
  // Which column of the enumeration holds the entity is derived, not listed:
  // the parameter names a field (DXCC), that field's own enumeration is
  // DXCC_Entity_Code, and the column is that name with its underscores as
  // spaces — "DXCC Entity Code", which is what all three subdivision
  // enumerations call it. A column that is not there leaves the value
  // unchecked rather than guessed at.
  let found = candidates[0];
  if (rule.enumerationParameter) {
    if (parameter === undefined) {
      return {
        field: tag.name,
        verdict: 'unchecked',
        reason: `${rule.name} is selected by ${rule.enumerationParameter}, which this record does not carry`
      };
    }
    if (!column || !(column in candidates[0].row)) {
      return {
        field: tag.name,
        verdict: 'unchecked',
        reason: `${rule.enumerationName} carries no column for ${rule.enumerationParameter}, ` +
          'so which of its rows is meant cannot be decided'
      };
    }
    const forEntity = candidates.find(candidate => candidate.row[column] === parameter);
    if (!forEntity) {
      return {
        field: tag.name,
        verdict: 'invalid',
        reason: `in ADIF's ${rule.enumerationName}, but not for ${rule.enumerationParameter} ${parameter}`
      };
    }
    found = forEntity;
  }

  return {
    field: tag.name,
    verdict: 'valid',
    ...(found.importOnly ? { importOnly: true } : {}),
    ...(found.deleted ? { deleted: true } : {})
  };
}

// The enumeration column that answers a parameter, derived from the parameter
// field's own enumeration name. DXCC -> DXCC_Entity_Code -> "DXCC Entity Code".
export function parameterColumn(ruleset: Ruleset, parameter: string): string | undefined {
  const field = ruleset.fields.get(parameter.toUpperCase());
  return field?.enumerationName?.replaceAll('_', ' ');
}

function byDataType(ruleset: Ruleset, tag: Tag, dataTypes: string[], rule?: FieldRule): Result {
  const unsupplied = dataTypes.find(type => UNSUPPLIED_LIST_TYPES[type]);
  if (unsupplied) {
    return { field: tag.name, verdict: 'unchecked', reason: UNSUPPLIED_LIST_TYPES[unsupplied] };
  }
  const withChecker = dataTypes.filter(type => CHECKS[type]);
  if (withChecker.length === 0) {
    return {
      field: tag.name,
      verdict: 'unchecked',
      reason: `no checker for the ${dataTypes.join(' or ')} data type`
    };
  }
  // A cell naming two types means the value may be either, so one passing is
  // enough — CREDIT_GRANTED is a CreditList or an AwardList.
  const reasons: string[] = [];
  for (const type of withChecker) {
    const wrong = CHECKS[type](tag.value, ruleset);
    if (wrong === undefined) {
      return { field: tag.name, verdict: 'valid', ...(rule?.importOnly ? { importOnly: true } : {}) };
    }
    if (wrong === UNSUPPLIED) {
      return { field: tag.name, verdict: 'unchecked', reason: `ADIF does not supply a list the ${type} type needs` };
    }
    if (wrong.startsWith(UNCOVERED)) {
      const name = wrong.slice(UNCOVERED.length);
      return {
        field: tag.name,
        verdict: 'unchecked',
        reason: `ADIF's ${name} does not cover this value, so there is no list to check it against (QGD-REF-0016)`
      };
    }
    reasons.push(`${type}: ${wrong}`);
  }
  return { field: tag.name, verdict: 'invalid', reason: reasons.join('; ') };
}
