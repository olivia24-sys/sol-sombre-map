/* ════════════════════════════════════════════════════════════════════════
 * [TERRACE DATA] — Barcelona open-data terrace feed (Step 2)
 * ────────────────────────────────────────────────────────────────────────
 * Fetches the city's licensed-terrace dataset and normalises it into the
 * `Terrace` shape the map uses. This is the single source of truth for
 * terrace data + types; MapView and the sun/shadow steps import from here.
 *
 * Dataset: "terrasses-comercos-vigents" (ordinary terrace authorizations on
 * public space). NOTE: Barcelona re-publishes this every 6 months with a NEW
 * resource_id. The id in the original brief (a21d74b1…) now 404s, so we use
 * the current one below. To refresh in future, look up the dataset here:
 *   https://opendata-ajuntament.barcelona.cat/data/dataset/terrasses-comercos-vigents
 * and copy the newest "..._Data_set_OPENDATA_Terrasses.csv" resource id.
 *
 * KNOWN DATA LIMITATION: this dataset has NO establishment / business name —
 * only the street location (EMPLACAMENT), district and neighbourhood. We show
 * the street location as the heading.
 * TODO v2: cross-reference with Barcelona business registry for names.
 *
 * PERFORMANCE (why this is shaped the way it is):
 *   • The ~6,900-record dataset is paged 1,000 at a time and the open-data API
 *     503s under parallel bursts, so pages are fetched SEQUENTIALLY. Doing that
 *     from every browser was the main cause of the long "Cargando terrazas…":
 *     7 serial round-trips of mostly-unused columns (~3.8 MB) on each load.
 *   • So the fetch + normalisation now runs in a SERVER function with an
 *     in-memory cache: one warm server instance pays the cost once and serves
 *     every visitor the small normalised list (6 fields, not 21). The browser
 *     never talks to the upstream API directly.
 *   • The client additionally persists the result to localStorage, keyed by the
 *     dataset's content version (the resource_id — see TERRACES_DATA_VERSION).
 *     Repeat visits paint pins instantly from cache and DON'T refetch at all
 *     while the version matches; a new dataset edition changes the version and
 *     invalidates the cache automatically. A long time backstop catches the rare
 *     in-place correction. No fixed-TTL guesswork, no polling.
 * ════════════════════════════════════════════════════════════════════════ */

import { createServerFn } from "@tanstack/react-start";

const API_BASE = "https://opendata-ajuntament.barcelona.cat/data/api/action/datastore_search";
const RESOURCE_ID = "3be007e1-d1c8-4480-ab33-ba30da5eda1d"; // 2025 2nd semester (latest)

// Content version for cache invalidation. Barcelona publishes each semester as a
// NEW resource_id rather than editing the old one in place (the data endpoint has
// no ETag/Last-Modified — it's an immutable snapshot), so the resource_id IS the
// data's version: it changes exactly when, and only when, the dataset changes —
// which is also when this constant is updated in code. Persisted client caches are
// keyed to it, so a new edition invalidates them automatically with no polling,
// hashing, or fixed-TTL guesswork. Bump the leading tag too if the Terrace shape
// changes (so old-shape caches are ignored).
export const TERRACES_DATA_VERSION = `t1:${RESOURCE_ID}`;

// Only request the columns we actually use. The raw record has 21 columns
// (table/chair counts, surface area, ETRS89 coords, …); projecting to these 6
// cuts the upstream payload by ~two-thirds.
const FIELDS = ["_id", "EMPLACAMENT", "NOM_BARRI", "NOM_DISTRICTE", "LATITUD", "LONGITUD"] as const;

const PAGE_SIZE = 1000; // records per request when paginating
const MAX_RECORDS = 9000; // safety cap (dataset is ~6,900)

/**
 * A terrace's sun/shade status.
 *  - "unknown" — not yet computed (Step 2: data loaded, no sun calc yet;
 *                also used while the Step 4 worker is calculating)
 *  - "night"   — sun is below the horizon (Step 3)
 *  - "sun" / "shade" — real result from the shadow calc (Step 4)
 */
export type TerraceState = "sun" | "shade" | "night" | "unknown";

export type Terrace = {
  id: string;
  name: string; // EMPLACAMENT (street location), title-cased — see "names" note above
  address: string; // "barri · districte"
  lng: number;
  lat: number;
  state: TerraceState;
};

