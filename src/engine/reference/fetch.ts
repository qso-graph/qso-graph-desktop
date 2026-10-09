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

// Injected so a suite can hand over bytes it already has. The default is the
// platform's fetch, over HTTPS only.
export type FetchArchive = (url: string) => Promise<Buffer>;

export async function download(url: string): Promise<Buffer> {
  if (!url.startsWith('https://')) throw new Error('reference data is fetched over HTTPS only');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

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
  fetchArchive: FetchArchive = download
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
  fetchArchive: FetchArchive = download
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
