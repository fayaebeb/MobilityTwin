import { useEffect, useRef } from 'react';
import { mapboxgl } from '@/lib/mapbox';
import type { LiveSimulationData, VehiclePosition } from '@shared/schema';
import { lineString } from '@turf/helpers';
import along from '@turf/along';
import length from '@turf/length';

interface LiveVehicleLayerProps {
  map: mapboxgl.Map | null;
  liveData: LiveSimulationData | null;
  isVisible: boolean;
}

type VehicleAnimState = {
  marker: mapboxgl.Marker;
  // last known route used for animation
  route: [number, number][] | null;
  // last progress (0..1) we rendered
  lastProgress: number;
  // last coordinate used by the marker (fallback when no route)
  lastCoord: [number, number];
  // cancel current rAF animation
  cancel?: () => void;
};

export default function LiveVehicleLayer({ map, liveData, isVisible }: LiveVehicleLayerProps) {
  const vehicleMarkersRef = useRef<Map<string, VehicleAnimState>>(new Map());
  const congestionCacheRef = useRef<Map<string, string>>();
  const congestionLayersRef = useRef<Set<string>>(new Set());

  const cleanup = () => {
    vehicleMarkersRef.current.forEach(({ marker, cancel }) => {
      cancel?.();
      marker.remove();
    });
    vehicleMarkersRef.current.clear();

    if (map) {
      congestionLayersRef.current.forEach(layerId => {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(layerId)) map.removeSource(layerId);
      });
      congestionLayersRef.current.clear();
      congestionCacheRef.current?.clear();
    }
  };

  useEffect(() => {
    if (!map || !liveData || !isVisible) {
      cleanup();
      return;
    }

    // When simulation restarts, clear
    if (liveData.timestamp === 0 || liveData.timestamp <= 10) {
      cleanup();
    }

    const activeVehicleIds = new Set(liveData.vehicles.map(v => v.id));

    // Remove markers for vehicles no longer active
    vehicleMarkersRef.current.forEach(({ marker, cancel }, id) => {
      if (!activeVehicleIds.has(id)) {
        cancel?.();
        marker.remove();
        vehicleMarkersRef.current.delete(id);
      }
    });

    // Update / create vehicle markers
    liveData.vehicles.forEach(v => {
      if (!v.coordinates || v.coordinates.length !== 2) return;

      const state = vehicleMarkersRef.current.get(v.id);

      // Choose a coordinate path to animate on
      const anyV = v as any;
      const coordPath: [number, number][] | undefined =
        Array.isArray(anyV.routeCoordinates) && Array.isArray(anyV.routeCoordinates[0])
          ? (anyV.routeCoordinates as [number, number][])
          : (Array.isArray(anyV.route) && Array.isArray(anyV.route[0])
            ? (anyV.route as [number, number][])
            : undefined);

      const hasPath = !!coordPath && coordPath.length > 1;
      const progress = clamp01(v.routeProgress ?? 0);
      const targetCoord = hasPath ? interpolateOnRoute(coordPath!, progress) : (v.coordinates as [number, number]);

      if (!state) {
        const el = createVehicleElement(v);
        const marker = new mapboxgl.Marker(el).setLngLat(targetCoord).addTo(map);

        vehicleMarkersRef.current.set(v.id, {
          marker,
          route: hasPath ? coordPath! : null,
          lastProgress: hasPath ? progress : 0,
          lastCoord: targetCoord
        });
      } else {
        // Update UI element (color/heading)
        updateVehicleElement(state.marker.getElement(), v);

        // If route changed (or was missing before), reset the baseline
        const routeChanged = hasPath && (!state.route || !sameRoute(state.route, coordPath!));
        if (routeChanged) {
          state.route = coordPath!;
          state.lastProgress = progress; // jump to current to avoid backtrack
          state.marker.setLngLat(interpolateOnRoute(coordPath!, progress));
          state.lastCoord = interpolateOnRoute(coordPath!, progress);
          state.cancel?.();
          state.cancel = undefined;
          return;
        }

        // Animate:
        // - If we have a path, tween progress along the polyline
        // - Else, fallback to straight-line between coords
        if (hasPath && state.route) {
          const from = state.lastProgress;
          const to = progress;

          // If progress went backward significantly (e.g., route reset), just jump
          if (to <= from - 0.05) {
            state.cancel?.();
            state.marker.setLngLat(interpolateOnRoute(state.route, to));
            state.lastProgress = to;
            state.lastCoord = interpolateOnRoute(state.route, to);
          } else if (Math.abs(to - from) < 1e-6) {
            // nothing to do
          } else {
            state.cancel?.();
            state.cancel = animateAlongRoute(state.marker, state.route, from, to, 400, () => {
              state.lastProgress = to;
              state.lastCoord = interpolateOnRoute(state.route!, to);
            });
          }
        } else {
          // No path available → fallback linear lerp lat/lng
          const from = state.lastCoord;
          const to = targetCoord;
          if (!almostSameCoord(from, to)) {
            state.cancel?.();
            state.cancel = animateMarkerLinear(state.marker, from, to, 300, () => {
              state.lastCoord = to;
              state.lastProgress = 0;
            });
          }
          state.route = null;
        }
      }
    });

    updateCongestionLayers(map, liveData);
  }, [map, liveData, isVisible]);

  useEffect(() => {
    if (!isVisible) cleanup();
    return cleanup;
  }, [isVisible]);

  const updateCongestionLayers = (map: mapboxgl.Map, data: LiveSimulationData) => {
    const prevCache = congestionCacheRef.current || new Map();
    congestionCacheRef.current = new Map();

    data.congestionSegments.forEach((segment, index) => {
      const layerId = `congestion-${index}`;
      const sourceId = `congestion-source-${index}`;

      if (prevCache.get(layerId) === segment.level) {
        congestionCacheRef.current!.set(layerId, segment.level);
        return;
      }

      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      const color = getCongestionColor(segment.level);
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: segment.coordinates
          }
        }
      });

      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': color,
          'line-width': 4,
          'line-opacity': 0.8
        }
      });

      congestionLayersRef.current.add(layerId);
      congestionCacheRef.current!.set(layerId, segment.level);
    });

    // remove outdated
    prevCache.forEach((_, layerId) => {
      if (!congestionCacheRef.current!.has(layerId)) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(layerId)) map.removeSource(layerId);
        congestionLayersRef.current.delete(layerId);
      }
    });
  };

  return null;
}

