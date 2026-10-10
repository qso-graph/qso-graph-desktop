// SPDX-License-Identifier: GPL-3.0-only
// The reference build, on a worker thread inside QG Storage (QGD-ENG-0015).
//
// node:sqlite is synchronous, and a build fills about 100,000 rows. On the
// storage process's own thread that would hold every other request until it
// finished. Here it does not. The worker writes only the new file it is given;
// the swap is done by the caller, after it has closed its handle on the old one.
import { parentPort, workerData } from 'node:worker_threads';
import { reduce } from './errors.js';
import { buildReference, type BuildInputs } from './reference-build.js';

const { target, ddl, inputs } = workerData as { target: string; ddl: string; inputs: BuildInputs };

buildReference(target, ddl, inputs).then(
  (summary) => parentPort?.postMessage({ ok: true, summary }),
  (error: unknown) => parentPort?.postMessage({ ok: false, failure: reduce(error, 'build') })
);
