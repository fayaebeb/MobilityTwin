import { extractRoadNetwork as fetchFromOSM } from './osm-network';

type CacheEntry = { timestamp: number; data: any };
const cache = new Map<string, CacheEntry>();
const TTL = 10 * 60 * 1000; // 10 minutes

function generateCacheKey(lat: number, lng: number, radius: number): string {
  return `roadnet:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
}

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > TTL;
}

export async function extractRoadNetworkCached(
  lat: number,
  lng: number,
  radius: number
) {
  const key = generateCacheKey(lat, lng, radius);
  const entry = cache.get(key);

  if (entry && !isExpired(entry)) {
    console.log('✅ Using cached road network');
    return entry.data;
  }

  console.log('⬇️ Fetching road network from OSM...');
  const data = await fetchFromOSM(lat, lng, radius);
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}
