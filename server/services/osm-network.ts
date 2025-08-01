import fetch from 'node-fetch';

export interface OSMRoad {
  id: string;
  nodes: number[];
  tags: Record<string, string>;
  geometry: { lat: number; lng: number }[];
}

export interface OSMNode {
  id: number;
  lat: number;
  lng: number;
}

export interface NetworkData {
  nodes: OSMNode[];
  roads: OSMRoad[];
  bbox: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
}

/**
 * Extract road network data from OpenStreetMap for traffic simulation
 */
export async function extractRoadNetwork(
  centerLat: number,
  centerLng: number,
  radiusKm: number = 2
): Promise<NetworkData> {
  try {
    // Calculate bounding box (approximate)
    const latDelta = radiusKm / 111; // 1 degree lat ≈ 111km
    const lngDelta = radiusKm / (111 * Math.cos(centerLat * Math.PI / 180));
    
    const bbox = {
      minLat: centerLat - latDelta,
      maxLat: centerLat + latDelta,
      minLng: centerLng - lngDelta,
      maxLng: centerLng + lngDelta
    };

    // Overpass API query for road network
    const query = `
      [out:json][timeout:25];
      (
        way["highway"]["highway"!~"footway|cycleway|path|steps|service"]
          (${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
      );
      (._;>;);
      out geom;
    `;

    console.log('Fetching road network from OpenStreetMap...');
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`
    });

    if (!response.ok) {
      throw new Error(`OSM API error: ${response.status}`);
    }

    const data = await response.json() as any;
    
    // Process nodes
    const nodes: OSMNode[] = data.elements
      .filter((el: any) => el.type === 'node')
      .map((node: any) => ({
        id: node.id,
        lat: node.lat,
        lng: node.lon
      }));

    // Process ways (roads)
    const roads: OSMRoad[] = data.elements
      .filter((el: any) => el.type === 'way')
      .map((way: any) => ({
        id: way.id.toString(),
        nodes: way.nodes,
        tags: way.tags || {},
        geometry: way.geometry?.map((point: any) => ({
          lat: point.lat,
          lng: point.lon
        })) || []
      }));

    console.log(`Extracted ${nodes.length} nodes and ${roads.length} roads from OSM`);

    return {
      nodes,
      roads,
      bbox
    };
  } catch (error) {
    console.error('Failed to extract road network:', error);
    throw new Error('Road network extraction failed');
  }
}

/**
 * Calculate road capacity based on highway type
 */
export function getRoadCapacity(highway: string): number {
  const capacities: Record<string, number> = {
    'motorway': 2000,
    'trunk': 1500,
    'primary': 1200,
    'secondary': 800,
    'tertiary': 600,
    'residential': 400,
    'unclassified': 300
  };
  
  return capacities[highway] || 300;
}

/**
 * Calculate free flow speed based on highway type
 */
export function getFreeFlowSpeed(highway: string): number {
  const speeds: Record<string, number> = {
    'motorway': 110,
    'trunk': 90,
    'primary': 70,
    'secondary': 60,
    'tertiary': 50,
    'residential': 30,
    'unclassified': 40
  };
  
  return speeds[highway] || 40;
}