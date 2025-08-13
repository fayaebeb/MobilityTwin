import { NetworkData, OSMRoad, getRoadCapacity, getFreeFlowSpeed } from './osm-network';
import { TrafficData } from './tomtom-traffic';
import { PopulationData } from './population-data';
import type { SimulationMetrics } from '@shared/schema';
import { densify } from '../utils/densifyRoute';
import { lineString } from '@turf/helpers';
import type { Position } from 'geojson';
import along from '@turf/along';
import length from '@turf/length';
import bearing from '@turf/bearing';
import type { LineString } from 'geojson';

export interface SUMOVehicle {
  id: string;
  route: string[];                   // edge IDs
  departTime: number;
  arrivalTime?: number;
  speed: number;
  emissions: number;
  position?: [number, number];
  heading?: number;
  routeProgress?: number;
  routeCoordinates?: [number, number][]; // polyline coordinates
  distanceTraveled?: number;        // meters
  currentEdgeProgress?: number;     // 0-1
  totalRouteLength?: number;        // meters
  line?: LineString;
  lineLength?: number;              // kilometers (turf length)
}

export interface SUMOEdge {
  id: string;
  from: string;
  to: string;
  lanes: number;
  speed: number;
  length: number;  // meters
  capacity: number;
}

export interface SimulationState {
  time: number;
  vehicles: SUMOVehicle[];
  totalDistance: number;
  totalEmissions: number;
  congestionLength: number;
  averageSpeed: number;
}

export class RealTrafficSimulation {
  private network: NetworkData;
  private trafficData: TrafficData;
  private populationData: PopulationData;
  private edges: SUMOEdge[];
  private vehicles: SUMOVehicle[];
  private simulationTime: number;
  private edgeMap = new Map<string, SUMOEdge>();
  private edgesFromMap = new Map<string, SUMOEdge[]>();
  private routeCache = new Map<string, string[]>();
  private debug = false;

  private pickFarEdge(origin: SUMOEdge, minDistance = 2000): SUMOEdge {
    let dest: SUMOEdge;
    do {
      dest = this.edges[Math.floor(Math.random() * this.edges.length)];
    } while (
      dest.id === origin.id ||
      this.haversineDistance(
        this.network.roads.find(r => r.id === origin.id)!.geometry[0],
        this.network.roads.find(r => r.id === dest.id)!.geometry[0]
      ) < minDistance
    );
    return dest;
  }

  private affectedEdgesSet = new Set<string>();
  public getAffectedEdgeCount(): number {
    return this.affectedEdgesSet.size;
  }
  public getVehicles() {
    return this.vehicles;
  }
  private constructionLogs: Array<{
    edgeId: string;
    originalSpeed: number;
    reducedSpeed: number;
  }> = [];

  private liveDataCallback?: (data: any) => void;

  public setLiveDataCallback(callback: (data: any) => void) {
    this.liveDataCallback = callback;
  }

  private sendLiveData(currentTime: number, activeVehicles: number, averageSpeed: number) {
    if (!this.liveDataCallback) return;

    const vehiclePositions = this.getActiveVehiclePositions(currentTime);
    const congestionSegments = this.getCongestionSegments();

    const liveData = {
      timestamp: currentTime,
      vehicles: vehiclePositions,
      congestionSegments,
      totalVehicles: activeVehicles,
      averageSpeed: Math.round(averageSpeed * 10) / 10
    };

    if (currentTime % 60 === 0) {
      console.log(`[LIVE DATA] t=${currentTime}s: ${vehiclePositions.length} vehicles, avg speed: ${liveData.averageSpeed}km/h`);
    }

    this.liveDataCallback(liveData);
  }

