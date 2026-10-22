// SPDX-License-Identifier: GPL-3.0-only
// The moon at a position, calculated on the computer (QGD-AST-0004):
// moonrise and moonset, phase and illuminated fraction, declination and
// distance (QGD-AST-0030, QGD-AST-0031). A method of its own, not the sun's,
// checked against its own independent reference (QGD-AST-0005).
//
// Meeus, Astronomical Algorithms (2nd ed.), chapter 47: the moon's
// geocentric ecliptic longitude, latitude and distance from the ELP-2000/82
// series as Meeus truncates it, which is well inside a minute of rise and set
// time. Rise and set are the moon's centre at h0 = 0.7275 π − 0°34′, where π is
// its horizontal parallax: Meeus's own allowance for parallax, the moon's
// semidiameter and refraction together (chapter 15).
import { crossings, dayStart, julian, sunAt, type Crossings } from './sun.js';

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;
const norm = (degrees: number) => ((degrees % 360) + 360) % 360;

// Table 47.A: D, M, M′, F, then Σl in 10⁻⁶ degrees and Σr in 10⁻³ km.
const LR: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752]
];

// Table 47.B: D, M, M′, F, then Σb in 10⁻⁶ degrees.
const B: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833]
];

export interface MoonPosition {
  // Geocentric, in degrees and kilometres.
  longitude: number;
  latitude: number;
  distance: number;
  rightAscension: number;
  declination: number;
}

export function moonAt(julianDay: number): MoonPosition {
  const t = (julianDay - 2451545) / 36525;
  const meanLongitude = norm(218.3164477 + 481267.88123421 * t - 0.0015786 * t * t + t ** 3 / 538841 - t ** 4 / 65194000);
  const elongation = norm(297.8501921 + 445267.1114034 * t - 0.0018819 * t * t + t ** 3 / 545868 - t ** 4 / 113065000);
  const sunAnomaly = norm(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t + t ** 3 / 24490000);
  const moonAnomaly = norm(134.9633964 + 477198.8675055 * t + 0.0087414 * t * t + t ** 3 / 69699 - t ** 4 / 14712000);
  const argument = norm(93.272095 + 483202.0175233 * t - 0.0036539 * t * t - t ** 3 / 3526000 + t ** 4 / 863310000);
  const a1 = norm(119.75 + 131.849 * t);
  const a2 = norm(53.09 + 479264.29 * t);
  const a3 = norm(313.45 + 481266.484 * t);
  // The earth's orbit's eccentricity decreasing: a term in M is scaled by E,
  // one in 2M by E².
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;
  let l = 0;
  let r = 0;
  for (const [d, m, mp, f, cl, cr] of LR) {
    const angle = rad(d * elongation + m * sunAnomaly + mp * moonAnomaly + f * argument);
    const scale = Math.abs(m) === 1 ? e : Math.abs(m) === 2 ? e * e : 1;
    l += cl * scale * Math.sin(angle);
    r += cr * scale * Math.cos(angle);
  }
  let b = 0;
  for (const [d, m, mp, f, cb] of B) {
    const scale = Math.abs(m) === 1 ? e : Math.abs(m) === 2 ? e * e : 1;
    b += cb * scale * Math.sin(rad(d * elongation + m * sunAnomaly + mp * moonAnomaly + f * argument));
  }
  l += 3958 * Math.sin(rad(a1)) + 1962 * Math.sin(rad(meanLongitude - argument)) + 318 * Math.sin(rad(a2));
  b += -2235 * Math.sin(rad(meanLongitude)) + 382 * Math.sin(rad(a3)) + 175 * Math.sin(rad(a1 - argument))
    + 175 * Math.sin(rad(a1 + argument)) + 127 * Math.sin(rad(meanLongitude - moonAnomaly))
    - 115 * Math.sin(rad(meanLongitude + moonAnomaly));
  // Nutation in longitude, to the precision this needs (chapter 22).
  const omega = rad(125.04452 - 1934.136261 * t);
  const nutation = (-17.2 * Math.sin(omega) - 1.32 * Math.sin(2 * rad(280.4665 + 36000.7698 * t))) / 3600;
  const longitude = norm(meanLongitude + l / 1e6 + nutation);
  const latitude = b / 1e6;
  const distance = 385000.56 + r / 1000;
  const obliquity = rad(23.4392911 - 0.0130042 * t + 0.00256 * Math.cos(omega));
  const lambda = rad(longitude);
  const beta = rad(latitude);
  const rightAscension = norm(deg(Math.atan2(Math.sin(lambda) * Math.cos(obliquity) - Math.tan(beta) * Math.sin(obliquity), Math.cos(lambda))));
  const declination = deg(Math.asin(Math.sin(beta) * Math.cos(obliquity) + Math.cos(beta) * Math.sin(obliquity) * Math.sin(lambda)));
  return { longitude, latitude, distance, rightAscension, declination };
}

