// SPDX-License-Identifier: GPL-3.0-only
// The shape of data/reference-sources.json: which reference data the core
// fetches, from where, and who owns each list (QGD-REF-0002, QGD-REF-0003,
// QGD-REF-0009, QGD-REF-0010). The register ships with the product; what it
// points at is fetched.

export interface PotaSource {
  url: string;
  what: string;
  format: 'csv' | 'json';
  columns: string[];
  conditional: string;
}

export interface PotaRegister {
  what: string;
  refreshAfterHours: number;
  sources: { parks: PotaSource; programs: PotaSource; locations: PotaSource };
}

// SOTA's one list, shaped as POTA's are (QGD-REF-0018).
export interface SotaRegister {
  what: string;
  refreshAfterHours: number;
  sources: { summits: PotaSource };
}

// POTA's activations, one list per part of My Area (QGD-REF-0019): a
// location, an entity or a program, each with its own URL holding `{code}`,
// filled with that part as area-entry.ts writes it and nothing else.
export interface ActivationsRegister {
  what: string;
  refreshAfterHours: number;
  source: Omit<PotaSource, 'url'> & { urls: { location: string; entity: string; program: string } };
}

// What the operator loads and updates, one control each. `id` names the
// resource in a command and a status; the core knows how to load each id it
// lists in REFERENCE_RESOURCES (packages/storage/reference.ts).
export interface ResourceEntry {
  id: string;
  name: string;
  what: string;
  // As it reads after "From" in Settings: "the ADIF Development Group",
  // "Parks on the Air".
  owner: string;
  size: string;
}

export interface Register {
  resources: ResourceEntry[];
  adif: {
    version: string;
    source: { what: string; url: string; sha256: string; published: string; definitions: string; testQsos: string };
  };
  pota: PotaRegister;
  sota: SotaRegister;
  activations: ActivationsRegister;
  lists: {
    id: string; what: string; authority: string; copy: string;
    source: string | null; supplied: boolean; derived: boolean; holds?: string;
  }[];
}