  private getActiveVehiclePositions(currentTime: number) {
    const activeVehicles = this.vehicles
      .filter(vehicle => vehicle.departTime <= currentTime && !vehicle.arrivalTime)
      .slice(0, 50);

    if (this.debug && currentTime % 100 === 0 && activeVehicles.length > 0) {
      console.log(`\n=== Position Accuracy Check (t=${currentTime}s) ===`);
      activeVehicles.slice(0, 3).forEach(vehicle => {
        const progressPct = (vehicle.routeProgress || 0) * 100;
        const traveled = vehicle.distanceTraveled || 0;
        const routeLen = vehicle.totalRouteLength || 0;
        console.log(`${vehicle.id}: ${traveled.toFixed(0)}m / ${routeLen.toFixed(0)}m (${progressPct.toFixed(1)}%), Speed: ${vehicle.speed.toFixed(1)}km/h`);
      });
    }

    return activeVehicles.map(vehicle => {
      // Multi-edge route with full geometry
      if (vehicle.routeCoordinates && vehicle.routeCoordinates.length >= 2 && vehicle.totalRouteLength && vehicle.totalRouteLength > 0) {
        const routeProgress = Math.min(1, (vehicle.distanceTraveled || 0) / vehicle.totalRouteLength);
        const position = this.interpolatePosition(vehicle, routeProgress);
        const heading = this.calculateHeading(vehicle, routeProgress);

        vehicle.routeProgress = routeProgress;

        return {
          id: vehicle.id,
          coordinates: position as [number, number],
          speed: vehicle.speed,
          heading,
          routeProgress,
          distanceTraveled: vehicle.distanceTraveled || 0,
          // keep 'route' for backward compatibility as coordinates
          route: vehicle.routeCoordinates,
          // provide explicit fields
          routeCoordinates: vehicle.routeCoordinates,
          edgeIds: vehicle.route
        };
      }

      // Single-edge fallback
      const currentEdgeId = vehicle.route[0];
      const road = this.network.roads.find(r => r.id === currentEdgeId);
      if (!road || road.geometry.length === 0) {
        return null;
      }

      const coords = road.geometry.map(p => [p.lng, p.lat] as [number, number]);
      const line = lineString(coords);
      const totalKm = length(line, { units: 'kilometers' });

      const routeProgress = Math.min(1, vehicle.currentEdgeProgress || 0);
      const point = along(line, totalKm * routeProgress, { units: 'kilometers' });
      const nextPoint = along(line, totalKm * Math.min(routeProgress + 0.001, 1), { units: 'kilometers' });

      const position = point.geometry.coordinates as [number, number];
      const head = bearing(point.geometry.coordinates as Position, nextPoint.geometry.coordinates as Position);

      vehicle.routeProgress = routeProgress;

      return {
        id: vehicle.id,
        coordinates: position,
        speed: vehicle.speed,
        heading: head,
        routeProgress,
        distanceTraveled: vehicle.distanceTraveled || 0,
        // keep 'route' for backward compatibility as coordinates
        route: coords,
        // provide explicit fields
        routeCoordinates: coords,
        edgeIds: vehicle.route
      };
    })
    .filter(Boolean);
  }

  private getCongestionSegments() {
    const congestionSegments: Array<{coordinates: [number, number][], level: 'high' | 'medium' | 'low'}> = [];

    for (const edge of this.edges) {
      const road = this.network.roads.find(r => r.id === edge.id);
      if (!road || road.geometry.length === 0) continue;

      const vehicleCount = this.vehicles.reduce((acc, vehicle) =>
        (vehicle.route[0] === edge.id && vehicle.departTime <= this.simulationTime && !vehicle.arrivalTime) ? acc + 1 : acc
      , 0);

      const utilization = vehicleCount / Math.max(1, edge.capacity / 3600);

      let level: 'high' | 'medium' | 'low' | null = null;
      if (utilization > 0.8) level = 'high';
      else if (utilization > 0.5) level = 'medium';
      else if (utilization > 0.3) level = 'low';

      if (level) {
        congestionSegments.push({
          coordinates: road.geometry.map(point => [point.lng, point.lat] as [number, number]),
          level
        });
      }
    }

    return congestionSegments.slice(0, 20);
  }

  private interpolatePosition(vehicle: SUMOVehicle, progress: number): [number, number] {
    if (!vehicle.line || !vehicle.lineLength || vehicle.lineLength === 0) {
      return vehicle.routeCoordinates?.[0] ?? [0, 0];
    }
    const point = along(vehicle.line, vehicle.lineLength * progress, { units: 'kilometers' });
    return point.geometry.coordinates as [number, number];
  }

