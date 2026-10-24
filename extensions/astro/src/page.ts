// SPDX-License-Identifier: GPL-3.0-only
// Astro's page (QGD-AST-*): the sun, the moon and the grey line at the
// active Location, as the core's page shapes. Pure: a position, a moment and
// what the operator typed in, a page answer out. Nothing here fetches, and
// nothing here rates or forecasts (QGD-AST-0050).
import type { PageAnswer, Section } from '../../../packages/extension-api/pages.js';
import type { StationBrief } from '../../../packages/extension-api/api-contract.js';
import { greyLine, gridCentre } from './greyline.js';
import { moonAt, moonCrossingsOver, moonPhase, sublunar } from './moon.js';
import {
  ASTRONOMICAL, CIVIL, D_LAYER, F2_LAYER, HORIZON, NAUTICAL, highestOver, julian, sunAltitude, sunAt, sunCrossings, sunCrossingsOver, type Crossings
} from './sun.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

// The operator's own clock, where it differs from UTC (QGD-AST-0010): many
// keep the computer on UTC, and a third column the same as UTC is noise.
export interface Clock {
  // Minutes east of UTC at a moment, as Date's offset reversed.
  offset(at: Date): number;
  text(at: Date): string;
  // The time alone, and the date alone with its year, on this clock.
  time(at: Date): string;
  date(at: Date): string;
  // The zone the system clock is set to, as the system names it
  // (America/Denver), and its short name at a moment (MDT, MST, or an
  // offset where the zone has no common short name).
  zone(at: Date): { readonly name: string; readonly short: string };
}

export const localClock: Clock = {
  offset: at => -at.getTimezoneOffset(),
  text: at => `${at.getDate()} ${MONTHS[at.getMonth()]} ${two(at.getHours())}:${two(at.getMinutes())}`,
  time: at => `${two(at.getHours())}:${two(at.getMinutes())}`,
  date: at => `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`,
  zone: at => ({
    name: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    short: new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(at).find(part => part.type === 'timeZoneName')?.value ?? ''
  })
};

// What the page says about its times: the zone the system clock is set to,
// so "sunrise was two hours off" answers itself (KI7MT, 2026-10-23).
export function clockNote(clock: Clock, at: Date): string {
  const { name, short } = clock.zone(at);
  if (name === 'UTC' || name === 'Etc/UTC') return 'Active Location almanac times are based on system clock setting: UTC.';
  const minutes = clock.offset(at);
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const offset = `UTC${minutes < 0 ? '−' : '+'}${hours}${rest ? `:${two(rest)}` : ''}`;
  const plainShort = short.replace(/[<>]/g, '').slice(0, 12);
  const said = plainShort && plainShort !== offset && !plainShort.startsWith('GMT') ? `${plainShort}, ${offset}` : offset;
  return `Active Location almanac times are based on system clock setting: ${name.replace(/[<>]/g, '').slice(0, 60)} (${said}).`;
}

// The days the almanac is in: today and the four after it, each a day on
// this computer's clock, from its midnight to the next, so every event is on
// the row of its own date on that clock and the table starts on the clock's
// today (Codex review, 2026-10-23: a day was the Location's solar day, so on
// a UTC clock Boise's 00:50 sunset sat under the day before, and just after
// local midnight the table still began yesterday). A day with a change of
// summer time is 23 or 25 hours long.
export const SUN_DAYS = 5;
const DAY = 86_400_000;
export interface ClockDay { readonly start: number; readonly minutes: number; readonly noon: Date }
export function clockDays(now: Date, clock: Clock, count = SUN_DAYS): ClockDay[] {
  const midnight = (at: number) => {
    // The offset in force at that midnight decides it, not the one now nor
    // the one at midday (#57, found by Turing: on the day summer time began
    // or ended, the day started an hour out). Taken again at each candidate
    // midnight until it holds; twice is enough, a third pass is a guard.
    let offset = clock.offset(new Date(at)) * 60_000;
    let start = Math.floor((at + offset) / DAY) * DAY - offset;
    for (let pass = 0; pass < 3; pass += 1) {
      const there = clock.offset(new Date(start)) * 60_000;
      if (there === offset) break;
      offset = there;
      start = Math.floor((at + offset) / DAY) * DAY - offset;
    }
    return start;
  };
  const days: ClockDay[] = [];
  let start = midnight(now.getTime());
  for (let day = 0; day < count; day += 1) {
    const next = midnight(start + DAY + DAY / 2);
    days.push({ start, minutes: Math.round((next - start) / 60_000), noon: new Date(start + DAY / 2) });
    start = next;
  }
  return days;
}