// Raw record shape from the open-data API (only the fields we use).
type RawRecord = {
  _id: number;
  EMPLACAMENT?: string;
  NOM_BARRI?: string;
  NOM_DISTRICTE?: string;
  LATITUD?: string;
  LONGITUD?: string;
};

// "AV. GAUDI, 66" → "Av. Gaudi, 66" (gentle title-case for display).
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// Rough Barcelona bounding box — drops records with missing/garbage coords.
function inBarcelona(lat: number, lng: number): boolean {
  return lat > 41.2 && lat < 41.55 && lng > 1.9 && lng < 2.35;
}

// Normalise one raw record → Terrace (or null if coords are missing/invalid).
function recordToTerrace(r: RawRecord): Terrace | null {
  const lat = parseFloat(String(r.LATITUD));
  const lng = parseFloat(String(r.LONGITUD));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inBarcelona(lat, lng)) return null;

  const emplacament = (r.EMPLACAMENT ?? "").trim();
  return {
    id: String(r._id),
    // No business name in this dataset — show the street location instead.
    // TODO v2: cross-reference with Barcelona business registry for names.
    name: emplacament ? titleCase(emplacament) : "Terraza",
    address: [r.NOM_BARRI, r.NOM_DISTRICTE].filter(Boolean).join(" · "),
    lng,
    lat,
    state: "unknown", // coloured by Step 3 (day/night) + Step 4 (shadows)
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ─── server-only: pagination + cache live inside the server function below ── */

// Per-page hard cap. The open-data API sometimes accepts the connection but never
// responds, and fetch() has no built-in timeout — so without this a single hung
// request stalls the whole pagination (and the server function) until Vercel's
// maxDuration kills it. Mirrors the Overpass fetch's timeout (src/lib/overpass.ts).
const PAGE_TIMEOUT_MS = 10_000;

// Fetch a single page, retrying with exponential backoff on the API's overload
// codes (429/5xx) and on timeouts / network errors. The timeout covers the body
// read too (res.json() inside the timed block). Returns the parsed terraces + the
// dataset total; throws once retries are exhausted.
async function fetchPage(offset: number, limit: number, attempt = 0): Promise<{ total: number; terraces: Terrace[] }> {
  const fields = encodeURIComponent(FIELDS.join(","));
  const url = `${API_BASE}?resource_id=${RESOURCE_ID}&limit=${limit}&offset=${offset}&fields=${fields}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });

    if ([429, 502, 503, 504].includes(res.status) && attempt < 3) {
      await sleep(500 * 2 ** attempt + Math.random() * 250);
      return fetchPage(offset, limit, attempt + 1); // not awaited → this attempt's catch won't re-handle it
    }
    if (!res.ok) throw new Error(`Open-data API responded ${res.status}`);

    const json = await res.json();
    if (!json?.success) throw new Error("Open-data API returned success:false");

    const total: number = json.result?.total ?? 0;
    const records: RawRecord[] = json.result?.records ?? [];
    const terraces: Terrace[] = [];
    for (const r of records) {
      const t = recordToTerrace(r);
      if (t) terraces.push(t);
    }
    return { total, terraces };
  } catch (err) {
    // A timeout (abort) or network error is transient — retry like an overload code.
    // Data errors (bad status, success:false, malformed JSON) are re-thrown as-is.
    if ((controller.signal.aborted || err instanceof TypeError) && attempt < 3) {
      await sleep(500 * 2 ** attempt + Math.random() * 250);
      return fetchPage(offset, limit, attempt + 1);
    }
    throw controller.signal.aborted ? new Error(`Open-data API timed out after ${PAGE_TIMEOUT_MS}ms`) : err;
  } finally {
    clearTimeout(timer);
  }
}

// In-memory cache (per warm server instance). The dataset is republished ~every
// 6 months, so a long TTL is safe; this is what shields the upstream API from
// every visitor paying the 7-request pagination cost.
const TERRACES_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let terracesCache: { at: number; data: Terrace[] } | null = null;

/**
 * Fetch ALL terraces, paginating through the full dataset (~6,900 records).
 * Pages are fetched SEQUENTIALLY: the open-data API returns 503s under a burst
 * of parallel requests, so we go one at a time (with per-page retry/backoff).
 * Throws on persistent failure so React Query can show an error.
 */
async function loadAllTerraces(): Promise<Terrace[]> {
  if (terracesCache && Date.now() - terracesCache.at < TERRACES_CACHE_TTL_MS) {
    return terracesCache.data;
  }

  const first = await fetchPage(0, PAGE_SIZE);
  const total = Math.min(first.total, MAX_RECORDS);
  const all: Terrace[] = [...first.terraces];

  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
    const page = await fetchPage(offset, PAGE_SIZE);
    all.push(...page.terraces);
  }

  terracesCache = { at: Date.now(), data: all };
  return all;
}

// Edge cache (Vercel CDN). A visitor WITHOUT a warm localStorage copy (first-ever
// visit, or just after a new dataset edition) is the remaining slow path — it would
// otherwise hit the lambda, and on a cold instance pay the 7-page upstream
// pagination. Caching this GET at the edge serves it from Vercel's CDN instead:
// shared across all such visitors and surviving lambda cold starts.
//   • s-maxage=600 — the CDN treats it fresh for 10 min. The data only changes on a
//     new-edition deploy (~twice a year), which gets an isolated cache on Vercel; this
//     short window just bounds worst-case staleness if that assumption ever doesn't hold.
//   • stale-while-revalidate=1d — after 10 min, serve stale instantly while ONE
//     background request refreshes it, so first paints stay instant continuously.
//   • max-age=0 — browsers don't cache the RPC itself; repeat visits already short-
//     circuit to version-keyed localStorage, and the 14-day backstop must revalidate.
const TERRACES_CDN_CACHE_CONTROL = "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";

/**
 * Server function: the browser calls this same-origin and receives the small,
 * already-normalised terrace list. The pagination + the heavy raw payload stay
 * on the server, behind the in-memory cache; the response is edge-cached too.
 */
const getTerraces = createServerFn({ method: "GET" }).handler(async () => {
  // Deferred import: keeps this server-only util out of the client module graph
  // (the handler body is stripped from the client bundle, taking the import with it).
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("cache-control", TERRACES_CDN_CACHE_CONTROL);
  return loadAllTerraces();
});

/* ─── client-side: version-keyed persistence ─────────────────────────────────
 * Keep the last good copy in localStorage, stamped with the dataset version
 * (TERRACES_DATA_VERSION) it came from. React Query seeds from it (see MapView):
 * while the stored version matches the current one, repeat visits paint pins
 * instantly and skip the network entirely; when the version differs (new dataset
 * edition), the stored copy is ignored and a fresh fetch runs. The backstop below
 * triggers a single background revalidation if a copy is very old, purely to catch
 * a rare in-place correction to a published dataset.
 * ──────────────────────────────────────────────────────────────────────── */

const PERSIST_KEY = "haysol.terraces";
/** Background-revalidation backstop (React Query staleTime). The data version is
 *  the real invalidation signal; this only exists to eventually catch a rare
 *  in-place edit. Long by design — the source changes ~twice a year. */
export const TERRACES_BACKSTOP_MS = 14 * 24 * 60 * 60 * 1000;

export type PersistedTerraces = { version: string; at: number; terraces: Terrace[] };

/** Last good terrace list from localStorage, or null if absent/unusable. Includes
 *  the version it was stored under so the caller can ignore a stale edition. */
export function readPersistedTerraces(): PersistedTerraces | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTerraces;
    if (!parsed || typeof parsed.version !== "string" || typeof parsed.at !== "number" || !Array.isArray(parsed.terraces)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedTerraces(terraces: Terrace[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: PersistedTerraces = { version: TERRACES_DATA_VERSION, at: Date.now(), terraces };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — non-fatal, we just skip persistence.
  }
}

/**
 * Client entry point (used as the React Query `queryFn`). Calls the cached
 * server function, then persists the result for instant future loads.
 */
export async function fetchTerraces(): Promise<Terrace[]> {
  const terraces = await getTerraces();
  writePersistedTerraces(terraces);
  return terraces;
}

/** Convert terraces to a GeoJSON FeatureCollection for a Mapbox source. */
export function terracesToGeoJSON(terraces: Terrace[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: terraces.map((t) => ({
      type: "Feature",
      id: t.id, // enables feature-state (selected highlight)
      geometry: { type: "Point", coordinates: [t.lng, t.lat] },
      properties: { id: t.id, name: t.name, address: t.address, state: t.state },
    })),
  };
}
