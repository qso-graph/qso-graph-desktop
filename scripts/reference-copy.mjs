// SPDX-License-Identifier: GPL-3.0-or-later
// QSO Graph's own copy of every file the build pins by SHA-256 (#213): ADIF's
// archive and the US county sources, on Cloudflare R2, each stored under its
// SHA-256. The fetch scripts ask it first and the file's own site second.
//
// A CI job whose sources cache missed used to go to adif.org.uk, a
// volunteer-run site, and failed when a runner could not reach it; every job
// at once asked it for the same file. The copy is trusted no more than the
// site: what it returns is checked against the same pin, and a file that does
// not match is not used. fleet-ops' cf-qso-graph-net-reference.yml fills it
// from the pins, so a changed pin is copied before its CI runs.
import { createHash } from 'node:crypto';

export const REFERENCE_COPY = 'https://reference.qso-graph.net';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// The pinned file from the copy, or undefined when the copy cannot give it:
// out of reach, not there yet, or not the file pinned. One try, and short:
// the caller then goes to the file's own site, as it always did.
export async function fromCopy(pin, { what = pin, get = fetch } = {}) {
  if (!/^[0-9a-f]{64}$/.test(pin)) throw new Error(`${what}: ${JSON.stringify(pin)} is not a SHA-256`);
  try {
    const response = await get(`${REFERENCE_COPY}/${pin}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      console.log(`${what}: not on ${REFERENCE_COPY} (HTTP ${response.status}); asking its own site.`);
      return undefined;
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (sha256(body) !== pin) {
      console.log(`${what}: ${REFERENCE_COPY} gave a file that is not the one pinned; asking its own site.`);
      return undefined;
    }
    console.log(`${what}: from ${REFERENCE_COPY}, SHA-256 checked.`);
    return body;
  } catch (error) {
    console.log(`${what}: ${REFERENCE_COPY} could not be reached (${error.cause?.code ?? error.message}); asking its own site.`);
    return undefined;
  }
}