// The sun for those days: Date, Sunrise, Solar noon, Sunset, and the length
// of the daylight around that day's solar noon, on this computer's clock,
// which is the operator's to set: local in Idaho, UTC in a shack kept on UTC
// (KI7MT, 2026-10-23: a sunrise in UTC means nothing in Idaho).
export function sunWeek(now: Date, latitude: number, longitude: number, clock: Clock): string[][] {
  return clockDays(now, clock).map(({ start, minutes, noon: middle }) => {
    const found = sunCrossingsOver(start, minutes, latitude, longitude, HORIZON);
    const noon = highestOver(start, minutes, latitude, longitude);
    // The day's length is its daylight, the span that holds its solar noon,
    // whichever clock days its rise and set fall on.
    const span = sunCrossings(noon, latitude, longitude, HORIZON);
    const length = span.rising && span.setting && span.setting > span.rising
      ? duration((span.setting.getTime() - span.rising.getTime()) / 60_000)
      : span.allDay === 'above' ? '24 h: the sun does not set' : span.allDay === 'below' ? 'None: the sun does not rise' : 'Not one span';
    return [
      clock.date(middle),
      found.rising ? clock.time(found.rising) : '—',
      clock.time(noon),
      found.setting ? clock.time(found.setting) : '—',
      length
    ];
  });
}

// A crossing on this clock, or a dash where the day has none.
const timeOr = (clock: Clock, at: Date | undefined) => (at ? clock.time(at) : '—');

// Twilight for the same five days: each depth's dawn and dusk, on this
// computer's clock (KI7MT, 2026-10-23). A depth the sun does not reach that
// day, or does not leave, is a dash.
export function twilightWeek(now: Date, latitude: number, longitude: number, clock: Clock): string[][] {
  return clockDays(now, clock).map(({ start, minutes, noon }) => {
    const row = [clock.date(noon)];
    for (const depth of [CIVIL, NAUTICAL, ASTRONOMICAL]) {
      const found: Crossings = sunCrossingsOver(start, minutes, latitude, longitude, depth);
      row.push(timeOr(clock, found.rising), timeOr(clock, found.setting));
    }
    return row;
  });
}

// The moon for the same five days, on this computer's clock: rise and set,
// and at the day's midday on this clock its phase, how much is lit, and the
// declination and distance EME turns on (QGD-AST-0031). The moon's day is
// about 24 h 50 min, so roughly once a month a day has no rise or no set:
// a dash, not a failure (QGD-AST-0007).
export function moonWeek(now: Date, latitude: number, longitude: number, clock: Clock): string[][] {
  return clockDays(now, clock).map(({ start, minutes, noon }) => {
    const found = moonCrossingsOver(start, minutes, latitude, longitude);
    const jd = julian(noon.getTime());
    const phase = moonPhase(jd);
    const position = moonAt(jd);
    // The date and the phase first, then the rest (KI7MT, 2026-10-23).
    return [
      clock.date(noon),
      phase.name,
      timeOr(clock, found.rising),
      timeOr(clock, found.setting),
      `${Math.round(phase.fraction * 100)}%`,
      `${position.declination >= 0 ? '+' : '−'}${Math.abs(position.declination).toFixed(1)}°`,
      `${Math.round(position.distance).toLocaleString('en-US')} km`
    ];
  });
}

interface Inputs { readonly dx?: string }

// A row's times, or a sentence where there is no event (QGD-AST-0007).
type Row = [label: string, at: Date | string];

