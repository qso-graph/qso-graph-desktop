// SPDX-License-Identifier: GPL-3.0-only
// The one place an error caught in storage or reference code is turned into
// something that may be used: in an outcome, a reason, a log entry or a reply.
//
// QGD-ENG-0016. Drizzle puts the SQL and every bound parameter in its own error
// message (DrizzleQueryError), and the logger redacts by field name
// (QGD-LOG-0003), so a callsign or a credential inside a message would pass
// straight through it. What leaves here is an error kind of ours, SQLite's
// numeric code and the name SQLite gives that code. It never includes
// the message, the SQL or a value. Nothing else in packages/storage or
// packages/reference reads `.message` from a caught error, and security-lint
// holds that.

export const STORAGE_ERROR_KINDS = [
  'open',        // a store could not be opened or created
  'not-sqlite',  // a file at a store's path is not a SQLite database (QGD-ENG-0008)
  'migration',   // a migration failed and was rolled back whole (QGD-ENG-0013)
  'query',       // a statement failed
  'path',        // an application folder would leave apps/ (QGD-ENG-0018)
  'build',       // a reference build failed and the live file is untouched (QGD-ENG-0015)
  'fetch',       // a source could not be fetched; the last good copy stands (QGD-REF-0010)
  'pending',     // not asked at all: the credential core was not up yet
  'shape',       // a source arrived the wrong shape and was refused (QGD-REF-0010)
  'internal'     // anything else; never more specific than this
] as const;
export type StorageErrorKind = (typeof STORAGE_ERROR_KINDS)[number];

export interface StorageError {
  readonly kind: StorageErrorKind;
  // SQLite's primary result code, when the failure came from SQLite.
  readonly code?: number;
  // The name SQLite gives that code (SQLITE_CONSTRAINT and so on), taken from
  // the table below by the code alone. Never text a caller supplied.
  readonly sqlite?: string;
}

// SQLite's primary result codes and their names (sqlite3.h). An extended code
// carries its primary code in the low byte.
const RESULT_CODES: Readonly<Record<number, string>> = {
  1: 'SQLITE_ERROR', 2: 'SQLITE_INTERNAL', 3: 'SQLITE_PERM', 4: 'SQLITE_ABORT', 5: 'SQLITE_BUSY',
  6: 'SQLITE_LOCKED', 7: 'SQLITE_NOMEM', 8: 'SQLITE_READONLY', 9: 'SQLITE_INTERRUPT', 10: 'SQLITE_IOERR',
  11: 'SQLITE_CORRUPT', 12: 'SQLITE_NOTFOUND', 13: 'SQLITE_FULL', 14: 'SQLITE_CANTOPEN', 15: 'SQLITE_PROTOCOL',
  16: 'SQLITE_EMPTY', 17: 'SQLITE_SCHEMA', 18: 'SQLITE_TOOBIG', 19: 'SQLITE_CONSTRAINT', 20: 'SQLITE_MISMATCH',
  21: 'SQLITE_MISUSE', 22: 'SQLITE_NOLFS', 23: 'SQLITE_AUTH', 24: 'SQLITE_FORMAT', 25: 'SQLITE_RANGE',
  26: 'SQLITE_NOTADB', 27: 'SQLITE_NOTICE', 28: 'SQLITE_WARNING'
};

// Every reduced error is built here, from validated parts only, and frozen. A
// caller cannot hand in text that survives: the kind must be one of ours, the
// code an integer SQLite defines, and the name comes from the table.
function sanitize(input: { kind?: unknown; code?: unknown }): StorageError {
  const kind = (STORAGE_ERROR_KINDS as readonly unknown[]).includes(input.kind) ? input.kind as StorageErrorKind : 'internal';
  if (typeof input.code !== 'number' || !Number.isInteger(input.code) || input.code < 0) return Object.freeze({ kind });
  const primary = input.code & 0xff;
  const name = RESULT_CODES[primary];
  return name ? Object.freeze({ kind, code: primary, sqlite: name }) : Object.freeze({ kind });
}

// Thrown by storage code that has already reduced a failure. Its message is
// built only from the sanitized fields, so even a caller that logs `.message`
// cannot leak anything through it.
export class StorageFailure extends Error {
  readonly reduced: StorageError;
  constructor(reduced: { kind?: unknown; code?: unknown }) {
    const clean = sanitize(reduced);
    super(describe(clean));
    this.name = 'StorageFailure';
    this.reduced = clean;
  }
}

export function describe(error: StorageError): string {
  const parts: string[] = [`storage ${error.kind} failure`];
  if (error.code !== undefined) parts.push(`SQLite ${error.code}`);
  if (error.sqlite !== undefined) parts.push(error.sqlite);
  return parts.join(': ');
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// node:sqlite raises errors with `errcode`, a number. Drizzle wraps them and
// keeps the original as `cause`. So the chain is walked and only the number is
// read; the depth is bounded so that a cause cycle cannot loop.
function sqliteCode(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && record(current); depth += 1) {
    if (typeof current.errcode === 'number') return current.errcode;
    current = current.cause;
  }
  return undefined;
}

// A failure already reduced somewhere down the chain wins. Drizzle wraps what
// the adapter throws in a DrizzleQueryError of its own, whose message carries
// the bound values, and keeps the adapter's failure as its cause.
function alreadyReduced(error: unknown): StorageFailure | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && record(current); depth += 1) {
    if (current instanceof StorageFailure) return current;
    current = current.cause;
  }
  return undefined;
}

export function reduce(error: unknown, kind: StorageErrorKind = 'internal'): StorageError {
  const reduced = alreadyReduced(error);
  if (reduced) return reduced.reduced;
  return sanitize({ kind, code: sqliteCode(error) });
}

// The form used at a catch site that rethrows.
export function failure(error: unknown, kind: StorageErrorKind = 'internal'): StorageFailure {
  return error instanceof StorageFailure ? error : new StorageFailure(reduce(error, kind));
}
