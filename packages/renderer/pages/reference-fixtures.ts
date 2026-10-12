// SPDX-License-Identifier: GPL-3.0-only
// The register's two resources as stories show them (data/reference-sources.json).
import type { ResourceSummary } from '../../storage/storage-contract.js';

const ADIF = { id: 'adif', name: 'ADIF definitions', what: "ADIF's fields, data types and enumerations, which QSO records are checked against", owner: 'the ADIF Development Group', size: 'about 2 MB' };
const POTA = { id: 'pota', name: 'POTA parks', what: 'Every Parks on the Air park, program and location, for park references and lookups', owner: 'Parks on the Air', size: 'about 10 MB' };

export const RESOURCES_LOADED: ResourceSummary[] = [
  { ...ADIF, state: 'loaded', fetchedAt: '2026-10-11T18:00:00Z', due: false, updating: false },
  { ...POTA, state: 'loaded', fetchedAt: '2026-10-11T18:00:00Z', due: false, updating: false }
];

export const RESOURCES_NOT_LOADED: ResourceSummary[] = [
  { ...ADIF, state: 'not loaded', due: false, updating: false },
  { ...POTA, state: 'not loaded', due: false, updating: false }
];
