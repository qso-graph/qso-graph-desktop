// SPDX-License-Identifier: GPL-3.0-only
// Getting ADIF's published archive, at run time, and proving it is the one
// that was pinned.
//
// QGD-REF-0001 and QGD-REF-0003. The archive is not in the installer: a later
// ADIF release has to be new data rather than a new build, so the frame
// fetches it and nothing of ADIF's is redistributed by this product. The
// SHA-256 in data/reference-sources.json is checked before a byte is read out
// of it, exactly as QGD-ENG-0004 treats the database build.
//
// The cached copy is verified the same way as the downloaded one. A cache
// trusted because it is a cache is a way of skipping the check that matters —
// and the cache is a file in the user's own directory, which is the easiest
// thing on the machine for something else to write to.
//
// **Nothing here opens a connection.** KI7MT decided that all of this
// product's outbound HTTPS goes through the Rust credential core (D-18,
// D-31), because Electron's networking is BoringSSL and not the validated
// module — "without that, the FIPS claim would be false for most traffic".
// The first version of this module called Node's `fetch` from the engine
// process. It worked, and it was wrong. The fetching function is passed in,
// and in the product it is the one that asks the core.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { read } from './zip.js';
import { definitionsOf, type Definitions } from './adif.js';

export interface Release {
  version: string;
  source: {
    what: string; url: string; sha256: string; published: string;
    definitions: string; testQsos: string;
  };
}

// How bytes are obtained. Supplied by the caller — in the product, the
// function that asks the credential core; in a suite, one that hands over
// bytes it already has. There is no default, deliberately: a default would be
// a connection opened from this process, which is the thing D-18 forbids.
export type FetchArchive = (url: string) => Promise<Buffer>;

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function cachePath(directory: string, release: Release): string {
  return join(directory, `adif-${release.version}.zip`);
}

export interface Obtained {
  bytes: Buffer;
  fromCache: boolean;
}

export async function obtain(
  release: Release,
  directory: string,
  fetchArchive: FetchArchive
): Promise<Obtained> {
  const path = cachePath(directory, release);
  const cached = await readFile(path).catch(() => undefined);
  if (cached && digest(cached) === release.source.sha256) {
    return { bytes: cached, fromCache: true };
  }
  if (cached) {
    // Present and not what was pinned. Removed rather than left to be found
    // again by the next start, and the fetch goes ahead.
    await rm(path, { force: true });
  }

  const bytes = await fetchArchive(release.source.url);
  const got = digest(bytes);
  if (got !== release.source.sha256) {
    throw new Error(`${release.source.url}: expected SHA-256 ${release.source.sha256}, got ${got}`);
  }
  await mkdir(directory, { recursive: true });
  // Written under another name and moved, so a start interrupted here leaves
  // no half-written archive for the next one to verify and discard.
  const staging = `${path}.part`;
  await writeFile(staging, bytes);
  await rename(staging, path);
  return { bytes, fromCache: false };
}

export interface Archive {
  definitions: Definitions;
  testQsos: string;
  fromCache: boolean;
}

export async function openArchive(
  release: Release,
  directory: string,
  fetchArchive: FetchArchive
): Promise<Archive> {
  const { bytes, fromCache } = await obtain(release, directory, fetchArchive);
  const definitions = definitionsOf(JSON.parse(read(bytes, release.source.definitions).toString('utf8')));
  if (definitions.Version !== release.version) {
    throw new Error(`the archive holds ADIF ${definitions.Version}; the register pins ${release.version}`);
  }
  if (definitions.Status !== 'Released') {
    throw new Error(`the archive holds ADIF ${definitions.Version} at status "${definitions.Status}", not Released`);
  }
  return {
    definitions,
    testQsos: read(bytes, release.source.testQsos).toString('utf8'),
    fromCache
  };
}

// ---------------------------------------------------------------------------
// The conditional fetch POTA's lists use (QGD-REF-0010).
//
// A type and nothing else. The implementation is the credential core's: this
// process does not open connections (D-18, D-31).

export interface Conditional {
  etag?: string | null;
  lastModified?: string | null;
}

export type Fetched =
  | { status: 'fresh'; body: string; etag: string | null; lastModified: string | null }
  | { status: 'unchanged' };

export type FetchText = (url: string, conditional: Conditional) => Promise<Fetched>;
