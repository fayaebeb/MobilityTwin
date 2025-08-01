import mapboxgl from 'mapbox-gl';

// Configure Mapbox
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

export { mapboxgl };

export type MarkerType = 'construction' | 'facility';

export interface MarkerData {
  id: string;
  type: MarkerType;
  coordinates: { lng: number; lat: number };
}

export function createMarkerElement(type: MarkerType): HTMLDivElement {
  const element = document.createElement('div');
  element.className = `w-6 h-6 rounded-full flex items-center justify-center text-white text-xs cursor-pointer transform hover:scale-110 transition-transform marker-${type}`;
  
  if (type === 'construction') {
    element.innerHTML = '<i class="fas fa-hard-hat"></i>';
  } else if (type === 'facility') {
    element.innerHTML = '<i class="fas fa-building"></i>';
  }
  
  return element;
}
