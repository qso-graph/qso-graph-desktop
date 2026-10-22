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

// Deeper than the horizon the edge is no longer one line across the map:
// where the sun is more than 90° − depth below the horizon is a circle on the
// earth, of radius 90° + depth about the point opposite the sun, and near an
// equinox it closes before it reaches the poles. So it is drawn as that
// circle: a point every degree round it, its longitudes unwrapped so it
// never jumps from one edge of the map to the other.
export function capRing(centre: Place, radius: number): [longitude: number, latitude: number][] {
  const φ1 = rad(centre.latitude);
  const δ = rad(radius);
  const ring: [number, number][] = [];
  let previous: number | undefined;
  for (let bearing = 0; bearing <= 360; bearing += 1) {
    const θ = rad(bearing);
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    let longitude = centre.longitude + deg(Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)));
    if (previous !== undefined) longitude += 360 * Math.round((previous - longitude) / 360);
    ring.push([longitude, deg(φ2)]);
    previous = longitude;
  }
  return ring;
}

// The area inside that circle as SVG, drawn three times a map-width apart:
// the svg clips to the map, so whichever part runs off one edge is the part
// that comes in at the other. A circle round a pole runs the whole width, and
// is closed along that pole's edge.
export function capPath(centre: Place, radius: number): string {
  const ring = capRing(centre, radius);
  const north = 90 - centre.latitude < radius;
  const south = 90 + centre.latitude < radius;
  const shape = (shift: number) => {
    const points = ring.map(([longitude, latitude]) => point([longitude + shift, latitude]));
    if (!north && !south) return `M${points.join('L')}Z`;
    const edge = north ? 0 : MAP_HEIGHT;
    const first = mapX(ring[0]![0] + shift).toFixed(2);
    const last = mapX(ring.at(-1)![0] + shift).toFixed(2);
    return `M${points.join('L')}L${last} ${edge}L${first} ${edge}Z`;
  };
  return [-360, 0, 360].map(shape).join('');
}

// The point opposite the sun, which the night is centred on.
export function antisolar(sun: Place): Place {
  return { latitude: -sun.latitude, longitude: sun.longitude > 0 ? sun.longitude - 180 : sun.longitude + 180 };
}

// What the map shows, in words, for anyone who cannot see it.
export function mapDescription(marks: readonly { label: string }[], moon = false, twilight?: number): string {
  const marked = marks.map(mark => mark.label);
  const list = marked.length <= 1 ? marked.join('') : `${marked.slice(0, -1).join(', ')} and ${marked.at(-1)}`;
  const band = twilight !== undefined ? `, the twilight to ${Math.abs(twilight)}° below the horizon shaded lighter` : '';
  return `World map with the night greyed out${band}, and the sun's${moon ? ' and the moon\'s positions' : ' position'} marked${list ? `, showing ${list}` : ''}.`;
}
