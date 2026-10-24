// SPDX-License-Identifier: GPL-3.0-only
// Recorded responses in place of the network, for the suites only.
//
// Home's cards draw live data, so a screenshot of Home or a check of what a
// card says would change every run and fail whenever NOAA was slow. A
// development run may name a directory of recorded responses
// (tests/fixtures/noaa/quiet); a source is then answered from the file named
// as its URL's last segment, and nothing is fetched. A packaged application
// never reads it, whatever the environment says, as with the extension
// directories (extension-directories.ts).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Only a plain file name: the URL comes from the source register, and is held
// to this anyway so no path can leave the directory.
const FILE = /^[a-z0-9][a-z0-9.-]{0,80}\.json$/;

export function sourceFixtures(packaged: boolean, directory: string | undefined) {
  if (packaged || !directory) return undefined;
  return async (url: string): Promise<{ body: string; fresh: boolean }> => {
    // POTA's spot list is …/spot/activator, with no extension: its recording
    // is activator.json, as every recording is a .json file.
    const last = new URL(url).pathname.split('/').pop() ?? '';
    const name = last.endsWith('.json') ? last : `${last}.json`;
    if (!FILE.test(name)) throw new Error('There is no recorded response for that source.');
    return { body: await readFile(join(directory, name), 'utf8'), fresh: true };
  };
}
