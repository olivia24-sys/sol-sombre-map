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
// mirror would stall the request.
//
// Sized to the platform budget: the Vercel function is capped at 60s (see
// vite.config.ts maxDuration), so 4 attempts × 9s + backoff (~50s) stays safely
// inside it AND lets a dead first mirror fall through to a healthy second one
// within ~19s — before the client's own ~21s timeout (see MapView). At 18s the
// second mirror never even got a turn before the client gave up, so a single
// slow primary mirror failed every time. The client aborts on pan regardless.
const REQUEST_TIMEOUT_MS = 9_000;
// Overpass etiquette asks for a descriptive UA; it also avoids the bot-block that
// generic browser User-Agents hit on overpass-api.de.
const USER_AGENT = "HaySol/1.0 (https://sol-sombre-map.vercel.app; Barcelona terrace sun/shade finder)";
// Reject absurdly large viewports: a city-wide box returns tens of thousands of
// buildings, overwhelming Overpass. The caller should be zoomed in.
const MAX_BBOX_SPAN_DEG = 0.06;

// metres per floor when only building:levels is known. Barcelona's older stock
// runs ~3.2–3.6 m floor-to-floor, so 3.2 is a conservative-but-realistic step up
// from a flat 3 (which slightly under-shaded).
const LEVEL_HEIGHT_M = 3.2;
// Flat-roof parapet/rooftop plant the floor count doesn't capture — added once on
// top of a levels-derived height (NOT to a real measured `height`).
const PARAPET_M = 1;
// Last-resort fallback, used only when a building has no height signal of its own
// AND no nearby building with one (see localMedian below). Barcelona median, Eixample-ish.
const DEFAULT_BUILDING_HEIGHT_M = 15;
// Radius for the "local median" fallback: a building with no height/levels of its
// own borrows the median known height of buildings within this distance. ~200 m ≈
// one to two Eixample blocks — close enough to share a built form, wide enough to
// still find donors in sparse outer districts (Nou Barris, etc.).
const NEIGHBOUR_RADIUS_M = 200;
// Used only to project lon→metres when no buildings are present (the projection is
// otherwise centred on the actual data). Barcelona latitude.
const REF_LAT = 41.3851;
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

/**
 * Height in metres from a building's OWN OSM tags, or null if it carries no height
 * signal at all — in which case the caller estimates it from neighbours.
 *
 *   • `height`          — a real measured height; used verbatim (no parapet added).
 *   • `building:levels` — floor count × LEVEL_HEIGHT_M, plus a one-off parapet for
 *                         the flat roof the floor count doesn't include.
 *
 * Note: we deliberately do NOT read `building:height`. It is a non-standard OSM key
 * the dataset never carries (the standard `height`, handled above, is the real one),
 * and a diagnosis of Barcelona buildings confirmed that rung fired 0% of the time —
 * so it only ever returned dead weight. Removed to keep the ladder honest.
 */
function deriveTaggedHeight(tags: Record<string, string> = {}): number | null {
  const height = parseFloat(tags.height);
  if (Number.isFinite(height) && height > 0) return height;

  const levels = parseFloat(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) return levels * LEVEL_HEIGHT_M + PARAPET_M;

  return null;
}

/** Representative point (vertex average) for proximity bucketing — cheap, and
 *  accurate enough for "which buildings are near me". Not the true area centroid.
 *  `ring` is closed (last vertex === first), so we average the distinct vertices. */
function ringCentroid(ring: [number, number][]): [number, number] {
  const n = ring.length - 1;
  let sx = 0,
    sy = 0;
  for (let i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return [sx / n, sy / n];
}

/** Median of a non-empty list (mean of the two middles for an even count). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Turn an Overpass response into closed-ring building polygons, each with a height
 * in metres. Heights are resolved in two passes:
 *   1. Each building's OWN height from its tags (real `height`, or levels-derived).
 *   2. Buildings with neither borrow the MEDIAN known height of "donor" buildings
 *      (those resolved in pass 1) within NEIGHBOUR_RADIUS_M, falling back to the
 *      flat default only when no donor is in range.
 *
 * The neighbour lookup uses a spatial grid (cell size = radius) so it's a cheap
 * 3×3-cell scan per building rather than an O(n²) sweep. All of this runs
 * server-side inside the cached loadBuildings() handler, so the mobile client just
 * receives the same BuildingFeature[] JSON it always did — it pays nothing extra.
 */
function parseBuildings(json: { elements?: OverpassElement[] }): BuildingFeature[] {
  // ── Pass 1: closed rings + each building's own tagged height (null if none). ──
  type Raw = {
    id: number;
    ring: [number, number][];
    centroid: [number, number];
    tagged: number | null;
  };
  const raws: Raw[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 3) continue;

    const ring: [number, number][] = el.geometry.map((g) => [g.lon, g.lat]);
    // Close the ring if Overpass didn't.
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    if (ring.length < 4) continue; // need a valid polygon ring

    raws.push({
      id: el.id,
      ring,
      centroid: ringCentroid(ring),
      tagged: deriveTaggedHeight(el.tags),
    });
  }
  if (raws.length === 0) return [];

  // ── Build a spatial grid of "donors" (buildings with a known height), so the ──
  // local-median fallback is a 3×3-cell lookup. Project lon/lat to local metres
  // around the data's mean latitude so x/y distances are directly comparable.
  const refLat = raws.reduce((s, r) => s + r.centroid[1], 0) / raws.length || REF_LAT;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((refLat * Math.PI) / 180);
  const toXY = ([lon, lat]: [number, number]): [number, number] => [
    lon * mPerDegLon,
    lat * mPerDegLat,
  ];
  const grid = new Map<string, Array<{ x: number; y: number; h: number }>>();
  for (const r of raws) {
    if (r.tagged === null) continue;
    const [x, y] = toXY(r.centroid);
    const key = `${Math.floor(x / NEIGHBOUR_RADIUS_M)},${Math.floor(y / NEIGHBOUR_RADIUS_M)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push({ x, y, h: r.tagged });
  }

  const radiusSq = NEIGHBOUR_RADIUS_M * NEIGHBOUR_RADIUS_M;
  /** Median known height among donors within NEIGHBOUR_RADIUS_M, or null if none. */
  const localMedian = (centroid: [number, number]): number | null => {
    if (grid.size === 0) return null;
    const [x, y] = toXY(centroid);
    const cx = Math.floor(x / NEIGHBOUR_RADIUS_M);
    const cy = Math.floor(y / NEIGHBOUR_RADIUS_M);
    const near: number[] = [];
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get(`${gx},${gy}`);
        if (!bucket) continue;
        for (const d of bucket) {
          const dx = d.x - x,
            dy = d.y - y;
          if (dx * dx + dy * dy <= radiusSq) near.push(d.h);
        }
      }
    }
    return near.length ? median(near) : null;
  };

  // ── Pass 2: own height → local median → flat default. ──
  return raws.map((r) => ({
    type: "Feature" as const,
    id: r.id,
    properties: { height: r.tagged ?? localMedian(r.centroid) ?? DEFAULT_BUILDING_HEIGHT_M },
    geometry: { type: "Polygon" as const, coordinates: [r.ring] },
  }));
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
