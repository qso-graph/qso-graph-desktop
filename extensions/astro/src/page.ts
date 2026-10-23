// SPDX-License-Identifier: GPL-3.0-only
// Astro's page (QGD-AST-*): the sun, the moon and the grey line at the
// active Location, as the core's page shapes. Pure: a position, a moment and
// what the operator typed in, a page answer out. Nothing here fetches, and
// nothing here rates or forecasts (QGD-AST-0050).
import type { PageAnswer, Section, TableGroup } from '../../../packages/extension-api/pages.js';
import type { StationBrief } from '../../../packages/extension-api/api-contract.js';
import { greyLine, gridCentre } from './greyline.js';
import { moonAt, moonCrossings, moonPhase, sublunar } from './moon.js';
import {
  ASTRONOMICAL, CIVIL, D_LAYER, F2_LAYER, HORIZON, NAUTICAL, julian, solarNoon, sunAltitude, sunAt, sunCrossings, type Crossings
} from './sun.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

// To the minute, which is the accuracy claimed (QGD-AST-0006), with the day,
// since an evening's events in UTC are often tomorrow's date.
export function utcText(at: Date): string {
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())}`;
}

// The operator's own clock, where it differs from UTC (QGD-AST-0010): many
// keep the computer on UTC, and a third column the same as UTC is noise.
export interface Clock {
  // Minutes east of UTC at a moment, as Date's offset reversed.
  offset(at: Date): number;
  text(at: Date): string;
}

export const localClock: Clock = {
  offset: at => -at.getTimezoneOffset(),
  text: at => `${at.getDate()} ${MONTHS[at.getMonth()]} ${two(at.getHours())}:${two(at.getMinutes())}`
};

interface Inputs { readonly dx?: string }

// A row's times, or a sentence where there is no event (QGD-AST-0007).
type Row = [label: string, at: Date | string];

// A group of the one table. A time is given on each clock; a sentence or a
// span has no clock, so it is given once, across both (page data version 5).
function group(heading: string, rows: Row[], clock: Clock | undefined): TableGroup {
  return {
    heading,
    rows: rows.map(([label, at]) => typeof at === 'string'
      ? [label, at]
      : (clock ? [label, utcText(at), clock.text(at)] : [label, utcText(at)]))
  };
}

// The morning's and the evening's crossing, each or the reason it is absent.
function pair(found: Crossings, morning: string, evening: string, neverUp: string, neverDown: string): Row[] {
  const absent = found.allDay === 'above' ? neverDown : found.allDay === 'below' ? neverUp : 'None today';
  return [[morning, found.rising ?? absent], [evening, found.setting ?? absent]];
}

function signed(degrees: number): string {
  const value = Math.abs(degrees).toFixed(1);
  return value === '0.0' ? '0.0°' : `${degrees > 0 ? '+' : '−'}${value}°`;
}

// Where the sun is overhead at a moment: its declination north or south, and
// the longitude where it is solar noon, from the equation of time.
export function subsolar(now: Date): { latitude: number; longitude: number } {
  const sun = sunAt(julian(now.getTime()));
  const minutesUtc = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
  const longitude = (((720 - minutesUtc - sun.equationOfTime) / 4 + 540) % 360) - 180;
  return { latitude: sun.declination, longitude };
}

function duration(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${two(Math.round(minutes % 60))} min`;
}

