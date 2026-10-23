// SPDX-License-Identifier: GPL-3.0-only
// The parks of My Area with how many times each has been activated
// (QGD-REF-0019), for an activator looking for one nobody has worked from.
// Read-only, from reference.sqlite, so it answers with no network at all.
import { and, eq, exists, inArray } from 'drizzle-orm';
import { ACTIVATION_PARKS, NEAR_PARKS, type ActivationPark, type NearPark } from './activation-entry.js';
import { potaActivation, potaPark, potaParkLocation, type referenceSchema } from './reference-schema.js';
import type { Store } from './sqlite.js';
export type { ActivationPark, NearPark } from './activation-entry.js';

// The parks in any of these locations that POTA lists as active, that are not
// its test park, and whose position can be measured from, with their counts.
// A park whose position POTA publishes wrong is left out, as it is from
// anything that measures (QGD-REF-0011).
// At most NEAR_PARKS of them: nearest `from` first when there is a place to
// measure from, otherwise the least activated first. A page is sent no more
// than it draws, and an extension's message is held to 1 MB (QGD-APP-0021),
// which the 12,000 parks of the lower 48 would pass.
export async function parksToActivate(reference: Store<typeof referenceSchema>, locations: readonly string[],
  from?: { latitude: number; longitude: number }): Promise<ActivationPark[]> {
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
  const parks = rows.flatMap((row) => row.latitude === null || row.longitude === null ? []
    : [{ ...row, latitude: row.latitude, longitude: row.longitude }]);
  if (from) return nearest(parks, from.latitude, from.longitude);
  return parks.sort((a, b) => (a.activations ?? 0) - (b.activations ?? 0) || a.reference.localeCompare(b.reference)).slice(0, NEAR_PARKS);
}

// The NEAR_PARKS nearest a place, nearest first, by the haversine's own
// term, which orders as the distance does.
function nearest<T extends { reference: string; latitude: number; longitude: number }>(parks: readonly T[], latitude: number, longitude: number): T[] {
  const radians = Math.PI / 180;
  const cosLat = Math.cos(latitude * radians);
  const far = (park: T) => Math.sin((park.latitude - latitude) * radians / 2) ** 2
    + cosLat * Math.cos(park.latitude * radians) * Math.sin((park.longitude - longitude) * radians / 2) ** 2;
  return parks.map(park => ({ park, d: far(park) })).sort((a, b) => a.d - b.d || a.park.reference.localeCompare(b.park.reference))
    .slice(0, NEAR_PARKS).map(entry => entry.park);
}

// The parks nearest a place, from POTA's park list alone, so Near Me works
// with no network and nothing downloaded beyond POTA's parks (KI7MT,
// 2026-10-23: "Near Me can't rely on internet"). Active, not POTA's test
// park, and with a position to measure from (QGD-REF-0011). Nearest first by
// great-circle distance, at most NEAR_PARKS.
export async function parksNear(reference: Store<typeof referenceSchema>, latitude: number, longitude: number): Promise<NearPark[]> {
  const rows = await reference.unit((db) => db.select({
    reference: potaPark.reference, name: potaPark.name, latitude: potaPark.latitude, longitude: potaPark.longitude, locations: potaPark.locationDesc
  }).from(potaPark).where(and(eq(potaPark.active, true), eq(potaPark.isTest, false), eq(potaPark.coordinatesUsable, true))).all());
  return nearest(rows.flatMap(row => (row.latitude === null || row.longitude === null ? []
    : [{ reference: row.reference, name: row.name, latitude: row.latitude, longitude: row.longitude, locations: row.locations }])), latitude, longitude);
}
