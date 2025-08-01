import { useEffect, useRef, useState } from 'react';
import {
  mapboxgl,
  createMarkerElement,
  type MarkerType,
  type MarkerData,
} from '@/lib/mapbox';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HardHat, Building, Trash2, Home } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Marker, LiveSimulationData } from '@shared/schema';
import LiveVehicleLayer from './live-vehicle-layer';

interface MapPanelProps {
  onMarkersChange: (count: number) => void;
  liveData?: LiveSimulationData | null;
  showVehicles?: boolean;
}

// Tokyo coordinates
const TOKYO_COORDS: [number, number] = [139.6917, 35.6895];

export default function MapPanel({ onMarkersChange, liveData, showVehicles }: MapPanelProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [currentTool, setCurrentTool] = useState<MarkerType | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch existing markers
  const { data: markers = [] } = useQuery<Marker[]>({
    queryKey: ['/api/markers'],
  });

  // Create marker mutation
  const createMarkerMutation = useMutation({
    mutationFn: async (data: {
      type: MarkerType;
      coordinates: { lng: number; lat: number };
    }) => {
      const response = await apiRequest('POST', '/api/markers', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/markers'] });
      toast({
        title: 'Marker Added',
        description: 'Marker has been placed successfully.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to add marker. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Clear markers mutation
  const clearMarkersMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('DELETE', '/api/markers');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/markers'] });
      toast({
        title: 'Markers Cleared',
        description: 'All markers have been removed.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to clear markers. Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v11',
      center: TOKYO_COORDS,
      zoom: 12,
    });

    map.addControl(new mapboxgl.NavigationControl());
    mapRef.current = map;

    return () => {
      map.remove();
    };
  }, []);

  // Handle map clicks
  useEffect(() => {
    if (!mapRef.current) return;

    const handleMapClick = (e: mapboxgl.MapMouseEvent) => {
      if (!currentTool) return;

      createMarkerMutation.mutate({
        type: currentTool,
        coordinates: { lng: e.lngLat.lng, lat: e.lngLat.lat },
      });

      setCurrentTool(null);
      mapRef.current!.getCanvas().style.cursor = '';
    };

    mapRef.current.on('click', handleMapClick);

    return () => {
      mapRef.current?.off('click', handleMapClick);
    };
  }, [currentTool, createMarkerMutation]);

  // Update markers when data changes
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Add new markers
    markers.forEach((markerData: Marker) => {
      const element = createMarkerElement(markerData.type as MarkerType);
      const coordinates = markerData.coordinates as {
        lng: number;
        lat: number;
      };
      const marker = new mapboxgl.Marker(element)
        .setLngLat([coordinates.lng, coordinates.lat])
        .addTo(mapRef.current!);

      markersRef.current.push(marker);
    });

    onMarkersChange(markers.length);
  }, [markers, onMarkersChange]);

  // Update cursor when tool changes
  useEffect(() => {
    if (!mapRef.current) return;

    mapRef.current.getCanvas().style.cursor = currentTool ? 'crosshair' : '';
  }, [currentTool]);

  const handleToolSelect = (tool: MarkerType) => {
    setCurrentTool(currentTool === tool ? null : tool);
  };

  const handleClearMarkers = () => {
    clearMarkersMutation.mutate();
  };

  const handleRecenterToTokyo = () => {
    mapRef.current?.flyTo({ center: TOKYO_COORDS, zoom: 12 });
  };

  return (
    <div className="flex-1 bg-gray-100 relative">
      <div ref={mapContainer} className="w-full h-full map-container" />
      
      {/* Live Vehicle Layer */}
      <LiveVehicleLayer 
        map={mapRef.current}
        liveData={liveData || null}
        isVisible={showVehicles || false}
      />

      {/* Map Controls */}
      <div className="absolute top-4 left-4 z-10">
        <Card className="p-3 space-y-2">
          <div className="text-sm font-medium text-gray-700 mb-2">Tools</div>
          <Button
            variant={currentTool === 'construction' ? 'default' : 'outline'}
            size="sm"
            className={`w-full justify-start gap-2 ${
              currentTool === 'construction'
                ? 'bg-accent text-accent-foreground hover:bg-accent/90'
                : ''
            }`}
            onClick={() => handleToolSelect('construction')}
          >
            <HardHat className="h-4 w-4" />
            Construction Zone
          </Button>
          <Button
            variant={currentTool === 'facility' ? 'default' : 'outline'}
            size="sm"
            className={`w-full justify-start gap-2 ${
              currentTool === 'facility'
                ? 'bg-secondary text-secondary-foreground hover:bg-secondary/90'
                : ''
            }`}
            onClick={() => handleToolSelect('facility')}
          >
            <Building className="h-4 w-4" />
            New Facility
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 text-red-600 hover:text-red-700"
            onClick={handleClearMarkers}
            disabled={clearMarkersMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
            Clear All
          </Button>
        </Card>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10">
        <Card className="p-3">
          <div className="text-sm font-medium text-gray-700 mb-2">Legend</div>
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-xs">
              <div className="w-3 h-3 bg-accent rounded-full"></div>
              <span>Construction Zone</span>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <div className="w-3 h-3 bg-secondary rounded-full"></div>
              <span>New Facility</span>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <div className="w-3 h-1 bg-red-500"></div>
              <span>High Congestion</span>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <div className="w-3 h-1 bg-yellow-500"></div>
              <span>Medium Congestion</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Home Button */}
        <div className="absolute top-[100px] right-2 z-10">
        <Button
          variant="outline"
          size="icon"
          className="w-9 h-9"
          onClick={handleRecenterToTokyo}
        >
          <Home className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
