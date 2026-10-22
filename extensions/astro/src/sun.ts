// SPDX-License-Identifier: GPL-3.0-only
// The sun at a position, calculated on the computer with no network
// (QGD-AST-0004): sunrise and sunset, solar noon, the three twilights and the
// two radio depths (QGD-AST-0020 to QGD-AST-0022). It was the core's, for the
// retired Your station card, and moved here with Astro (QGD-AST-0001.1).
//
// NOAA's General Solar Position method, as its Solar Calculator spreadsheet
// writes it: the sun's apparent longitude, the declination and the equation of
// time from the Julian century. Each event is the moment the sun's centre
// crosses an altitude, found minute by minute over the station's own day and
// placed between two minutes by interpolation, so a day near a polar circle
// with one crossing is answered rather than taken for a day with none.
//
// The day is the station's own: the solar day containing `now` at the
// station's longitude, so a station in Idaho at 02:00 UTC is still on the
// evening whose sunset it is about to see.

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

export const julian = (ms: number) => ms / 86_400_000 + 2440587.5;

export interface SunPosition {
  declination: number;
  equationOfTime: number;
  // The sun's apparent ecliptic longitude, for the moon's phase (moon.ts).
  apparentLongitude: number;
}

export function sunAt(julianDay: number): SunPosition {
  const t = (julianDay - 2451545) / 36525;
  const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre = Math.sin(rad(meanAnomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(rad(2 * meanAnomaly)) * (0.019993 - 0.000101 * t)
    + Math.sin(rad(3 * meanAnomaly)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliquity)) * Math.sin(rad(apparentLongitude))));
  const y = Math.tan(rad(obliquity / 2)) ** 2;
  const equationOfTime = 4 * deg(
    y * Math.sin(2 * rad(meanLongitude))
    - 2 * eccentricity * Math.sin(rad(meanAnomaly))
    + 4 * eccentricity * y * Math.sin(rad(meanAnomaly)) * Math.cos(2 * rad(meanLongitude))
    - 0.5 * y * y * Math.sin(4 * rad(meanLongitude))
    - 1.25 * eccentricity * eccentricity * Math.sin(2 * rad(meanAnomaly)));
  return { declination, equationOfTime, apparentLongitude: ((apparentLongitude % 360) + 360) % 360 };
}

// The sun's altitude, in degrees, at a moment given as a Julian day.
export function sunAltitude(julianDay: number, latitude: number, longitude: number): number {
  const sun = sunAt(julianDay);
  const minutesUtc = ((julianDay - 0.5) % 1 + 1) % 1 * 1440;
  const trueSolarTime = minutesUtc + sun.equationOfTime + 4 * longitude;
  const hour = trueSolarTime / 4 - 180;
  return deg(Math.asin(Math.sin(rad(latitude)) * Math.sin(rad(sun.declination))
    + Math.cos(rad(latitude)) * Math.cos(rad(sun.declination)) * Math.cos(rad(hour))));
}

// The altitudes Astro reports (QGD-AST-0020 to QGD-AST-0022). Sunrise and
// sunset are the centre 0.833° below the horizon: 34′ of refraction plus the
// sun's 16′ semidiameter. The radio depths are where a layer 100 km up (D and
// E) and one 300 km up (F2) enter the earth's shadow, from cos θ = R / (R + h)
// with R = 6371 km: an assumption written down as one, not a standard.
export const HORIZON = -0.833;
export const CIVIL = -6;
export const NAUTICAL = -12;
export const ASTRONOMICAL = -18;
export const D_LAYER = -10.1;
export const F2_LAYER = -17.2;

// The start of the station's own day, as milliseconds UTC.
export function dayStart(now: Date, longitude: number): number {
  const local = new Date(now.getTime() + (longitude / 15) * 3_600_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - (longitude / 15) * 3_600_000;
}

// When an altitude is crossed during the station's day: going up (the
// morning's) and going down (the evening's). Either may be missing; neither,
// and the sun is above or below that altitude all day.
export interface Crossings {
  rising?: Date;
  setting?: Date;
  allDay?: 'above' | 'below';
}

// Found from a curve sampled each minute over [start, start + minutes):
// `height(ms)` is the body's altitude above the threshold. Shared with the
// moon, whose threshold moves with its distance (moon.ts).
export function crossings(start: number, minutes: number, height: (ms: number) => number): Crossings {
  const found: Crossings = {};
  let before = height(start);
  for (let minute = 1; minute <= minutes; minute += 1) {
    const at = start + minute * 60_000;
    const after = height(at);
    if (before < 0 !== after < 0) {
      const crossing = new Date(Math.round((at - 60_000 + (before / (before - after)) * 60_000) / 60_000) * 60_000);
      if (after >= 0) found.rising ??= crossing;
      else found.setting ??= crossing;
    }
    before = after;
  }
  if (!found.rising && !found.setting) found.allDay = height(start + (minutes / 2) * 60_000) > 0 ? 'above' : 'below';
  return found;
}

export function sunCrossings(now: Date, latitude: number, longitude: number, altitude: number): Crossings {
  return crossings(dayStart(now, longitude), 1440, ms => sunAltitude(julian(ms), latitude, longitude) - altitude);
}

// Sunrise and sunset in the station's own day, as the core's card had them.
export interface SunDay {
  sunrise?: Date;
  sunset?: Date;
  allDay?: 'up' | 'down';
}

export function sunDay(now: Date, latitude: number, longitude: number): SunDay {
  const found = sunCrossings(now, latitude, longitude, HORIZON);
  if (found.allDay) return { allDay: found.allDay === 'above' ? 'up' : 'down' };
  return { ...(found.rising ? { sunrise: found.rising } : {}), ...(found.setting ? { sunset: found.setting } : {}) };
}

// Solar noon: the sun at its highest in the station's day, to the minute.
export function solarNoon(now: Date, latitude: number, longitude: number): Date {
  const start = dayStart(now, longitude);
  let best = start;
  let highest = -Infinity;
  for (let minute = 0; minute < 1440; minute += 1) {
    const at = start + minute * 60_000;
    const altitude = sunAltitude(julian(at), latitude, longitude);
    if (altitude > highest) { highest = altitude; best = at; }
  }
  return new Date(best);
}