  private calculateHeading(vehicle: SUMOVehicle, progress: number): number {
    if (!vehicle.line || !vehicle.lineLength) return 0;
    const p1 = along(vehicle.line, vehicle.lineLength * progress, { units: 'kilometers' }).geometry.coordinates as Position;
    const p2 = along(vehicle.line, vehicle.lineLength * Math.min(progress + 0.001, 1), { units: 'kilometers' }).geometry.coordinates as Position;
    return bearing(p1, p2);
  }

  public getConstructionImpacts() {
    return this.constructionLogs;
  }

  constructor(
    network: NetworkData,
    trafficData: TrafficData,
    populationData: PopulationData
  ) {
    this.network = network;
    this.trafficData = trafficData;
    this.populationData = populationData;
    this.edges = this.buildRoadNetwork();
    this.vehicles = [];
    this.simulationTime = 0;
  }

  async simulate(
    markers: Array<{ type: string; coordinates: { lng: number; lat: number } }>,
    simulationDurationMinutes: number = 60
  ): Promise<SimulationMetrics> {
    console.log('Starting advanced traffic simulation...');

    this.applyMarkerImpacts(markers);
    const vehicleDemand = this.generateVehicleDemand();
    this.generateVehicleTrips(vehicleDemand);
    const finalState = this.runMicrosimulation(simulationDurationMinutes);
    return this.calculateMetrics(finalState);
  }

  private buildRoadNetwork(): SUMOEdge[] {
    const edges: SUMOEdge[] = [];

    this.network.roads.forEach((road) => {
      if (road.geometry.length < 2) return;

      const highway = road.tags.highway || 'unclassified';
      const lanes = parseInt(road.tags.lanes || '1');
      const maxSpeed = getFreeFlowSpeed(highway);
      const capacity = getRoadCapacity(highway) * lanes;
      const lengthM = this.calculateRoadLength(road.geometry);

      const edge: SUMOEdge = {
        id: road.id,
        from: road.nodes[0].toString(),
        to: road.nodes[road.nodes.length - 1].toString(),
        lanes,
        speed: maxSpeed,
        length: lengthM,
        capacity
      };

      edges.push(edge);
      this.edgeMap.set(edge.id, edge);

      if (!this.edgesFromMap.has(edge.from)) {
        this.edgesFromMap.set(edge.from, []);
      }
      this.edgesFromMap.get(edge.from)!.push(edge);
    });

    console.log(`Built road network with ${edges.length} edges`);
    return edges;
  }

  private applyMarkerImpacts(markers: Array<{ type: string; coordinates: { lng: number; lat: number } }>) {
    const affectedEdges = new Set<string>();
    const processedFacilities = new Set<string>();

    markers.forEach((marker) => {
      const nearbyEdges = this.findNearbyEdges(marker.coordinates, 0.5); // 500m radius

      if (marker.type === 'construction') {
        nearbyEdges.forEach((edge) => {
          if (!affectedEdges.has(edge.id)) {
            const originalSpeed = edge.speed;

            edge.speed = Math.max(5, originalSpeed * 0.4);
            edge.capacity = Math.max(50, edge.capacity * 0.6);

            if (Math.random() < 0.05) {
              edge.capacity = 10;
              edge.speed = 5;
            }

            this.constructionLogs.push({
              edgeId: edge.id,
              originalSpeed,
              reducedSpeed: edge.speed
            });

            affectedEdges.add(edge.id);
            console.log(`  Construction impact on edge ${edge.id}: speed ${originalSpeed} -> ${edge.speed} km/h`);
          }
        });
      } else if (marker.type === 'facility') {
        const facilityKey = `${marker.coordinates.lng.toFixed(6)},${marker.coordinates.lat.toFixed(6)}`;
        if (!processedFacilities.has(facilityKey)) {
          const nearbyDemand = this.calculateFacilityTrafficGeneration(marker.coordinates);
          this.addFacilityTraffic(marker.coordinates, nearbyDemand);
          processedFacilities.add(facilityKey);
        }
      }
    });

    console.log(`Applied impacts from ${markers.length} markers to road network (${affectedEdges.size} edges affected, ${processedFacilities.size} facilities processed)`);
    this.affectedEdgesSet = affectedEdges;
  }

