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

// Public Overpass mirrors — all with GLOBAL coverage + CORS. We rotate through
// them per attempt so a rate-limited or unresponsive mirror falls through to the
// next. NOTE: regional instances (e.g. overpass.osm.ch) are deliberately excluded
// — they host only their own country's data and return zero buildings for
// Barcelona, which would silently mark every terrace as "sun".
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const MAX_ATTEMPTS = 4; // total tries across endpoints (primary mirror gets a 2nd try)
const BASE_BACKOFF_MS = 600; // exponential backoff: ~600ms, ~1200ms, …
// Per-attempt hard cap. Public mirrors sometimes accept the connection but never
// respond (kumi.systems was observed hanging indefinitely), and fetch() has no
// built-in timeout — so without this a single dead mirror hangs the whole shadow
// calculation forever ("Calculando sombras…" never resolves). 15s comfortably
// covers a healthy mirror for our viewport-sized queries while letting the retry
// loop rotate off a stalled one.
const REQUEST_TIMEOUT_MS = 15_000;

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

/** Shared Overpass POST: retries with backoff, rotating across mirrors. Each
 *  attempt is bounded by REQUEST_TIMEOUT_MS so a hung mirror can't stall forever.
 *  An optional `signal` lets the caller cancel a now-stale request (e.g. the user
 *  panned the map); when it fires we bail immediately without burning more mirror
 *  slots — important because Overpass rate-limits per IP. */
async function overpassRequest(
  query: string,
  signal?: AbortSignal
): Promise<{ elements?: OverpassElement[] }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException("Overpass request superseded", "AbortError");
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    // Relay the caller's abort to this attempt's controller.
    const relayAbort = () => controller.abort();
    signal?.addEventListener("abort", relayAbort, { once: true });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      // Overpass signals overload with these — retryable on another mirror.
      if ([429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass busy (${res.status})`);
      if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
      return await res.json();
    } catch (err) {
      // Caller aborted (stale request) → stop entirely; don't waste more slots.
      if (signal?.aborted) throw new DOMException("Overpass request superseded", "AbortError");
      // Otherwise an abort here is our own timeout firing — a clear, retryable error.
      lastError = controller.signal.aborted
        ? new Error(`Overpass timed out after ${REQUEST_TIMEOUT_MS}ms (${endpoint})`)
        : err;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relayAbort);
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
 * Throws only if every retry/mirror fails (or if `signal` aborts the request).
 */
export async function fetchBuildings(bbox: BBox, signal?: AbortSignal): Promise<BuildingFeature[]> {
  // Only `way` buildings (the vast majority); relations are skipped for speed.
  const query =
    `[out:json][timeout:25];` +
    `way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `out geom;`;

  const json = await overpassRequest(query, signal);
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
