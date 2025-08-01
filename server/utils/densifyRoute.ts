import { lineString, along, length } from '@turf/turf';

/**
 * Densify a polyline using Turf.js to add more intermediate points
 * @param coords Polyline as [lng, lat]
 * @param stepMeters Distance between points (e.g., 5m)
 */
export function densify(coords: [number, number][], stepMeters = 5): [number, number][] {
  if (coords.length < 2) return coords;
  const line = lineString(coords);
  const totalKm = length(line, { units: 'kilometers' });
  const stepKm = stepMeters / 1000;
  const numPoints = Math.ceil(totalKm / stepKm);
  const densified: [number, number][] = [];

  for (let i = 0; i <= numPoints; i++) {
    const point = along(line, stepKm * i, { units: 'kilometers' });
    densified.push(point.geometry.coordinates as [number, number]);
  }

  return densified;
}