/* ===================== helpers ===================== */

// Animate marker by interpolating PROGRESS along the route polyline (not straight line).
function animateAlongRoute(
  marker: mapboxgl.Marker,
  route: [number, number][],
  fromProgress: number,
  toProgress: number,
  durationMs: number,
  onDone?: () => void
) {
  const start = performance.now();
  let rafId = 0;

  const step = (t: number) => {
    const elapsed = t - start;
    const r = Math.min(1, elapsed / Math.max(1, durationMs));
    const eased = easeInOutCubic(r);

    // progress interp
    const p = fromProgress + (toProgress - fromProgress) * eased;
    const coord = interpolateOnRoute(route, p);
    marker.setLngLat(coord);

    if (r < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      onDone?.();
    }
  };

  rafId = requestAnimationFrame(step);
  return () => cancelAnimationFrame(rafId);
}

// Straight-line fallback animation (used only if no route geometry available)
function animateMarkerLinear(
  marker: mapboxgl.Marker,
  from: [number, number],
  to: [number, number],
  duration = 300,
  onDone?: () => void
) {
  const start = performance.now();
  let rafId = 0;

  const step = (time: number) => {
    const elapsed = time - start;
    const t = Math.min(1, elapsed / Math.max(1, duration));
    const eased = easeInOutCubic(t);
    const lng = from[0] + (to[0] - from[0]) * eased;
    const lat = from[1] + (to[1] - from[1]) * eased;
    marker.setLngLat([lng, lat]);
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      onDone?.();
    }
  };

  rafId = requestAnimationFrame(step);
  return () => cancelAnimationFrame(rafId);
}

function interpolateOnRoute(
  route: [number, number][],
  progress: number
): [number, number] {
  if (route.length < 2) return route[0];
  const line = lineString(route);
  const totalKm = length(line, { units: 'kilometers' });
  const point = along(line, totalKm * clamp01(progress), { units: 'kilometers' });
  return point.geometry.coordinates as [number, number];
}

function createVehicleElement(vehicle: VehiclePosition): HTMLElement {
  const el = document.createElement('div');
  el.className = 'vehicle-marker';
  el.style.cssText = `
    width: 12px;
    height: 12px;
    background-color: ${getSpeedColor(vehicle.speed)};
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    transform: rotate(${Number.isFinite(vehicle.heading) ? vehicle.heading : 0}deg);
    transition: transform 0.25s ease;
    cursor: pointer;
    position: relative;
  `;

  const speedTip = document.createElement('div');
  speedTip.style.cssText = `
    position: absolute;
    top: -20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.8);
    color: white;
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 10px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
  `;
  speedTip.textContent = `${Math.round(vehicle.speed)} km/h`;
  el.appendChild(speedTip);

  el.addEventListener('mouseenter', () => (speedTip.style.opacity = '1'));
  el.addEventListener('mouseleave', () => (speedTip.style.opacity = '0'));

  return el;
}

function updateVehicleElement(el: HTMLElement, vehicle: VehiclePosition) {
  el.style.backgroundColor = getSpeedColor(vehicle.speed);
  const h = Number.isFinite(vehicle.heading) ? vehicle.heading : 0;
  el.style.transform = `rotate(${h}deg)`;

  const speedTip = el.querySelector('div') as HTMLElement;
  if (speedTip) speedTip.textContent = `${Math.round(vehicle.speed)} km/h`;
}

function getSpeedColor(speed: number): string {
  if (speed < 10) return '#ef4444';
  if (speed < 30) return '#f97316';
  if (speed < 50) return '#eab308';
  return '#22c55e';
}

function getCongestionColor(level: 'high' | 'medium' | 'low'): string {
  switch (level) {
    case 'high': return '#ef4444';
    case 'medium': return '#f97316';
    case 'low': return '#eab308';
  }
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function almostSameCoord(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}
function sameRoute(a: [number, number][], b: [number, number][]) {
  if (a.length !== b.length) return false;
  // cheap check: first & last match
  return almostSameCoord(a[0], b[0]) && almostSameCoord(a[a.length - 1], b[b.length - 1]);
}
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}