// SPDX-License-Identifier: GPL-3.0-only
// My Area (KI7MT, 2026-10-23): the POTA programs and their locations the
// operator chooses from, and the location a Location is in, from POTA's own
// lists already downloaded (QGD-REF-0009). Read-only.
import { eq, sql } from 'drizzle-orm';
import { potaLocation, potaPark, potaProgram, type referenceSchema } from './reference-schema.js';
import type { Store } from './sqlite.js';
import type { AreaProgram } from './area-entry.js';
export type { AreaLocation, AreaProgram } from './area-entry.js';

// Every active program with the locations under it, by name, as POTA names
// them. A location belongs to the program its code begins with: US-ID to US.
export async function areaChoices(reference: Store<typeof referenceSchema>): Promise<AreaProgram[]> {
  return reference.unit(async (db) => {
    const programs = await db.select().from(potaProgram).where(eq(potaProgram.active, true)).all();
    const locations = await db.select({ code: potaLocation.locationDesc, name: potaLocation.locationName }).from(potaLocation).all();
    const byPrefix = new Map<string, { code: string; name: string }[]>();
    for (const location of locations) {
      const prefix = location.code.split('-')[0] ?? '';
      const list = byPrefix.get(prefix) ?? [];
      list.push({ code: location.code, name: location.name ?? location.code });
      byPrefix.set(prefix, list);
    }
    return programs
      .map(program => ({
        prefix: program.prefix, name: program.name,
        locations: (byPrefix.get(program.prefix) ?? []).sort((a, b) => a.name.localeCompare(b.name))
      }))
      .filter(program => program.locations.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

// The POTA location a Location is in, from its DXCC entity and its state:
// the program whose parks carry that entity, then that program's location
// for the state, if POTA has one. Idaho (DXCC 291, ID) is US-ID.
export async function areaDefault(reference: Store<typeof referenceSchema>, dxcc: string | undefined, state: string | undefined): Promise<string | undefined> {
  const entity = Number(dxcc);
  if (!Number.isInteger(entity) || !state || !/^[A-Z0-9]{1,8}$/.test(state)) return undefined;
  return reference.unit(async (db) => {
    const prefixes = await db.selectDistinct({ prefix: sql<string>`substr(${potaPark.reference}, 1, instr(${potaPark.reference}, '-') - 1)` })
      .from(potaPark).where(eq(potaPark.adifEntity, entity)).all();
    for (const { prefix } of prefixes) {
      const code = `${prefix}-${state}`;
      const found = await db.select({ code: potaLocation.locationDesc }).from(potaLocation).where(eq(potaLocation.locationDesc, code)).get();
      if (found) return code;
    }
    return undefined;
  });
}
