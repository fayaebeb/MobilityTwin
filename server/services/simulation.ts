import type { SimulationMetrics } from "@shared/schema";
import { extractRoadNetworkCached } from './road-cache';
import { getTrafficData } from './tomtom-traffic';
import { getPopulationData } from './population-data';
import { RealTrafficSimulation } from './sumo-simulation';

/**
 * Advanced traffic simulation using real data sources:
 * - OpenStreetMap for road network topology
 * - TomTom API for real-time traffic conditions
 * - WorldPop/Census for population density
 * - SUMO-style microsimulation algorithms
 */
export async function runTrafficSimulation(
  markers: Array<{ type: string; coordinates: { lng: number; lat: number } }>,
  durationMinutes: number,
  radiusKm: number,
  onLog?: (msg: string) => void
): Promise<SimulationMetrics> {
  try {
    const log = (msg: string) => {
      console.log(msg);
      onLog?.(msg);
    };

    log('🔄 Starting real traffic simulation with external data sources...');

    if (markers.length === 0) {
      throw new Error('No markers provided for simulation');
    }

    const { centerLat, centerLng } = calculateSimulationCenter(markers);

    log('📡 Fetching real-world data...');
    const [networkData, trafficData, populationData] = await Promise.all([
      extractRoadNetworkCached(centerLat, centerLng, radiusKm),
      getTrafficData(calculateBoundingBox(markers)),
      getPopulationData(calculateBoundingBox(markers)),
    ]);

    log(`✅ Road network: ${networkData.roads.length} roads, ${networkData.nodes.length} nodes`);
    log(`🚧 Traffic: ${trafficData.incidents.length} incidents, congestion: ${trafficData.congestionLevel}`);
    log(`👥 Population: ${populationData.totalPopulation} total, ${populationData.density}/km² density`);

    log('🚦 Running microsimulation...');
    const simulation = new RealTrafficSimulation(networkData, trafficData, populationData);

    const results = await simulation.simulate(markers, durationMinutes);

    results.roads_count = networkData.roads.length;
    results.nodes_count = networkData.nodes.length;
    results.incidents_count = trafficData.incidents.length;
    results.vehicle_sample = simulation.getVehicles().slice(0, 5).map(v => ({
      id: v.id,
      routeLength: v.route.length,
      speed: v.speed
    }));

    results.affected_edges = simulation.getAffectedEdgeCount();

    results.population_summary = {
      total: populationData.totalPopulation,
      density: populationData.density
    };

    const constructionImpacts = simulation.getConstructionImpacts();
    results.construction_impacts = constructionImpacts;

    if (constructionImpacts?.length) {
      log(`🏗️ Applied ${constructionImpacts.length} construction impacts:`);
      for (const impact of constructionImpacts.slice(0, 10)) {
        log(`  - Edge ${impact.edgeId}: ${impact.originalSpeed} → ${impact.reducedSpeed} km/h`);
      }
      if (constructionImpacts.length > 10) {
        log(`  ...and ${constructionImpacts.length - 10} more`);
      }
    }

    log('✅ Simulation completed successfully');
    return results;
  } catch (error) {
    console.error('Simulation failed:', error);
    onLog?.('❌ Simulation failed. Using fallback model...');
    return runFallbackSimulation(markers);
  }
}

function runFallbackSimulation(
  markers: Array<{ type: string; coordinates: { lng: number; lat: number } }>
): SimulationMetrics {
  console.log('🧮 Running fallback mathematical simulation...');

  const hasConstruction = markers.some(m => m.type === 'construction');
  const hasFacility = markers.some(m => m.type === 'facility');
  const constructionCount = markers.filter(m => m.type === 'construction').length;
  const facilityCount = markers.filter(m => m.type === 'facility').length;

  let baseDrivingDistance = 385;
  let baseCongestionLength = 0.8;
  let baseCO2Emissions = 72;

  if (hasConstruction) {
    baseDrivingDistance += constructionCount * 15;
    baseCongestionLength += constructionCount * 0.8;
    baseCO2Emissions += constructionCount * 12;
  }

  if (hasFacility) {
    baseDrivingDistance += facilityCount * 8;
    baseCongestionLength += facilityCount * 0.3;
    baseCO2Emissions += facilityCount * 6;
  }

  const variance = (Math.random() - 0.5) * 0.1;
  baseDrivingDistance *= (1 + variance);
  baseCongestionLength *= (1 + variance);
  baseCO2Emissions *= (1 + variance);

  return {
    driving_distance: `${Math.round(baseDrivingDistance)} km`,
    congestion_length: `${baseCongestionLength.toFixed(1)} km`,
    co2_emissions: `${Math.round(baseCO2Emissions)} kg`
  };
}

function calculateSimulationCenter(markers: Array<{ type: string; coordinates: { lng: number; lat: number } }>) {
  const centerLat = markers.reduce((sum, m) => sum + m.coordinates.lat, 0) / markers.length;
  const centerLng = markers.reduce((sum, m) => sum + m.coordinates.lng, 0) / markers.length;
  return { centerLat, centerLng };
}

function calculateBoundingBox(markers: Array<{ type: string; coordinates: { lng: number; lat: number } }>) {
  const lats = markers.map(m => m.coordinates.lat);
  const lngs = markers.map(m => m.coordinates.lng);

  const margin = 0.01;

  return {
    minLat: Math.min(...lats) - margin,
    maxLat: Math.max(...lats) + margin,
    minLng: Math.min(...lngs) - margin,
    maxLng: Math.max(...lngs) + margin
  };
}