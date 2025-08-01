import fetch from 'node-fetch';
import dotenv from "dotenv";
dotenv.config();

export interface TrafficIncident {
  id: string;
  type: 'ACCIDENT' | 'CONSTRUCTION' | 'ROAD_CLOSURE' | 'CONGESTION';
  severity: number;
  description: string;
  coordinates: { lat: number; lng: number };
  delayInSeconds: number;
  startTime?: string;
  endTime?: string;
}

export interface TrafficFlow {
  roadName: string;
  currentSpeed: number;
  freeFlowSpeed: number;
  confidence: number;
  coordinates: { lat: number; lng: number }[];
}

export interface TrafficData {
  incidents: TrafficIncident[];
  flows: TrafficFlow[];
  averageDelay: number;
  congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';
}

/**
 * Fetch real-time traffic data from TomTom Traffic API
 */
export async function getTrafficData(
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }
): Promise<TrafficData> {
  const apiKey = process.env.TOMTOM_API_KEY;
  
  if (!apiKey) {
    console.warn('TomTom API key not found, using fallback traffic data');
    return generateFallbackTrafficData(bbox);
  }

  try {
    console.log('Fetching real-time traffic data from TomTom...');
    
    // Fetch traffic incidents
    const incidentsResponse = await fetch(
      `https://api.tomtom.com/traffic/services/5/incidentDetails?` +
      `bbox=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}&` +
      `fields=incidents{type,geometry{type,coordinates},properties{iconCategory,delay,startTime,endTime,summary}}&` +
      `key=${apiKey}`
    );

    // Fetch traffic flow
    const flowResponse = await fetch(
      `https://api.tomtom.com/traffic/services/4/flowSegmentData?` +
      `point=${(bbox.minLat + bbox.maxLat) / 2},${(bbox.minLng + bbox.maxLng) / 2}&` +
      `unit=KMPH&` +
      `key=${apiKey}`
    );

    let incidents: TrafficIncident[] = [];
    let flows: TrafficFlow[] = [];

    if (incidentsResponse.ok) {
      const incidentsData = await incidentsResponse.json() as any;
      
      incidents = incidentsData.incidents?.map((incident: any) => {
        const coords = incident.geometry?.coordinates?.[0] || [0, 0];
        return {
          id: incident.properties?.id || Math.random().toString(),
          type: mapIncidentType(incident.properties?.iconCategory),
          severity: incident.properties?.delay || 0,
          description: incident.properties?.summary || 'Traffic incident',
          coordinates: { lat: coords[1], lng: coords[0] },
          delayInSeconds: incident.properties?.delay || 0,
          startTime: incident.properties?.startTime,
          endTime: incident.properties?.endTime
        };
      }) || [];
    }

    if (flowResponse.ok) {
      const flowData = await flowResponse.json() as any;
      
      if (flowData.flowSegmentData) {
        flows = [{
          roadName: flowData.flowSegmentData.roadName || 'Unknown Road',
          currentSpeed: flowData.flowSegmentData.currentSpeed || 0,
          freeFlowSpeed: flowData.flowSegmentData.freeFlowSpeed || 50,
          confidence: flowData.flowSegmentData.confidence || 0.5,
          coordinates: flowData.flowSegmentData.coordinates?.coordinate?.map((coord: any) => ({
            lat: coord.latitude,
            lng: coord.longitude
          })) || []
        }];
      }
    }

    const averageDelay = incidents.reduce((sum, inc) => sum + inc.delayInSeconds, 0) / Math.max(incidents.length, 1);
    const congestionLevel = calculateCongestionLevel(flows, incidents);

    console.log(`Retrieved ${incidents.length} traffic incidents and ${flows.length} flow segments`);

    return {
      incidents,
      flows,
      averageDelay,
      congestionLevel
    };

  } catch (error) {
    console.error('TomTom API error:', error);
    return generateFallbackTrafficData(bbox);
  }
}

function mapIncidentType(iconCategory: number): TrafficIncident['type'] {
  // TomTom icon categories mapping
  switch (iconCategory) {
    case 0: case 1: case 2: case 3: return 'ACCIDENT';
    case 4: case 5: case 6: return 'CONSTRUCTION';
    case 7: case 8: return 'ROAD_CLOSURE';
    default: return 'CONGESTION';
  }
}

function calculateCongestionLevel(flows: TrafficFlow[], incidents: TrafficIncident[]): TrafficData['congestionLevel'] {
  if (flows.length === 0) return 'LOW';
  
  const avgSpeedRatio = flows.reduce((sum, flow) => 
    sum + (flow.currentSpeed / flow.freeFlowSpeed), 0) / flows.length;
  
  const severityScore = incidents.reduce((sum, inc) => sum + inc.severity, 0) / 1000;
  
  const combinedScore = (1 - avgSpeedRatio) + (severityScore / 100);
  
  if (combinedScore > 0.7) return 'SEVERE';
  if (combinedScore > 0.5) return 'HIGH';
  if (combinedScore > 0.3) return 'MEDIUM';
  return 'LOW';
}

function generateFallbackTrafficData(bbox: any): TrafficData {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const centerLng = (bbox.minLng + bbox.maxLng) / 2;
  
  return {
    incidents: [
      {
        id: 'fallback-1',
        type: 'CONGESTION',
        severity: 300,
        description: 'Moderate traffic congestion (estimated)',
        coordinates: { lat: centerLat, lng: centerLng },
        delayInSeconds: 300
      }
    ],
    flows: [
      {
        roadName: 'Main Route',
        currentSpeed: 35,
        freeFlowSpeed: 50,
        confidence: 0.7,
        coordinates: [{ lat: centerLat, lng: centerLng }]
      }
    ],
    averageDelay: 300,
    congestionLevel: 'MEDIUM'
  };
}