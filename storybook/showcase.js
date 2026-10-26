// SPDX-License-Identifier: GPL-3.0-only
// A real station for the gallery, when there is one (KI7MT, 2026-10-24).
//
// A backup file (Settings → Back up and restore) saved as showcase.local.json
// at the root of the checkout is read here; git ignores it, so it is never
// committed and a gallery built anywhere else falls back to each story's
// sample data. Development-only, like the rest of storybook/.
//
// import.meta.glob finds nothing, rather than failing, when the file is not
// there, which is why it is used for a single file.
const found = import.meta.glob('/showcase.local.json', { eager: true, import: 'default' });
const backup = Object.values(found)[0];

const looksLikeBackup = value =>
  value && typeof value === 'object' && value.format === 'qso-graph-desktop-backup' && Array.isArray(value.callsigns);

export const showcase = looksLikeBackup(backup) ? backup : undefined;

// The active callsign, as the Locations page names it: "KI7MT · Current US Callsign".
export function showcaseCallsign() {
  if (!showcase) return undefined;
  const active = showcase.callsigns.find(entry => entry.id === showcase.active) ?? showcase.callsigns[0];
  if (!active) return undefined;
  return { id: active.id, label: active.description ? `${active.call} · ${active.description}` : active.call };
}

// The Locations as the page shows them.
export function showcaseStations() {
  const locations = showcase?.locations;
  if (!locations || !Array.isArray(locations.stations)) return undefined;
  return {
    list: locations.stations.map(({ id, name, kind, place, lotwPark }) => ({ id, name, kind, place, lotwPark })),
    defaults: locations.defaults ?? {},
    active: locations.active ?? null,
    checked: true
  };
}

// A restore's preview of this backup, as Back up and restore draws one.
export function showcasePreview() {
  if (!showcase) return undefined;
  return {
    parts: ['callsigns'], created: showcase.created,
    callsigns: showcase.callsigns.length,
    arriving: showcase.callsigns.map(entry => (entry.description ? `${entry.call} · ${entry.description}` : entry.call)),
    here: [],
    locations: (showcase.locations?.stations ?? []).map(entry => entry.name),
    locationsHere: 0
  };
}
