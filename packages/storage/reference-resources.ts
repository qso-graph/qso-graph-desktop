// SPDX-License-Identifier: GPL-3.0-only
// What Settings is told about each reference resource (QGD-REF-0017): pure, so
// the words and the "out of date" rule run under unit tests.
//
// A resource is the data a person cares about, listed in the register; it is
// made of one or more sources. ADIF definitions are one archive; POTA parks are
// three lists that always move together; SOTA summits are one list; POTA
// activations are one list for each location of My Area.
import type { Register } from '../reference/register.js';
import { ADIF_SOURCE, POTA_SOURCE_IDS, SOTA_SOURCE_IDS, activationsSourceId } from './reference-build.js';
import { POTA_LISTS, SOTA_LISTS } from './reference-cache.js';
import { isReferenceResource, type DatasetState, type ReferenceResource, type ReferenceStatus, type RefreshOutcome } from './reference.js';
import type { ResourceSummary } from './storage-contract.js';

// The sources of a resource. Activations' are the locations the file holds.
export function sourcesOf(resource: ReferenceResource, held?: ReferenceStatus): string[] {
  if (resource === 'adif') return [ADIF_SOURCE];
  if (resource === 'activations') return Object.keys(held?.activations ?? {}).map(activationsSourceId);
  if (resource === 'sota') return SOTA_LISTS.map((list) => SOTA_SOURCE_IDS[list]);
  return POTA_LISTS.map((list) => POTA_SOURCE_IDS[list]);
}

function datasetsOf(resource: ReferenceResource, held: ReferenceStatus): DatasetState[] {
  if (resource === 'adif') return [held.adif];
  if (resource === 'sota') return SOTA_LISTS.map((list) => held.sota[list]);
  if (resource === 'activations') {
    const sets = Object.values(held.activations);
    return sets.length > 0 ? sets : [{ state: 'not loaded' }];
  }
  return POTA_LISTS.map((list) => held.pota[list]);
}

// How long a resource's lists stay current: ADIF goes by release, not age.
function refreshAfter(register: Register, resource: ReferenceResource): number {
  return (resource === 'sota' ? register.sota.refreshAfterHours
    : resource === 'activations' ? register.activations.refreshAfterHours : register.pota.refreshAfterHours) * 3_600_000;
}

// In words a person can act on, or undefined when the last attempt worked.
// Never a message, a path or a value (QGD-ENG-0016).
export function problemOf(resource: ReferenceResource, outcome: RefreshOutcome): string | undefined {
  if (resource === 'activations' && outcome.noArea) {
    return 'Choose your Focus Area first, on the Settings tab of Parks On the Air: activations are downloaded for it alone.';
  }
  const inputs = resource === 'adif' ? [outcome.adif]
    : resource === 'sota' ? SOTA_LISTS.map((list) => outcome.sota[list])
      : resource === 'activations' ? Object.values(outcome.activations)
        : POTA_LISTS.map((list) => outcome.pota[list]);
  const kept = inputs.filter((input) => input.state === 'kept');
  if (outcome.deferred) {
    if (resource === 'sota' || resource === 'activations') return 'Could not be added: other reference data it would be built with is missing. Download it again, then this.';
    return resource === 'adif'
      ? 'Could not be added: the POTA parks it would be built with are missing. Download POTA parks, then this.'
      : 'Could not be added: the ADIF definitions it would be built with are missing. Download ADIF definitions, then this.';
  }
  if (outcome.buildFailure) return 'Could not be built. What was loaded before is kept.';
  if (kept.length > 0) return 'Could not be reached. What was loaded before is kept; try again later.';
  return undefined;
}

export interface SummaryInputs {
  register: Register;
  held: ReferenceStatus;
  // When each source last answered (Reference.lastChecks).
  checks: Readonly<Record<string, string | undefined>>;
  // The last attempt's problem per resource, if it had one.
  problems: ReadonlyMap<string, string>;
  updating: string | undefined;
  now: number;
}

export function summarize(inputs: SummaryInputs): ResourceSummary[] {
  const { register, held, checks, problems, updating, now } = inputs;
  return register.resources.filter((entry) => isReferenceResource(entry.id)).map((entry) => {
    const id = entry.id as ReferenceResource;
    const sets = datasetsOf(id, held);
    const loaded = sets.every((set) => set.state === 'loaded');
    const fetched = sets.flatMap((set) => (set.state === 'loaded' ? [Date.parse(set.fetchedAt)] : [])).filter(Number.isFinite);
    // The last time every source of it answered: the oldest of the newest of
    // each source's check and its body's fetch.
    const sources = sourcesOf(id, held);
    const answered = sources.map((source, at) => {
      const set = sets[at] ?? sets[0];
      const check = checks[source] ? Date.parse(checks[source]!) : NaN;
      const fetch = set?.state === 'loaded' ? Date.parse(set.fetchedAt) : NaN;
      return Math.max(Number.isFinite(check) ? check : -Infinity, Number.isFinite(fetch) ? fetch : -Infinity);
    });
    const current = loaded && answered.every(Number.isFinite) ? Math.min(...answered) : undefined;
    const stale = id === 'adif'
      ? held.adif.state === 'loaded' && held.adif.version !== register.adif.version
      : current === undefined || now - current >= refreshAfter(register, id);
    const problem = problems.get(id);
    // ADIF's definitions change only with a new ADIF release, which reaches the
    // app when a release pins it, so Update is offered only then; an Update of
    // the pinned version would fetch nothing new (KI7MT, 2026-10-12, #37).
    // POTA's and SOTA's lists change daily, so they are worth an Update once
    // their day is up or the last attempt failed, and not before: their
    // sources are asked once a day at most (#79). Activations always, since
    // their Update also fetches a location newly in My Area, while one
    // fetched today is not asked again (QGD-REF-0019).
    const version = id === 'adif' && held.adif.state === 'loaded' ? held.adif.version : undefined;
    return {
      id, name: entry.name, what: entry.what, owner: entry.owner, size: entry.size,
      state: loaded ? 'loaded' as const : 'not loaded' as const,
      ...(fetched.length > 0 ? { fetchedAt: new Date(current ?? Math.min(...fetched)).toISOString() } : {}),
      // A failed or deferred attempt leaves it worth trying again.
      due: loaded && (stale || problem !== undefined),
      updatable: loaded && (id === 'adif' ? stale : id === 'activations' || stale || problem !== undefined),
      ...(loaded && id !== 'adif' && id !== 'activations' && !stale && problem === undefined && current !== undefined
        ? { nextCheckAt: new Date(current + refreshAfter(register, id)).toISOString() } : {}),
      ...(version ? { version } : {}),
      ...(version && stale ? { available: register.adif.version } : {}),
      updating: updating === id,
      ...(problem ? { problem } : {})
    };
  });
}
