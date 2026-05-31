/* ════════════════════════════════════════════════════════════════════════
 * [BUILDINGS] — OpenStreetMap building footprints via Overpass (Step 4)
 * ────────────────────────────────────────────────────────────────────────
 * Fetches building polygons (with a height in metres) for a map bounding box,
 * for the shadow calculation. (Business names come from Barcelona open data —
 * see src/lib/census.ts — not from OSM.)
 *
 * IMPORTANT: we fetch Overpass on the SERVER, not from the browser. Calling the
 * public mirrors directly from the browser failed in production:
 *   • the browser can't set a User-Agent, so overpass-api.de bot-blocks/throttles
 *     it (HTTP 406/503);
 *   • Overpass rate-limits ~4 slots per IP, and concurrent browser requests blew
 *     past that → 503;
 *   • those 5xx error responses carry no CORS header, so the browser surfaced a
 *     bare `TypeError: Failed to fetch` and shadows never loaded.
 * A server-side proxy (`createServerFn`) fixes all of this: it's same-origin (no
 * CORS), sends a descriptive User-Agent, serialises requests, retries/rotates
 * across mirrors, and caches results so we rarely hit Overpass at all.
 * ════════════════════════════════════════════════════════════════════════ */

import { createServerFn } from "@tanstack/react-start";

export type BBox = { south: number; west: number; north: number; east: number };

/** A building footprint Turf can intersect, carrying its height in metres. */
export type BuildingFeature = GeoJSON.Feature<GeoJSON.Polygon, { height: number }>;

/* ─── server-only: everything below runs inside the server function handler ── */

// Public Overpass mirrors — all with GLOBAL coverage. We rotate through them per
// attempt so a rate-limited or unresponsive mirror falls through to the next.
// NOTE: regional instances (e.g. overpass.osm.ch) are excluded — they host only
// their own country's data and return zero buildings for Barcelona.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const MAX_ATTEMPTS = 4; // total tries across endpoints (primary mirror gets a 2nd try)
const BASE_BACKOFF_MS = 600; // exponential backoff: ~600ms, ~1200ms, …
// Per-attempt hard cap. Public mirrors sometimes accept the connection but never
// respond, and fetch() has no built-in timeout — so without this a single dead
// mirror would stall the request. Server-side we can afford a bit longer since a
// neighbourhood query returns more buildings; the client aborts on pan anyway.
const REQUEST_TIMEOUT_MS = 18_000;
// Overpass etiquette asks for a descriptive UA; it also avoids the bot-block that
// generic browser User-Agents hit on overpass-api.de.
const USER_AGENT = "HaySol/1.0 (https://sol-sombre-map.vercel.app; Barcelona terrace sun/shade finder)";
// Reject absurdly large viewports: a city-wide box returns tens of thousands of
// buildings, overwhelming Overpass. The caller should be zoomed in.
const MAX_BBOX_SPAN_DEG = 0.06;

const LEVEL_HEIGHT_M = 3; // metres per floor when only building:levels is known
const DEFAULT_BUILDING_HEIGHT_M = 15; // Barcelona median (Eixample-ish)
// TODO v2: replace default height with Barcelona cadastre data for per-building accuracy.

// Minimal shape of an Overpass element (the bits we read).
type OverpassElement = {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Shared Overpass POST: retries with backoff, rotating across mirrors. Each
 *  attempt is bounded by REQUEST_TIMEOUT_MS so a hung mirror can't stall forever. */
async function overpassRequest(query: string): Promise<{ elements?: OverpassElement[] }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      // Overpass signals overload with these — retryable on another mirror.
      if ([429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass busy (${res.status})`);
      if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = controller.signal.aborted
        ? new Error(`Overpass timed out after ${REQUEST_TIMEOUT_MS}ms (${endpoint})`)
        : err;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250);
    } finally {
      clearTimeout(timer);
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

/** Turn an Overpass response into closed-ring building polygons with heights. */
function parseBuildings(json: { elements?: OverpassElement[] }): BuildingFeature[] {
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

// In-memory cache (per warm server instance). Building footprints are ~static, so
// a long TTL is fine — this shields users from Overpass overload and rate limits.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const buildingsCache = new Map<string, { at: number; data: BuildingFeature[] }>();
const cacheKey = (b: BBox) =>
  `${b.south.toFixed(4)},${b.west.toFixed(4)},${b.north.toFixed(4)},${b.east.toFixed(4)}`;

/** Server-side: cap → cache → Overpass. Throws if the box is too large or every mirror fails. */
async function loadBuildings(bbox: BBox): Promise<BuildingFeature[]> {
  if (bbox.north - bbox.south > MAX_BBOX_SPAN_DEG || bbox.east - bbox.west > MAX_BBOX_SPAN_DEG) {
    throw new Error("Bounding box too large — zoom in to load buildings");
  }

  const key = cacheKey(bbox);
  const hit = buildingsCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  // Only `way` buildings (the vast majority); relations are skipped for speed.
  const query =
    `[out:json][timeout:25];` +
    `way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `out geom;`;

  const features = parseBuildings(await overpassRequest(query));

  buildingsCache.set(key, { at: Date.now(), data: features });
  if (buildingsCache.size > CACHE_MAX_ENTRIES) {
    buildingsCache.delete(buildingsCache.keys().next().value as string); // drop oldest
  }
  return features;
}

/**
 * Server function: the browser calls this same-origin (no CORS); the handler runs
 * on the server, where it can set a User-Agent, retry, and cache.
 */
const getBuildings = createServerFn({ method: "POST" })
  .inputValidator((bbox: BBox): BBox => {
    const { south, west, north, east } = bbox ?? ({} as BBox);
    if (![south, west, north, east].every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new Error("Invalid bbox");
    }
    return { south, west, north, east };
  })
  .handler(async ({ data }) => loadBuildings(data));

/**
 * Fetch building footprints within `bbox`, with a height in metres each. Calls our
 * own server (no CORS); `signal` cancels a now-stale request (e.g. the user panned).
 * Throws if the box is too large or every mirror fails server-side.
 */
export async function fetchBuildings(bbox: BBox, signal?: AbortSignal): Promise<BuildingFeature[]> {
  return getBuildings({ data: bbox, signal });
}