// A group of the one table. A time is given on each clock; a sentence or a
// span has no clock, so it is given once, across both (page data version 5).
// The radio depths' rows: each event's date and time on this computer's
// clock, which is the Location's rule (KI7MT, 2026-10-23: logs are UTC,
// Locations are local). A sentence where there is no event, once, across.
function radioRows(rows: Row[], clock: Clock): string[][] {
  return rows.map(([label, at]) => (typeof at === 'string' ? [label, at] : [label, clock.date(at), clock.time(at)]));
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
  const at = julian(now.getTime());
  const phase = moonPhase(at);
  // The DX question (QGD-AST-0041): when both ends are inside the same depth.
  // Drawn under the figures, just below the field it answers, not after the
  // day's whole table (KI7MT, 2026-10-22).
  const dx = inputs.dx ? gridCentre(inputs.dx) : undefined;
  const greyLineSection: Section[] = [];
  if (inputs.dx && dx) {
    const heading = `Grey line with ${inputs.dx}, the next 24 hours`.slice(0, 60);
    const found = greyLine(now, position, dx);
    // The depth, the date, and the start and end in UTC, each its own
    // column (KI7MT, 2026-10-23). An end on the next day carries its date;
    // a depth with no window says so once, across the columns.
    const rows: string[][] = [];
    const dateOf = (at: Date) => `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
    const timeOf = (at: Date) => `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}`;
    for (const { depth, windows } of found) {
      const name = depth === D_LAYER ? 'D and E layers (−10.1°)' : 'F2 layer (−17.2°)';
      if (windows.length === 0) rows.push([name, 'No window']);
      for (const window of windows) {
        const end = dateOf(window.end) === dateOf(window.start) ? timeOf(window.end) : `${dateOf(window.end)} ${timeOf(window.end)}`;
        rows.push([name, dateOf(window.start), timeOf(window.start), end]);
      }
    }
    // Neither depth shared: said once, in words, rather than as a table of
    // two empty rows that reads as if nothing happened.
    greyLineSection.push(found.every(({ windows }) => windows.length === 0)
      ? { shape: 'alert', level: 'info', heading, contents: false,
          text: `${station!.name.slice(0, 40)} and ${inputs.dx} are not in twilight at the same time in the next 24 hours.` }
      : { shape: 'table', heading, contents: false, columns: ['Both ends within', 'Date (UTC)', 'Start', 'End'], rows });
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
    // The day's times under a heading of their own, set apart from the grey
    // line above (KI7MT, 2026-10-23). Not in the contents line, which lists
    // Sun, Twilight, Moon and Radio depths below it.
    { shape: 'text', heading: `Almanac for ${station!.name}`.slice(0, 60), contents: false, text: clockNote(clock, now) },
    // The sun, five days of it, on this computer's clock (KI7MT, 2026-10-23).
    { shape: 'table', heading: 'Sun', columns: ['Date', 'Sunrise', 'Solar noon', 'Sunset', 'Length of day'], rows: sunWeek(now, latitude, longitude, clock) },
    // Twilight and the moon for the same five days, likewise (KI7MT, 2026-10-23).
    { shape: 'table', heading: 'Twilight', columns: ['Date', 'Civil dawn', 'Civil dusk', 'Nautical dawn', 'Nautical dusk', 'Astro dawn', 'Astro dusk'], rows: twilightWeek(now, latitude, longitude, clock) },
    { shape: 'table', heading: 'Moon', columns: ['Date', 'Phase', 'Moonrise', 'Moonset', 'Lit', 'Declination', 'Distance'], rows: moonWeek(now, latitude, longitude, clock) },
    // A table headed Radio depths as the other three are: a table of one
    // group drew its column headings above its title (KI7MT, 2026-10-23).
    { shape: 'table', heading: 'Radio depths', columns: ['Event', 'Date', 'Time'], rows: radioRows(
    // What each depth means for radio, said beside it (QGD-AST-0022). Last:
    // the most specialised, after what everyone reads (KI7MT, 2026-10-23).
    // Today and tomorrow, as it was laid out (KI7MT, 2026-10-23): the date in
    // each time tells the two days apart. Days on this computer's clock, as
    // the tables above are, not the Location's solar days (#57, found by
    // Turing: on a UTC clock "today" held tomorrow's dusk).
    clockDays(now, clock, 2).flatMap(({ start, minutes }, day) => {
      const when = day === 0 ? 'today' : 'tomorrow';
      return [
        ...pair(sunCrossingsOver(start, minutes, latitude, longitude, D_LAYER), 'Dawn: the absorbing D and E layers sunlit again (−10.1°)', 'Dusk: the absorbing D and E layers dark (−10.1°)', `Not ${when}: the sun stays lower`, `Not ${when}: the sun stays higher`),
        ...pair(sunCrossingsOver(start, minutes, latitude, longitude, F2_LAYER), 'Dawn: the reflecting F2 layer sunlit again (−17.2°)', 'Dusk: the reflecting F2 layer dark (−17.2°)', `Not ${when}: the sun stays lower`, `Not ${when}: the sun stays higher`)
      ];
    }), clock) }
  ];

  return { ok: true, data: { version: 6, observedAt, sections } };
}