  private generateVehicleDemand(): number {
    const baseVehicles = this.populationData.estimatedVehicles * this.populationData.peakHourFactor;

    const trafficMultiplier = this.trafficData.congestionLevel === 'SEVERE' ? 1.3 :
                              this.trafficData.congestionLevel === 'HIGH' ? 1.2 :
                              this.trafficData.congestionLevel === 'MEDIUM' ? 1.1 : 1.0;

    const rawDemand = Math.round(baseVehicles * trafficMultiplier);
    const totalDemand = Math.min(rawDemand, 500);

    console.log(`Generated vehicle demand: ${totalDemand} vehicles (capped from ${rawDemand}) based on population of ${this.populationData.totalPopulation}`);
    return totalDemand;
  }

  private generateVehicleTrips(vehicleCount: number) {
    this.vehicles = [];

    for (let i = 0; i < vehicleCount; i++) {
      const departTime = Math.random() * 2400;

      const originEdge = this.edges[Math.floor(Math.random() * this.edges.length)];
      const destEdge = this.pickFarEdge(originEdge);

      let route = [originEdge.id];
      if (originEdge.id !== destEdge.id) {
        const fullRoute = this.findSimpleRoute(originEdge.id, destEdge.id);
        route = fullRoute.length > 0 ? fullRoute : [originEdge.id];
      }

      const routeCoordinates: [number, number][] = [];
      let totalRouteLength = 0;

      for (const edgeId of route) {
        const road = this.network.roads.find(r => r.id === edgeId);
        if (road && road.geometry.length > 1) {
          const rawCoords = road.geometry.map(pt => [pt.lng, pt.lat] as [number, number]);
          const coords = densify(rawCoords, 5);
          if (routeCoordinates.length > 0) coords.shift();
          routeCoordinates.push(...coords);

          const edge = this.edgeMap.get(edgeId);
          if (edge) {
            totalRouteLength += edge.length;
          }
        }
      }

      if (totalRouteLength < 200) continue;

      const initialSpeed = originEdge ? Math.max(15, originEdge.speed * (0.6 + Math.random() * 0.4)) : 25;
      const lineFeature = lineString(routeCoordinates);
      const line = lineFeature.geometry;
      const lineLength = length(lineFeature, { units: 'kilometers' });

      this.vehicles.push({
        id: `vehicle_${i}`,
        route,
        departTime,
        speed: initialSpeed,
        emissions: 0,
        distanceTraveled: 0,
        currentEdgeProgress: 0,
        routeCoordinates,
        routeProgress: 0,
        totalRouteLength,
        line,
        lineLength
      });
    }

    const avgLen = this.vehicles.reduce((s,v)=>s+(v.totalRouteLength||0),0)/Math.max(1,this.vehicles.length);
    console.log(`Created ${this.vehicles.length} vehicle trips`);
    console.log(`Avg planned route = ${(avgLen/1000).toFixed(2)} km`);

    if (this.vehicles.length > 0) {
      console.log(`  Sample vehicles:`)
      for (let i = 0; i < Math.min(3, this.vehicles.length); i++) {
        const v = this.vehicles[i];
        console.log(`    ${v.id}: speed=${v.speed}km/h, route=[${v.route.slice(0,3).join(',')}${v.route.length > 3 ? '...' : ''}] (${v.route.length} edges)`);
      }
    }
  }

