import fetch from 'node-fetch';

export interface PopulationData {
  totalPopulation: number;
  density: number; // people per km²
  ageDistribution: {
    under18: number;
    age18to65: number;
    over65: number;
  };
  workingPopulation: number;
  estimatedVehicles: number;
  peakHourFactor: number;
  dataSource: 'worldpop' | 'japanFallback' | 'estimate';
}

/**
 * Get population density data for Japan and fallback to WorldPop or estimation
 */
export async function getPopulationData(
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }
): Promise<PopulationData> {
  try {
    console.log('Fetching population data...');

    const areaKm2 = calculateArea(bbox);
    let populationData = await getWorldPopData(bbox);

    if (populationData) {
      populationData.dataSource = 'worldpop';
      return populationData;
    }

    if (isJapanLocation(bbox)) {
      populationData = await getJapanStatsData(bbox, areaKm2);
      if (populationData) {
        populationData.dataSource = 'japanFallback';
        return populationData;
      }
    }

    const fallback = estimatePopulationData(bbox, areaKm2);
    fallback.dataSource = 'estimate';
    return fallback;

  } catch (error) {
    console.error('Population data fetch error:', error);
    const fallback = estimatePopulationData(bbox, 10);
    fallback.dataSource = 'estimate';
    return fallback;
  }
}

async function getWorldPopData(bbox: any): Promise<PopulationData | null> {
  try {
    const response = await fetch(
      `https://api.worldpop.org/v1/services/stats?` +
      `dataset=wpgp-population-density&` +
      `bbox=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}&` +
      `year=2020`
    );

    if (!response.ok) return null;

      const data = await response.json() as any;
      if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
        const population = data.data[0]?.total_population || 0;
        const area = data.data[0]?.area_km2 || 1;
      return calculatePopulationMetrics(population, area);
    }

    return null;
  } catch (error) {
    console.error('WorldPop API error:', error);
    return null;
  }
}

async function getJapanStatsData(bbox: any, area: number): Promise<PopulationData | null> {
  try {
    const centerLat = (bbox.minLat + bbox.maxLat) / 2;
    const centerLng = (bbox.minLng + bbox.maxLng) / 2;

    let baseDensity = 300;

    if (isNearMajorCity(centerLat, centerLng)) {
      baseDensity = 15000;
    } else if (isUrbanArea(centerLat, centerLng)) {
      baseDensity = 4000;
    } else {
      baseDensity = 400;
    }

    const totalPopulation = baseDensity * area;
    return calculatePopulationMetrics(totalPopulation, area);
  } catch (error) {
    console.error('Japan fallback error:', error);
    return null;
  }
}

function calculatePopulationMetrics(totalPopulation: number, areaKm2: number): PopulationData {
  const density = totalPopulation / areaKm2;

  // Updated Japanese age distribution (2023 est.)
  const ageDistribution = {
    under18: Math.round(totalPopulation * 0.13),
    age18to65: Math.round(totalPopulation * 0.59),
    over65: Math.round(totalPopulation * 0.28)
  };

  const workingPopulation = ageDistribution.age18to65;

  // Japan vehicle ownership logic
  const vehicleOwnershipRate =
    density > 5000 ? 0.3 :
    density > 1000 ? 0.5 :
    0.7;

  const estimatedVehicles = Math.round(totalPopulation * vehicleOwnershipRate);

  const peakHourFactor =
    density > 5000 ? 0.15 :
    density > 1000 ? 0.12 :
    0.08;

  return {
    totalPopulation: Math.round(totalPopulation),
    density: Math.round(density),
    ageDistribution,
    workingPopulation,
    estimatedVehicles,
    peakHourFactor,
    dataSource: 'estimate' // Will be overwritten by caller
  };
}

function estimatePopulationData(bbox: any, areaKm2: number): PopulationData {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const centerLng = (bbox.minLng + bbox.maxLng) / 2;

  let baseDensity = 100;

  if (isNearMajorCity(centerLat, centerLng)) {
    baseDensity = 15000;
  } else if (isUrbanArea(centerLat, centerLng)) {
    baseDensity = 4000;
  } else {
    baseDensity = isWithinDistance(centerLat, centerLng, 30) ? 800 : 300;
  }

  baseDensity *= (0.8 + Math.random() * 0.4); // add some noise
  const totalPopulation = baseDensity * areaKm2;

  return calculatePopulationMetrics(totalPopulation, areaKm2);
}

function isJapanLocation(bbox: any): boolean {
  return bbox.minLat >= 24 && bbox.maxLat <= 46 &&
         bbox.minLng >= 123 && bbox.maxLng <= 146;
}

function isUrbanArea(lat: number, lng: number): boolean {
  const cities = [
    { lat: 35.6762, lng: 139.6503, radius: 0.6 },
    { lat: 34.6937, lng: 135.5023, radius: 0.4 },
    { lat: 35.1815, lng: 136.9066, radius: 0.3 },
    { lat: 43.0642, lng: 141.3469, radius: 0.3 },
    { lat: 38.2682, lng: 140.8694, radius: 0.2 },
    { lat: 36.3943, lng: 140.4467, radius: 0.2 },
    { lat: 35.4437, lng: 139.6380, radius: 0.3 },
    { lat: 34.3853, lng: 132.4553, radius: 0.2 },
    { lat: 33.5904, lng: 130.4017, radius: 0.3 },
    { lat: 35.0116, lng: 135.7681, radius: 0.2 },
    { lat: 34.6851, lng: 135.8048, radius: 0.2 },
    { lat: 26.2124, lng: 127.6792, radius: 0.2 },
  ];

  return cities.some(city =>
    Math.abs(lat - city.lat) < city.radius && Math.abs(lng - city.lng) < city.radius
  );
}

function isNearMajorCity(lat: number, lng: number): boolean {
  const megaCities = [
    { lat: 35.6762, lng: 139.6503, radius: 0.8 },
    { lat: 34.6937, lng: 135.5023, radius: 0.5 },
    { lat: 35.1815, lng: 136.9066, radius: 0.3 },
  ];

  return megaCities.some(city =>
    Math.abs(lat - city.lat) < city.radius && Math.abs(lng - city.lng) < city.radius
  );
}

function isWithinDistance(lat: number, lng: number, distanceKm: number): boolean {
  const urbanCenters = [
    { lat: 35.6762, lng: 139.6503 },
    { lat: 34.6937, lng: 135.5023 },
    { lat: 35.1815, lng: 136.9066 },
    { lat: 43.0642, lng: 141.3469 },
    { lat: 38.2682, lng: 140.8694 },
    { lat: 35.4437, lng: 139.6380 },
    { lat: 34.3853, lng: 132.4553 },
    { lat: 33.5904, lng: 130.4017 },
    { lat: 35.0116, lng: 135.7681 },
    { lat: 34.6851, lng: 135.8048 },
  ];

  return urbanCenters.some(center => {
    const distance = calculateDistance(lat, lng, center.lat, center.lng);
    return distance <= distanceKm;
  });
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateArea(bbox: any): number {
  const latDistance = (bbox.maxLat - bbox.minLat) * 111;
  const lngDistance = (bbox.maxLng - bbox.minLng) * 111 *
    Math.cos(((bbox.minLat + bbox.maxLat) / 2) * Math.PI / 180);
  return latDistance * lngDistance;
}