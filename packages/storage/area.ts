// SPDX-License-Identifier: GPL-3.0-only
// My Area (KI7MT, 2026-10-23): POTA's programs, their entities and their
// locations the operator chooses from, the area a Location is in, and the
// locations an area covers, from POTA's own lists already downloaded
// (QGD-REF-0009). Read-only.
import { eq, inArray, like, or, sql } from 'drizzle-orm';
import { potaLocation, potaPark, potaProgram, type referenceSchema } from './reference-schema.js';
import type { Store } from './sqlite.js';
import { AREA_LOCATIONS, areaKind, type AreaEntity, type AreaProgram } from './area-entry.js';
export type { AreaEntity, AreaLocation, AreaProgram } from './area-entry.js';

// Every active program with its entities and their locations, by name, as
// POTA names them. A location belongs to the program its code begins with
// (US-ID to US) and to the entity POTA gives it (US-ID to 291).
export async function areaChoices(reference: Store<typeof referenceSchema>): Promise<AreaProgram[]> {
  return reference.unit(async (db) => {
    const programs = await db.select().from(potaProgram).where(eq(potaProgram.active, true)).all();
    const locations = await db.select({
      code: potaLocation.locationDesc, name: potaLocation.locationName, entity: potaLocation.entityId, entityName: potaLocation.entityName
    }).from(potaLocation).all();
    interface Held { name: string; locations: { code: string; name: string }[] }
    const byPrefix = new Map<string, Map<number, Held>>();
    for (const location of locations) {
      const prefix = location.code.split('-')[0] ?? '';
      // A location with no entity is not one an area can be built from.
      if (location.entity === null || !location.code.includes('-')) continue;
      const entities = byPrefix.get(prefix) ?? new Map<number, Held>();
      const entity: Held = entities.get(location.entity) ?? { name: location.entityName ?? String(location.entity), locations: [] };
      entity.locations.push({ code: location.code, name: location.name ?? location.code });
      entities.set(location.entity, entity);
      byPrefix.set(prefix, entities);
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return programs
      .map(program => ({
        prefix: program.prefix, name: program.name,
        entities: [...(byPrefix.get(program.prefix) ?? new Map<number, Held>()).entries()]
          .map(([id, entity]): AreaEntity => ({ id: String(id), name: entity.name, locations: entity.locations.sort(byName) }))
          .sort(byName)
      }))
      .filter(program => program.entities.length > 0)
      .sort(byName);
  });
}

// The area a Location is in, from its DXCC entity and its state, most
// precise first: the POTA location for the state (Idaho, DXCC 291 and ID, is
// US-ID; Bayern, 230 and BY, is DE-BY); else the entity itself, where POTA
// numbers it as ADIF does (Italy, whose ADIF subdivisions are provinces and
// POTA's regions, is 248); else the program whose parks carry the entity.
// Nothing is guessed from a position.
export async function areaDefault(reference: Store<typeof referenceSchema>, dxcc: string | undefined, state: string | undefined): Promise<string | undefined> {
  const entity = Number(dxcc);
  if (dxcc === undefined || !Number.isInteger(entity) || entity <= 0) return undefined;
  return reference.unit(async (db) => {
    if (state && /^[A-Z0-9]{1,8}$/.test(state)) {
      const location = await db.select({ code: potaLocation.locationDesc }).from(potaLocation)
        .where(sql`${potaLocation.entityId} = ${entity} AND substr(${potaLocation.locationDesc}, instr(${potaLocation.locationDesc}, '-') + 1) = ${state}`).get();
      if (location) return location.code;
    }
    const held = await db.select({ code: potaLocation.locationDesc }).from(potaLocation).where(eq(potaLocation.entityId, entity)).get();
    if (held) return String(entity);
    const program = await db.selectDistinct({ prefix: sql<string>`substr(${potaPark.reference}, 1, instr(${potaPark.reference}, '-') - 1)` })
      .from(potaPark).where(eq(potaPark.adifEntity, entity)).get();
    return program?.prefix || undefined;
  });
}

// The POTA locations an area covers: a location itself, an entity's
// locations, a program's locations. For what is filtered by location, as
// Parks On the Air's My area is.
export async function areaLocations(reference: Store<typeof referenceSchema>, entries: readonly string[]): Promise<string[]> {
  const locations = entries.filter(entry => areaKind(entry) === 'location');
  const entities = entries.filter(entry => areaKind(entry) === 'entity').map(Number);
  const programs = entries.filter(entry => areaKind(entry) === 'program');
  const found = new Set(locations);
  if (entities.length > 0 || programs.length > 0) {
    const rows = await reference.unit((db) => db.select({ code: potaLocation.locationDesc }).from(potaLocation).where(or(
      ...(entities.length > 0 ? [inArray(potaLocation.entityId, entities)] : []),
      // A prefix is held to AREA_PROGRAM, letters and digits, so it holds no
      // pattern character of its own.
      ...programs.map(prefix => like(potaLocation.locationDesc, `${prefix}-%`))
    )).all());
    for (const row of rows) found.add(row.code);
  }
  return [...found].sort().slice(0, AREA_LOCATIONS);
}