export function astroPage(station: StationBrief | null, now: Date, inputs: Inputs = {}, clock: Clock = localClock): PageAnswer {
  const observedAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  // What it needs, named, rather than a guess from the computer (QGD-AST-0008).
  const position = station && station.latitude !== undefined && station.longitude !== undefined
    ? { latitude: station.latitude, longitude: station.longitude } : undefined;
  if (!position) {
    const text = station
      ? `${station.name} has no grid or coordinates. Add one in Locations, and Astro works out the sun and the moon there.`
      : 'Astro needs a Location. Make one active in Locations, with its grid, and Astro works out the sun and the moon there.';
    return { ok: true, data: { version: 6, observedAt, sections: [{ shape: 'alert', level: 'info', text }] } };
  }
  const { latitude, longitude } = position;
  const yourClock = clock.offset(now) !== 0 ? clock : undefined;
  const sun = sunCrossings(now, latitude, longitude, HORIZON);
  const noon = solarNoon(now, latitude, longitude);
  const moon = moonCrossings(now, latitude, longitude);
  const at = julian(now.getTime());
  const phase = moonPhase(at);
  const moonNow = moonAt(at);
  const dayLength = sun.rising && sun.setting && sun.setting > sun.rising
    ? duration((sun.setting.getTime() - sun.rising.getTime()) / 60_000)
    : sun.allDay === 'above' ? '24 h: the sun does not set' : sun.allDay === 'below' ? 'None: the sun does not rise' : 'Not one span today';

  // Sunrise, solar noon, sunset, then the length of the day.
  const [sunrise, sunset] = pair(sun, 'Sunrise', 'Sunset', 'None: the sun does not rise today', 'None: the sun does not set today');
  const sunRows: Row[] = [sunrise, ['Solar noon', noon], sunset, ['Length of day', dayLength]];

  // The DX question (QGD-AST-0041): when both ends are inside the same depth.
  // Drawn under the figures, just below the field it answers, not after the
  // day's whole table (KI7MT, 2026-10-22).
  const dx = inputs.dx ? gridCentre(inputs.dx) : undefined;
  const greyLineSection: Section[] = [];
  if (inputs.dx && dx) {
    const heading = `Grey line with ${inputs.dx}, the next 24 hours`.slice(0, 60);
    const found = greyLine(now, position, dx);
    const rows: [string, string][] = [];
    for (const { depth, windows } of found) {
      const name = depth === D_LAYER ? 'D and E layers (−10.1°)' : 'F2 layer (−17.2°)';
      if (windows.length === 0) rows.push([name, 'No window']);
      for (const window of windows) rows.push([name, `${utcText(window.start)} to ${utcText(window.end).split(' ').pop()}`]);
    }
    // Neither depth shared: said once, in words, rather than as a table of
    // two empty rows that reads as if nothing happened.
    greyLineSection.push(found.every(({ windows }) => windows.length === 0)
      ? { shape: 'alert', level: 'info', heading, contents: false,
          text: `${station!.name.slice(0, 40)} and ${inputs.dx} are not in twilight at the same time in the next 24 hours.` }
      : { shape: 'table', heading, contents: false, columns: ['Depth both ends are within', 'UTC'], rows });
  }

  // The grey line on the map (KI7MT, 2026-10-22): the night greyed out, the
  // twilight to the D and E layers' depth lighter, which is the band the
  // windows below are worked out for, the moon where it is overhead, the
  // Location marked, and the DX grid when there is one.
  const map: Section = { shape: 'map', heading: 'Grey line now', contents: false, sun: subsolar(now), moon: sublunar(at), twilight: D_LAYER, marks: [
    { label: station!.name.slice(0, 40), latitude, longitude },
    ...(inputs.dx && dx ? [{ label: inputs.dx, latitude: dx.latitude, longitude: dx.longitude }] : [])
  ] };

  const sections: Section[] = [
    { shape: 'figures', figures: [
      { label: 'Location', value: station!.name.slice(0, 32) },
      ...(station!.grid ? [{ label: 'Grid', value: station!.grid }] : []),
      // Signed, so up and down read at a glance: +23.9° above the horizon,
      // −5.2° below it, as the radio depths are written (KI7MT, 2026-10-22).
      { label: 'Sun now', value: signed(sunAltitude(at, latitude, longitude)) },
      { label: 'Moon', value: `${Math.round(phase.fraction * 100)}%` }
    ] },
    map,
    // The DX field here, under the map, with its answer just below it
    // (KI7MT, 2026-10-23: above the map, it seemed to do nothing).
    { shape: 'fields', heading: 'Grey line DX check' },
    ...greyLineSection,
    { shape: 'alert', level: 'info', text: yourClock
      ? 'Times are in UTC and on this computer\'s clock. The Location\'s own time zone is not known yet.'
      : 'Times are in UTC, which is what this computer\'s clock is set to. The Location\'s own time zone is not known yet.' },
    // One table in four groups, so the times line up all the way down the
    // page rather than moving with each group's longest name (Watson and
    // KI7MT, 2026-10-22).
    { shape: 'table', columns: yourClock ? ['Event', 'UTC', 'Your clock'] : ['Event', 'UTC'], groups: [
    group('Sun', sunRows, yourClock),
    group('Twilight', [
      ...pair(sunCrossings(now, latitude, longitude, CIVIL), 'Civil dawn (−6°)', 'Civil dusk (−6°)', 'Not today: the sun stays lower', 'Not today: the sun stays higher'),
      ...pair(sunCrossings(now, latitude, longitude, NAUTICAL), 'Nautical dawn (−12°)', 'Nautical dusk (−12°)', 'Not today: the sun stays lower', 'Not today: the sun stays higher'),
      ...pair(sunCrossings(now, latitude, longitude, ASTRONOMICAL), 'Astronomical dawn (−18°)', 'Astronomical dusk (−18°)', 'Not today: the sun stays lower', 'Not today: the sun stays higher')
    ], yourClock),
    group('Moon', [
      ...pair(moon, 'Moonrise', 'Moonset', 'None today: the moon does not rise', 'None today: the moon does not set'),
      ['Phase', `${phase.name}, ${Math.round(phase.fraction * 100)}% lit`],
      // The numbers EME turns on (QGD-AST-0031).
      ['Declination', `${moonNow.declination >= 0 ? '+' : '−'}${Math.abs(moonNow.declination).toFixed(1)}°`],
      ['Distance', `${Math.round(moonNow.distance).toLocaleString('en-US')} km`]
    ], yourClock),
    // What each depth means for radio, said beside it (QGD-AST-0022). Last:
    // the most specialised, after what everyone reads (KI7MT, 2026-10-23).
    group('Radio depths', [
      ...pair(sunCrossings(now, latitude, longitude, D_LAYER), 'Dawn: the absorbing D and E layers sunlit again (−10.1°)', 'Dusk: the absorbing D and E layers dark (−10.1°)', 'Not today: the sun stays lower', 'Not today: the sun stays higher'),
      ...pair(sunCrossings(now, latitude, longitude, F2_LAYER), 'Dawn: the reflecting F2 layer sunlit again (−17.2°)', 'Dusk: the reflecting F2 layer dark (−17.2°)', 'Not today: the sun stays lower', 'Not today: the sun stays higher')
    ], yourClock)
    ] }
  ];

  return { ok: true, data: { version: 6, observedAt, sections } };
}