  private runMicrosimulation(durationMinutes: number): SimulationState {
    const maxTime = durationMinutes * 60;
    let t = 0;

    let totalDistance = 0;
    let totalEmissions = 0;
    let congestionLength = 0;
    let speedSum = 0;
    let speedCount = 0;
    let activeVehicleCount = 0;

    console.log(`Starting ${durationMinutes} minute microsimulation with ${this.vehicles.length} vehicles...`);

    while (t < maxTime) {
      this.simulationTime = t;
      let currentActiveVehicles = 0;

      for (const vehicle of this.vehicles) {
        if (vehicle.departTime <= t && !vehicle.arrivalTime) currentActiveVehicles++;
      }

      const step = currentActiveVehicles > 100 ? 1 : 10;

      for (const vehicle of this.vehicles) {
        if (vehicle.departTime <= t && !vehicle.arrivalTime) {
          this.updateVehicle(vehicle, t, step);

          if (t % 10 === 0) {
            totalEmissions += this.calculateVehicleEmissions(vehicle);
          }

          speedSum += vehicle.speed;
          speedCount++;
        }
      }

      activeVehicleCount = Math.max(activeVehicleCount, currentActiveVehicles);
      totalDistance = this.vehicles.reduce((sum, v) => sum + (v.distanceTraveled || 0), 0) / 1000;

      if (t % 300 === 0) {
        congestionLength += this.calculateCongestionLength();
      }

      if (this.liveDataCallback && t % 10 === 0) {
        this.sendLiveData(t, currentActiveVehicles, speedSum / Math.max(speedCount, 1));
      }

      if (t > 0 && t % 600 === 0) {
        const avgVehicleDistance = this.vehicles.reduce((sum, v) => sum + (v.distanceTraveled || 0), 0) / Math.max(1,this.vehicles.length) / 1000;
        console.log(`  Time ${Math.round(t/60)}min: ${currentActiveVehicles} active vehicles, ${Math.round(totalDistance)}km total, ${avgVehicleDistance.toFixed(1)}km avg per vehicle`);
      }

      t += step;
    }

    return {
      time: this.simulationTime,
      vehicles: this.vehicles,
      totalDistance,
      totalEmissions,
      congestionLength: congestionLength / (durationMinutes / 5),
      averageSpeed: speedCount > 0 ? speedSum / speedCount : 0
    };
  }

  private updateVehicle(vehicle: SUMOVehicle, currentTime: number, timeStep: number = 10) {
    if (vehicle.route.length === 0) return;

    const currentEdgeId = vehicle.route[0];
    const edge = this.edgeMap.get(currentEdgeId);
    if (!edge) return;

    const trafficFlow = this.trafficData.flows.find(f =>
      this.isNearEdge(f.coordinates, edge)
    );

    let targetSpeed = edge.speed;
    if (trafficFlow) {
      targetSpeed = Math.min(edge.speed, trafficFlow.currentSpeed);
    }

    const edgeVehicles = this.vehicles.reduce((count, v) =>
      (v.route[0] === currentEdgeId && v.departTime <= currentTime && !v.arrivalTime) ? count + 1 : count
    , 0);

    const utilization = edgeVehicles / Math.max(1, edge.capacity / 3600);
    if (utilization > 0.7) {
      const congestionFactor = Math.max(0.1, 1 - (utilization - 0.7) * 0.5);
      targetSpeed *= congestionFactor;
    }

    const speedDiff = targetSpeed - vehicle.speed;
    vehicle.speed += speedDiff * 0.2;
    vehicle.speed = Math.max(0, vehicle.speed);
    if (targetSpeed > 0 && vehicle.speed < 5) {
      vehicle.speed = Math.max(5, targetSpeed * 0.3);
    }

    if (vehicle.distanceTraveled === undefined) vehicle.distanceTraveled = 0;
    if (vehicle.currentEdgeProgress === undefined) vehicle.currentEdgeProgress = 0;

    if (vehicle.speed > 0) {
      const distanceThisStep = (vehicle.speed * timeStep) / 3.6; // meters
      if (edge && edge.length > 0) {
        const remainingEdgeDistance = edge.length * (1 - vehicle.currentEdgeProgress);
        if (distanceThisStep >= remainingEdgeDistance) {
          vehicle.distanceTraveled += remainingEdgeDistance;
          vehicle.route.shift();
          vehicle.currentEdgeProgress = 0;

          if (vehicle.route.length === 0) {
            vehicle.arrivalTime = currentTime;
          } else {
            const remainingDistance = distanceThisStep - remainingEdgeDistance;
            const nextEdge = this.edgeMap.get(vehicle.route[0]);
            if (nextEdge && nextEdge.length > 0) {
              vehicle.currentEdgeProgress = Math.min(0.95, remainingDistance / nextEdge.length);
            }
          }
        } else {
          vehicle.distanceTraveled += distanceThisStep;
          vehicle.currentEdgeProgress += distanceThisStep / edge.length;
          vehicle.currentEdgeProgress = Math.min(0.95, vehicle.currentEdgeProgress);
        }
      }
    }

    if (this.debug && currentTime < 100 && vehicle.speed === 0) {
      console.log(`Debug: Vehicle ${vehicle.id} stuck. Target=${targetSpeed.toFixed(1)} km/h, Edge=${edge.id}, Cap=${edge.capacity}, RouteLen=${vehicle.route.length}`);
    }
  }

