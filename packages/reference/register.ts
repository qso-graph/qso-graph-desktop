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

export interface Register {
  adif: {
    version: string;
    source: { what: string; url: string; sha256: string; published: string; definitions: string; testQsos: string };
  };
  pota: PotaRegister;
  lists: {
    id: string; what: string; authority: string; copy: string;
    source: string | null; supplied: boolean; derived: boolean; holds?: string;
  }[];
}
