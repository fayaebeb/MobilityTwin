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

export default function LiveVehicleLayer({ map, liveData, isVisible }: LiveVehicleLayerProps) {
  const vehicleMarkersRef = useRef<Map<string, { marker: mapboxgl.Marker; lastPos: [number, number] }>>(new Map());
  const congestionCacheRef = useRef<Map<string, string>>(); // edgeId => congestionLevel
  const congestionLayersRef = useRef<Set<string>>(new Set());

  const cleanup = () => {
    vehicleMarkersRef.current.forEach(({ marker }) => marker.remove());
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

    console.log('LiveVehicleLayer: Processing live data with', liveData.vehicles.length, 'vehicles at timestamp', liveData.timestamp);

    // Clear existing markers when new simulation data arrives
    if (liveData.timestamp === 0 || liveData.timestamp <= 10) {
      console.log('LiveVehicleLayer: Cleaning up for new simulation');
      cleanup();
    }

    const activeVehicleIds = new Set(liveData.vehicles.map(v => v.id));

    vehicleMarkersRef.current.forEach(({ marker }, id) => {
      if (!activeVehicleIds.has(id)) {
        marker.remove();
        vehicleMarkersRef.current.delete(id);
      }
    });

    liveData.vehicles.forEach(vehicle => {
      if (!vehicle.coordinates || vehicle.coordinates.length !== 2) return;
      
      const prev = vehicleMarkersRef.current.get(vehicle.id);
      const el = prev?.marker.getElement() || createVehicleElement(vehicle);
      
      // Use accurate route interpolation
      const accurateCoord = vehicle.route && vehicle.route.length > 1 
        ? interpolateOnRoute(vehicle.route, vehicle.routeProgress || 0)
        : vehicle.coordinates;
      
      const marker = prev?.marker || new mapboxgl.Marker(el).setLngLat(accurateCoord).addTo(map);
      
      if (!prev) {
        vehicleMarkersRef.current.set(vehicle.id, { marker, lastPos: accurateCoord });
      } else {
        // Update vehicle element with new data
        updateVehicleElement(el, vehicle);
        // Animate to new position
        animateMarker(marker, prev.lastPos, accurateCoord);
        vehicleMarkersRef.current.get(vehicle.id)!.lastPos = accurateCoord;
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
      const key = JSON.stringify(segment.coordinates);
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

    // Remove outdated
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

// Animate marker between two points (linear interpolation)
function animateMarker(marker: mapboxgl.Marker, from: [number, number], to: [number, number], duration = 300) {
  const start = performance.now();
  const animate = (time: number) => {
    const elapsed = time - start;
    const t = Math.min(1, elapsed / duration);
    const lng = from[0] + (to[0] - from[0]) * t;
    const lat = from[1] + (to[1] - from[1]) * t;
    marker.setLngLat([lng, lat]);
    if (t < 1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

function interpolateOnRoute(
  route: [number, number][],
  progress: number
): [number, number] {
  if (route.length < 2) return route[0];
  const line = lineString(route);
  const totalKm = length(line, { units: 'kilometers' });
  const point = along(line, totalKm * progress, { units: 'kilometers' });
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
    transform: rotate(${vehicle.heading}deg);
    transition: transform 0.3s ease;
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

  el.addEventListener('mouseenter', () => speedTip.style.opacity = '1');
  el.addEventListener('mouseleave', () => speedTip.style.opacity = '0');

  return el;
}

function updateVehicleElement(el: HTMLElement, vehicle: VehiclePosition) {
  el.style.backgroundColor = getSpeedColor(vehicle.speed);
  el.style.transform = `rotate(${vehicle.heading}deg)`;

  const speedTip = el.querySelector('div') as HTMLElement;
  if (speedTip) {
    speedTip.textContent = `${Math.round(vehicle.speed)} km/h`;
  }
}

function getSpeedColor(speed: number): string {
  if (speed < 10) return '#ef4444';   // Red
  if (speed < 30) return '#f97316';   // Orange
  if (speed < 50) return '#eab308';   // Yellow
  return '#22c55e';                   // Green
}

function getCongestionColor(level: 'high' | 'medium' | 'low'): string {
  switch (level) {
    case 'high': return '#ef4444';
    case 'medium': return '#f97316';
    case 'low': return '#eab308';
  }
}