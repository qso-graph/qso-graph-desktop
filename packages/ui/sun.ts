// SPDX-License-Identifier: GPL-3.0-only
// Sunrise and sunset at a position, calculated locally with no network. It
// was On the Air's, for the Your station card, until that card was retired
// (KI7MT, 2026-10-22); kept in the core, with its tests, for the Astro
// extension that will show it (sunrise and sunset, twilight, the moon and
// the grey line, on a page of its own).
//
// NOAA's General Solar Position method, as its Solar Calculator spreadsheet
// writes it: the sun's apparent longitude, the declination and the equation of
// time from the Julian century, and the hour angle at which the sun's centre is
// 0.833° below the horizon (refraction plus the sun's own radius). Each event is
// worked out twice, the second time at the time the first found, which is what
// brings it to within a minute away from the poles.
//
// The day is the station's own: the solar day containing `now` at the
// station's longitude, so a station in Idaho at 02:00 UTC is still on the
// evening whose sunset it is about to see.

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

interface Sun { declination: number; equationOfTime: number }

function sunAt(julianDay: number): Sun {
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
  return { declination, equationOfTime };
}

// The sun's altitude, in degrees, at a moment given as a Julian day.
function altitude(julianDay: number, latitude: number, longitude: number): number {
  const sun = sunAt(julianDay);
  const minutesUtc = ((julianDay - 0.5) % 1 + 1) % 1 * 1440;
  const trueSolarTime = minutesUtc + sun.equationOfTime + 4 * longitude;
  const hour = trueSolarTime / 4 - 180;
  return deg(Math.asin(Math.sin(rad(latitude)) * Math.sin(rad(sun.declination))
    + Math.cos(rad(latitude)) * Math.cos(rad(sun.declination)) * Math.cos(rad(hour))));
}

// The sun's centre 0.833° below the horizon: refraction plus its own radius.
const HORIZON = -0.833;

// Sunrise and sunset in the station's own day. Either may be missing: near
// the polar circles a day can hold a sunset and no sunrise, as Svalbard's
// does on the evening the midnight sun ends. Neither, and the sun is up or
// down all day.
export interface SunDay {
  sunrise?: Date;
  sunset?: Date;
  allDay?: 'up' | 'down';
}

export function sunDay(now: Date, latitude: number, longitude: number): SunDay {
  // Midnight UTC of the station's own day: the day at its longitude.
  const local = new Date(now.getTime() + (longitude / 15) * 3_600_000);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - (longitude / 15) * 3_600_000;
  const julian = (ms: number) => ms / 86_400_000 + 2440587.5;
  // Every minute of the day, and each crossing of the horizon found between
  // two minutes and placed by interpolation. Found, rather than solved from
  // an estimate at noon, so a day near a polar circle with only one crossing
  // is answered rather than taken for a day with none.
  const day: SunDay = {};
  let before = altitude(julian(start), latitude, longitude) - HORIZON;
  for (let minute = 1; minute <= 1440; minute += 1) {
    const at = start + minute * 60_000;
    const after = altitude(julian(at), latitude, longitude) - HORIZON;
    if (before < 0 !== after < 0) {
      const crossing = new Date(Math.round((at - 60_000 + (before / (before - after)) * 60_000) / 60_000) * 60_000);
      if (after >= 0) day.sunrise ??= crossing;
      else day.sunset ??= crossing;
    }
    before = after;
  }
  if (!day.sunrise && !day.sunset) {
    day.allDay = altitude(julian(start + 720 * 60_000), latitude, longitude) > HORIZON ? 'up' : 'down';
  }
  return day;
}
