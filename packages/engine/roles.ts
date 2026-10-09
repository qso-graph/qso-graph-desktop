// SPDX-License-Identifier: GPL-3.0-only
// One role and one schema per application, with a password that lives only as
// long as the engine does.
//
// QGD-ENG-0010. The password is fresh random bytes at every start and is never
// written to disk: it is set on the role over the superuser's own connection
// and handed to the application in memory. A password nobody stored is a
// password nobody can read out of a backup, a log or a settings file.
//
// QGD-ENG-0001: the roles are how the grant model reaches the data. An
// application gets its own schema, and is not granted anything outside it.
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { connection, type Endpoint } from './endpoint.js';
import { superuser } from './supervisor.js';

// A role name is spliced into SQL that cannot take a parameter — CREATE ROLE
// and CREATE SCHEMA name their subject, they do not bind it. So the names are
// not accepted from anywhere: they come from this list, and anything not in it
// is refused before a statement is built (QGD-SEC-0005).
export const APPLICATIONS = ['adif', 'club', 'editor'] as const;
export type Application = (typeof APPLICATIONS)[number];

export function isApplication(value: unknown): value is Application {
  return typeof value === 'string' && (APPLICATIONS as readonly string[]).includes(value);
}

export function roleName(application: Application): string {
  return `qg_${application}`;
}

export function schemaName(application: Application): string {
  return `qg_${application}`;
}

// 32 bytes, base64url. Long enough that it is not guessed, and with no
// character that needs escaping anywhere it is carried.
export function newPassword(): string {
  return randomBytes(32).toString('base64url');
}

export interface Grant {
  application: Application;
  role: string;
  schema: string;
  password: string;
}

// An identifier this module built, checked again at the point of use. The
// belt to the braces above: if a name ever does come from somewhere else,
// this is what stops it reaching a statement.
function identifier(name: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`"${name}" is not a name this may build SQL with.`);
  }
  return name;
}

// A pg Client emits 'error' for a connection that drops with no query in
// flight, and an 'error' event nobody is listening for ends the process. The
// engine stopping is a normal thing for the frame to do, and it must not take
// the application down with it — so every client gets a listener. A query that
// fails still rejects its own promise; nothing is swallowed that a caller
// would otherwise see.
function attend(client: Client, onError?: (error: Error) => void): Client {
  client.on('error', error => onError?.(error as Error));
  return client;
}

export async function connectAsSuperuser(
  endpoint: Endpoint,
  database = 'postgres',
  onError?: (error: Error) => void
): Promise<Client> {
  const client = attend(new Client({ ...connection(endpoint, database, superuser()) }), onError);
  await client.connect();
  return client;
}

// Creates what is missing and resets the password, so a restart is the same
// path as a first run and there is no "already set up" branch to get wrong.
export async function provision(client: Client, application: Application): Promise<Grant> {
  const role = identifier(roleName(application));
  const schema = identifier(schemaName(application));
  const password = newPassword();

  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (exists.rowCount === 0) {
    // LOGIN and nothing else: no CREATEDB, no CREATEROLE, no SUPERUSER.
    await client.query(`CREATE ROLE ${role} LOGIN`);
  }
  // The password is a parameter nowhere in PostgreSQL's grammar, so it is set
  // with a format that quotes it rather than concatenated in.
  await client.query(`ALTER ROLE ${role} WITH PASSWORD ${literal(password)}`);

  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema} AUTHORIZATION ${role}`);
  // Its own schema and no other. public is left alone, and revoked below so
  // an application cannot quietly create tables where everyone can see them.
  await client.query(`REVOKE ALL ON SCHEMA public FROM ${role}`);
  await client.query(`GRANT ALL ON SCHEMA ${schema} TO ${role}`);
  await client.query(`ALTER ROLE ${role} SET search_path TO ${schema}`);

  return { application, role, schema, password };
}

// PostgreSQL's own quoting for a string literal: single quotes, doubled
// inside. The password is base64url so this never has to do anything, which
// is the point — it is here so that a future password that did contain a
// quote would still be safe rather than a syntax error or worse.
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function connectAs(
  endpoint: Endpoint,
  grant: Grant,
  database = 'postgres',
  onError?: (error: Error) => void
): Promise<Client> {
  const client = attend(new Client({
    ...connection(endpoint, database, grant.role),
    password: grant.password
  }), onError);
  await client.connect();
  return client;
}
