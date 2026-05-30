/* ════════════════════════════════════════════════════════════════════════
 * [BUILDINGS] — OpenStreetMap building footprints via Overpass (Step 4)
 * ────────────────────────────────────────────────────────────────────────
 * Fetches building polygons (with a height in metres) for a map bounding box,
 * for the shadow calculation. (Business names come from Barcelona open data —
 * see src/lib/census.ts — not from OSM.)
 *
 * Overpass is a free public API — it can be slow or rate-limit (429/5xx), so
 * requests retry with exponential backoff AND rotate across public mirrors.
 * CORS is allowed on these endpoints, so we fetch from the browser directly.
 * ════════════════════════════════════════════════════════════════════════ */

// Public Overpass mirrors (all CORS-enabled). We rotate through them on retry.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const MAX_ATTEMPTS = 3; // total tries across endpoints
const BASE_BACKOFF_MS = 600; // exponential backoff: ~600ms, ~1200ms, …

const LEVEL_HEIGHT_M = 3; // metres per floor when only building:levels is known
const DEFAULT_BUILDING_HEIGHT_M = 15; // Barcelona median (Eixample-ish)
// TODO v2: replace default height with Barcelona cadastre data for per-building accuracy.

export type BBox = { south: number; west: number; north: number; east: number };

/** A building footprint Turf can intersect, carrying its height in metres. */
export type BuildingFeature = GeoJSON.Feature<GeoJSON.Polygon, { height: number }>;

// Minimal shape of an Overpass element (the bits we read).
type OverpassElement = {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Shared Overpass POST: retries with backoff, rotating across mirrors. */
async function overpassRequest(query: string): Promise<{ elements?: OverpassElement[] }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, { method: "POST", body: "data=" + encodeURIComponent(query) });
      // Overpass signals overload with these — retryable on another mirror.
      if ([429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass busy (${res.status})`);
      if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass: all attempts failed");
}

/** Pull a height in metres from OSM tags, falling back to the default. */
function parseHeight(tags: Record<string, string> = {}): number {
  const height = parseFloat(tags.height);
  if (Number.isFinite(height) && height > 0) return height;

  const buildingHeight = parseFloat(tags["building:height"]);
  if (Number.isFinite(buildingHeight) && buildingHeight > 0) return buildingHeight;

  const levels = parseFloat(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) return levels * LEVEL_HEIGHT_M;

  return DEFAULT_BUILDING_HEIGHT_M;
}

/**
 * Fetch building footprints within `bbox`, with a height in metres each.
 * Throws only if every retry/mirror fails.
 */
export async function fetchBuildings(bbox: BBox): Promise<BuildingFeature[]> {
  // Only `way` buildings (the vast majority); relations are skipped for speed.
  const query =
    `[out:json][timeout:25];` +
    `way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `out geom;`;

  const json = await overpassRequest(query);
  const features: BuildingFeature[] = [];

  for (const el of json.elements ?? []) {
    if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 3) continue;

    const ring: [number, number][] = el.geometry.map((g) => [g.lon, g.lat]);
    // Close the ring if Overpass didn't.
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    if (ring.length < 4) continue; // need a valid polygon ring

    features.push({
      type: "Feature",
      id: el.id,
      properties: { height: parseHeight(el.tags) },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  return features;
}
