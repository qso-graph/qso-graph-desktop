// SPDX-License-Identifier: GPL-3.0-only
// The night on a flat world map (page data version 6), from where the sun is
// overhead. Pure, so it is tested without a window.
//
// The map is longitude and latitude straight onto x and y: 360 by 180, with
// x = longitude + 180 and y = 90 − latitude, the same as the coastlines
// scripts/build-map.mjs writes.
//
// The terminator is where the sun is on the horizon. At longitude λ, with the
// sun overhead at latitude δ and longitude λs, it is the latitude φ with
//   tan φ = −cos(λ − λs) / tan δ,
// which is the sun's altitude formula set to zero. Night is the side of that
// curve away from the sun: south of it while the sun is north of the equator,
// north of it while the sun is south.
import type { Place } from './page-shapes.js';

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

export const MAP_WIDTH = 360;
export const MAP_HEIGHT = 180;

export const mapX = (longitude: number) => longitude + 180;
export const mapY = (latitude: number) => 90 - latitude;

// At an equinox the sun is over the equator, tan δ is 0 and the terminator is
// a meridian pair. A hundredth of a degree off it keeps the formula finite and
// moves the line by less than the map can show.
const LEAST = 0.01;

// The terminator's latitude at each whole degree of longitude, west to east.
export function terminator(sun: Place): [longitude: number, latitude: number][] {
  const declination = Math.abs(sun.latitude) < LEAST ? (sun.latitude < 0 ? -LEAST : LEAST) : sun.latitude;
  const points: [number, number][] = [];
  for (let longitude = -180; longitude <= 180; longitude += 1) {
    points.push([longitude, deg(Math.atan(-Math.cos(rad(longitude - sun.longitude)) / Math.tan(rad(declination))))]);
  }
  return points;
}

const point = ([longitude, latitude]: [number, number]) => `${mapX(longitude).toFixed(2)} ${mapY(latitude).toFixed(2)}`;

// The terminator as an SVG line, and the night as the area between it and
// the pole the sun is away from.
export function terminatorPath(sun: Place): string {
  return `M${terminator(sun).map(point).join('L')}`;
}

export function nightPath(sun: Place): string {
  const pole = sun.latitude >= 0 ? MAP_HEIGHT : 0;
  return `M${terminator(sun).map(point).join('L')}L${MAP_WIDTH} ${pole}L0 ${pole}Z`;
}

// What the map shows, in words, for anyone who cannot see it.
export function mapDescription(marks: readonly { label: string }[]): string {
  const marked = marks.map(mark => mark.label);
  const list = marked.length <= 1 ? marked.join('') : `${marked.slice(0, -1).join(', ')} and ${marked.at(-1)}`;
  return `World map with the night greyed out and the sun's position marked${list ? `, showing ${list}` : ''}.`;
}