  private calculateMetrics(finalState: SimulationState): SimulationMetrics {
    const variance = (Math.random() - 0.5) * 0.1;

    const totalDistance = Math.round(finalState.totalDistance * (1 + variance));
    const congestionLength = Math.round(finalState.congestionLength * 10) / 10;
    const emissionsInGrams = Math.round(finalState.totalEmissions * 1000 * (1 + variance));

    console.log(`Simulation complete: ${totalDistance}km total distance, ${congestionLength}km congestion, ${emissionsInGrams}kg CO₂ emissions`);

    return {
      driving_distance: `${totalDistance} km`,
      congestion_length: `${congestionLength} km`,
      co2_emissions: `${emissionsInGrams} kg`
    };
  }

  // Helpers
  private calculateRoadLength(geometry: Array<{ lat: number; lng: number }>): number {
    let lengthM = 0;
    for (let i = 1; i < geometry.length; i++) {
      lengthM += this.haversineDistance(geometry[i-1], geometry[i]);
    }
    return lengthM;
  }

  private haversineDistance(coord1: { lat: number; lng: number }, coord2: { lat: number; lng: number }): number {
    const R = 6371000;
    const lat1Rad = coord1.lat * Math.PI / 180;
    const lat2Rad = coord2.lat * Math.PI / 180;
    const deltaLat = (coord2.lat - coord1.lat) * Math.PI / 180;
    const deltaLng = (coord2.lng - coord1.lng) * Math.PI / 180;

    const a = Math.sin(deltaLat/2) ** 2 +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(deltaLng/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  private findNearbyEdges(coordinates: { lng: number; lat: number }, radiusKm: number): SUMOEdge[] {
    return this.edges.filter(edge => {
      const road = this.network.roads.find(r => r.id === edge.id);
      if (!road || road.geometry.length === 0) return false;
      const distance = this.haversineDistance(coordinates, road.geometry[0]);
      return distance <= radiusKm * 1000;
    });
  }

  private calculateFacilityTrafficGeneration(_coordinates: { lng: number; lat: number }): number {
    const populationInArea = this.populationData.density * 4; // 2km radius area
    const additionalVehicles = Math.round(populationInArea * 0.05);
    const cappedVehicles = Math.min(additionalVehicles, 100);
    console.log(`Facility traffic generation: ${cappedVehicles} vehicles (uncapped: ${additionalVehicles})`);
    return cappedVehicles;
  }

  private addFacilityTraffic(coordinates: { lng: number; lat: number }, additionalVehicles: number) {
    const nearbyEdges = this.findNearbyEdges(coordinates, 0.2);
    if (nearbyEdges.length === 0) return;

    console.log(`Adding ${additionalVehicles} facility trips to ${nearbyEdges.length} nearby edges`);

    for (let i = 0; i < additionalVehicles; i++) {
      const outEdge = nearbyEdges[Math.floor(Math.random() * nearbyEdges.length)];
      const backEdge = this.pickFarEdge(outEdge, 1000);
      const facilityRoute = this.findSimpleRoute(outEdge.id, backEdge.id);

      const routeCoordinates: [number, number][] = [];
      let totalRouteLength = 0;

      for (const edgeId of facilityRoute) {
        const road = this.network.roads.find(r => r.id === edgeId);
        if (road && road.geometry.length > 1) {
          const rawCoords = road.geometry.map(pt => [pt.lng, pt.lat] as [number, number]);
          const coords = densify(rawCoords, 5);
          if (routeCoordinates.length > 0) coords.shift();
          routeCoordinates.push(...coords);
          const edge = this.edgeMap.get(edgeId);
          if (edge) totalRouteLength += edge.length;
        }
      }

      const lineFeature = lineString(routeCoordinates);
      const line = lineFeature.geometry;
      const lineLength = length(lineFeature, { units: 'kilometers' });

      this.vehicles.push({
        id: `facility_trip_${i}`,
        route: facilityRoute,
        departTime: Math.random() * 3600,
        speed: Math.max(10, outEdge.speed * 0.6),
        emissions: 0,
        distanceTraveled: 0,
        currentEdgeProgress: 0,
        routeCoordinates,
        routeProgress: 0,
        totalRouteLength,
        line,
        lineLength
      });
    }
  }

  private findSimpleRoute(originEdgeId: string, destEdgeId: string): string[] {
    const cacheKey = `${originEdgeId}->${destEdgeId}`;
    if (this.routeCache.has(cacheKey)) return this.routeCache.get(cacheKey)!;

    const originEdge = this.edgeMap.get(originEdgeId);
    const destEdge   = this.edgeMap.get(destEdgeId);
    if (!originEdge || !destEdge) return [originEdgeId];

    const MIN_METERS = 4_000 + Math.random() * 4_000;
    const MAX_STEPS  = 200;

    const route   : string[] = [originEdgeId];
    const visited = new Set<string>([originEdgeId]);
    let current   = originEdge.to;
    let cumLength = originEdge.length;

    while (cumLength < MIN_METERS && route.length < MAX_STEPS) {
      let nextEdges = this.edgesFromMap.get(current) || [];
      nextEdges = nextEdges.filter(e => !visited.has(e.id));

      if (nextEdges.length === 0) {
        const jump = this.pickFarEdge(this.edgeMap.get(route.at(-1)!)!, 1_000);
        route.push(jump.id);
        visited.add(jump.id);
        cumLength += jump.length;
        current = jump.to;
        continue;
      }

      const next = nextEdges[Math.floor(Math.random() * nextEdges.length)];
      route.push(next.id);
      visited.add(next.id);
      cumLength += next.length;
      current = next.to;
    }

    if (current !== destEdge.from) {
      route.push(destEdgeId);
      cumLength += destEdge.length;
    }

    if (cumLength < MIN_METERS) {
      return this.findSimpleRoute(destEdgeId, originEdgeId);
    }

    this.routeCache.set(cacheKey, route);
    return route;
  }

  private calculateVehicleEmissions(vehicle: SUMOVehicle): number {
    const speed = vehicle.speed;
    if (speed <= 0) return 0;

    let emissionFactor = 120; // g/km

    if (speed < 20) emissionFactor *= 1.6;
    else if (speed < 40) emissionFactor *= 1.2;
    else if (speed > 80) emissionFactor *= 1.3;

    const distanceKm = speed / 3600;
    const emissionsGrams = emissionFactor * distanceKm;
    return emissionsGrams / 1000;
  }

  private calculateCongestionLength(): number {
    let congestionLength = 0;

    this.edges.forEach(edge => {
      const vehiclesOnEdge = this.vehicles.filter(v =>
        v.route[0] === edge.id && v.departTime <= this.simulationTime && !v.arrivalTime
      );

      const utilization = vehiclesOnEdge.length / (edge.capacity / 3600);
      if (utilization > 0.7) {
        congestionLength += edge.length;
      }
    });

    return congestionLength / 1000;
  }

  private isNearEdge(coordinates: Array<{ lat: number; lng: number }>, edge: SUMOEdge): boolean {
    if (coordinates.length === 0) return false;

    const road = this.network.roads.find(r => r.id === edge.id);
    if (!road || road.geometry.length === 0) return false;

    const distance = this.haversineDistance(coordinates[0], road.geometry[0]);
    return distance < 1000; // 1km
  }
}