// SPDX-License-Identifier: GPL-3.0-only
// The parks of My Area with how many times each has been activated
// (QGD-REF-0019), for an activator looking for one nobody has worked from.
// Read-only, from reference.sqlite, so it answers with no network at all.
import { and, eq, exists, inArray } from 'drizzle-orm';
import { ACTIVATION_PARKS, type ActivationPark } from './activation-entry.js';
import { potaActivation, potaPark, potaParkLocation, type referenceSchema } from './reference-schema.js';
import type { Store } from './sqlite.js';
export type { ActivationPark } from './activation-entry.js';

// The parks in any of these locations that POTA lists as active, that are not
// its test park, and whose position can be measured from, with their counts.
// A park whose position POTA publishes wrong is left out, as it is from
// anything that measures (QGD-REF-0011).
export async function parksToActivate(reference: Store<typeof referenceSchema>, locations: readonly string[]): Promise<ActivationPark[]> {
  if (locations.length === 0) return [];
  const rows = await reference.unit((db) => db.select({
    reference: potaPark.reference, name: potaPark.name, latitude: potaPark.latitude, longitude: potaPark.longitude,
    locations: potaPark.locationDesc, activations: potaActivation.activations
  }).from(potaActivation)
    .innerJoin(potaPark, eq(potaPark.reference, potaActivation.reference))
    .where(and(
      eq(potaPark.active, true), eq(potaPark.isTest, false), eq(potaPark.coordinatesUsable, true),
      exists(db.select({ one: potaParkLocation.reference }).from(potaParkLocation).where(and(
        eq(potaParkLocation.reference, potaPark.reference), inArray(potaParkLocation.locationDesc, [...locations]))))
    ))
    .orderBy(potaPark.reference)
    .limit(ACTIVATION_PARKS)
    .all());
  return rows.flatMap((row) => row.latitude === null || row.longitude === null ? []
    : [{ ...row, latitude: row.latitude, longitude: row.longitude }]);
}