// Greenwich mean sidereal time, in degrees (Meeus 12.4).
function sidereal(julianDay: number): number {
  const t = (julianDay - 2451545) / 36525;
  return norm(280.46061837 + 360.98564736629 * (julianDay - 2451545) + 0.000387933 * t * t - t ** 3 / 38710000);
}

// Where the moon is overhead, for the map: its declination, and the
// longitude where its hour angle is nought (geocentric, which the map's scale
// cannot tell from the topocentric).
export function sublunar(julianDay: number): { latitude: number; longitude: number } {
  const moon = moonAt(julianDay);
  const longitude = ((moon.rightAscension - sidereal(julianDay)) % 360 + 540) % 360 - 180;
  return { latitude: moon.declination, longitude };
}

// The moon's geocentric altitude above Meeus's h0 for it: positive above
// the moment of rise or set.
function aboveRiseSet(julianDay: number, latitude: number, longitude: number): number {
  const moon = moonAt(julianDay);
  const parallax = deg(Math.asin(6378.14 / moon.distance));
  const h0 = 0.7275 * parallax - 34 / 60;
  const hour = rad(sidereal(julianDay) + longitude - moon.rightAscension);
  const altitude = deg(Math.asin(Math.sin(rad(latitude)) * Math.sin(rad(moon.declination))
    + Math.cos(rad(latitude)) * Math.cos(rad(moon.declination)) * Math.cos(hour)));
  return altitude - h0;
}

// Moonrise and moonset in the station's own day. The moon's day is about
// 24 h 50 min, so roughly once a month a calendar day has no moonrise or no
// moonset: that is an answer, not a failure (QGD-AST-0007).
export function moonCrossings(now: Date, latitude: number, longitude: number): Crossings {
  return crossings(dayStart(now, longitude), 1440, ms => aboveRiseSet(julian(ms), latitude, longitude));
}

export interface MoonPhase {
  // 0 at new moon, 0.5 at full.
  fraction: number;
  // The moon's elongation east of the sun, 0 to 360°: under 180° waxing.
  elongation: number;
  name: string;
}

// The illuminated fraction from the phase angle (Meeus 48.2, 48.3), and the
// phase's name from the moon's elongation east of the sun.
export function moonPhase(julianDay: number): MoonPhase {
  const moon = moonAt(julianDay);
  const sun = sunAt(julianDay);
  const elongation = norm(moon.longitude - sun.apparentLongitude);
  const psi = Math.acos(Math.cos(rad(moon.latitude)) * Math.cos(rad(moon.longitude - sun.apparentLongitude)));
  const sunDistance = 149597870.7;
  const phaseAngle = Math.atan2(sunDistance * Math.sin(psi), moon.distance - sunDistance * Math.cos(psi));
  const fraction = (1 + Math.cos(phaseAngle)) / 2;
  return { fraction, elongation, name: phaseName(elongation) };
}

// Each named phase is the ±6° around its point (half a day of the moon's
// motion either side), and the rest are crescents and gibbous between them.
function phaseName(elongation: number): string {
  const near = (point: number) => Math.min(Math.abs(elongation - point), 360 - Math.abs(elongation - point)) <= 6;
  if (near(0)) return 'New moon';
  if (near(90)) return 'First quarter';
  if (near(180)) return 'Full moon';
  if (near(270)) return 'Last quarter';
  if (elongation < 90) return 'Waxing crescent';
  if (elongation < 180) return 'Waxing gibbous';
  if (elongation < 270) return 'Waning gibbous';
  return 'Waning crescent';
}
