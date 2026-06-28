/* ════════════════════════════════════════════════════════════════════════
 * [TERRACE DATA] — Barcelona open-data terrace feed (Step 2)
 * ────────────────────────────────────────────────────────────────────────
 * Fetches the city's licensed-terrace dataset and normalises it into the
 * `Terrace` shape the map uses. This is the single source of truth for
 * terrace data + types; MapView and the sun/shadow steps import from here.
 *
 * Dataset: "terrasses-comercos-vigents" (ordinary terrace authorizations on
 * public space). Barcelona re-publishes this ~every 6 months as a NEW resource_id
 * (an immutable snapshot); the old id eventually 404s — the original brief's
 * a21d74b1… already does. To survive that automatically we DISCOVER the current
 * resource at runtime from the dataset's STABLE CKAN package id (see
 * TERRACES_PACKAGE_ID / discoverResourceId below) and only fall back to the
 * hardcoded FALLBACK_RESOURCE_ID if discovery fails. Manual refresh is therefore
 * no longer required; bumping FALLBACK_RESOURCE_ID after a republish just keeps the
 * fallback current. Dataset page:
 *   https://opendata-ajuntament.barcelona.cat/data/dataset/terrasses-comercos-vigents
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
 *   • The client additionally persists the result to localStorage, stamped with the
 *     served edition's version (resource_id — see TERRACES_DATA_VERSION). Repeat
 *     visits paint pins instantly from any same-shape cache and, while still fresh,
 *     DON'T refetch at all; the long backstop then revalidates against the server,
 *     which auto-discovers the current edition and re-persists it. No fixed-TTL
 *     guesswork, no polling.
 * ════════════════════════════════════════════════════════════════════════ */

import { createServerFn } from "@tanstack/react-start";

const API_BASE = "https://opendata-ajuntament.barcelona.cat/data/api/action/datastore_search";
// CKAN action API (same host) — used to DISCOVER the current resource id at runtime.
const CKAN_API_BASE = "https://opendata-ajuntament.barcelona.cat/data/api/3/action";

// STABLE dataset identifier (CKAN "package"). Unlike a resource_id this does NOT
// change on a republish: each semester adds a NEW resource under this SAME package,
// so we read the package's resource list and pick the current edition at runtime
// (see discoverResourceId). Parameterised so a future city is just another package
// id. This is the readable slug; the immutable uuid 9cefbfa2-bcdf-44a0-b63a-372b48f9da93
// also works if the slug is ever renamed.
const TERRACES_PACKAGE_ID = "terrasses-comercos-vigents";

// LAST-KNOWN-GOOD resource id (2025 2nd semester). Two jobs:
//   1. Fallback when runtime discovery fails/times out — worst case is then exactly
//      today's behaviour, so we never break the currently-working load.
//   2. The build-time cache version (below), so first paint + the version-keyed
//      cache keep working even when discovery is unavailable.
// Safe to bump after a republish (keeps the fallback current) but no longer required.
const FALLBACK_RESOURCE_ID = "3be007e1-d1c8-4480-ab33-ba30da5eda1d";

// Cache/version tag. A version string is `<shape tag>:<resource id>`: the resource
// id is the content version (it changes exactly when the dataset is republished) and
// the shape tag is bumped by hand if the Terrace shape changes (so old-shape caches
// are ignored). The id fed in is the one ACTUALLY used for a given load — discovered
// when possible, else the fallback — see getTerraces / fetchTerraces.
const TERRACES_SHAPE_TAG = "t1";
const versionFor = (resourceId: string): string => `${TERRACES_SHAPE_TAG}:${resourceId}`;

/** Build-time data version (the last-known-good edition). Used as the React Query
 *  key and as the reference shape for seeding the persisted cache (see MapView). */
export const TERRACES_DATA_VERSION = versionFor(FALLBACK_RESOURCE_ID);

/** True if a persisted cache entry is the same Terrace SHAPE as this build (same
 *  tag), regardless of which dataset edition (resource id) produced it. Lets repeat
 *  visits paint instantly from any same-shape cache even right after a republish;
 *  the current edition then streams in via the normal query and re-persists under
 *  its own version. A shape-tag bump still invalidates every old cache. */
export function isCompatibleTerracesVersion(version: string | null | undefined): boolean {
  return typeof version === "string" && version.startsWith(`${TERRACES_SHAPE_TAG}:`);
}

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
async function fetchPage(
  resourceId: string,
  offset: number,
  limit: number,
  attempt = 0,
): Promise<{ total: number; terraces: Terrace[] }> {
  const fields = encodeURIComponent(FIELDS.join(","));
  const url = `${API_BASE}?resource_id=${resourceId}&limit=${limit}&offset=${offset}&fields=${fields}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });

    if ([429, 502, 503, 504].includes(res.status) && attempt < 3) {
      await sleep(500 * 2 ** attempt + Math.random() * 250);
      return fetchPage(resourceId, offset, limit, attempt + 1); // not awaited → this attempt's catch won't re-handle it
    }
    if (!res.ok)
      throw new Error(`Open-data API responded ${res.status} for resource ${resourceId}`);

    const json = await res.json();
    if (!json?.success)
      throw new Error(`Open-data API returned success:false for resource ${resourceId}`);

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
      return fetchPage(resourceId, offset, limit, attempt + 1);
    }
    throw controller.signal.aborted
      ? new Error(`Open-data API timed out after ${PAGE_TIMEOUT_MS}ms (resource ${resourceId})`)
      : err;
  } finally {
    clearTimeout(timer);
  }
}

/* ─── runtime resource discovery ─────────────────────────────────────────────
 * Resolve the CURRENT resource id from the STABLE package, so a republish (new
 * resource id) is picked up automatically. CKAN keeps EVERY past edition listed
 * and datastore-active, so "current" = the newest edition, identified by the
 * YYYY_NS semester encoded in the resource name (robust to two editions sharing an
 * upload date), tie-broken by upload timestamp. Best-effort: any failure/timeout
 * falls back to FALLBACK_RESOURCE_ID and the load proceeds (logged as a warning,
 * not the hard alert below).
 * ──────────────────────────────────────────────────────────────────────── */

// Short, hard cap on the discovery call so it can never hold up a load: on timeout
// we fall straight back to the last-known-good id. It's one small (~30 KB) metadata
// GET, server-side and behind the same caches as the terrace list, so the client's
// first paint never waits on it (see PERFORMANCE note in the header).
const DISCOVERY_TIMEOUT_MS = 4_000;
const DISCOVERY_USER_AGENT =
  "HaySol/1.0 (https://sol-sombre-map.vercel.app; Barcelona terrace sun/shade finder)";

type ResourceSource = "discovered" | "fallback";
type CkanResource = {
  id?: string;
  format?: string;
  name?: string;
  created?: string;
  last_modified?: string;
  datastore_active?: boolean;
};

// "2025_2S_Data_set_OPENDATA_Terrasses.csv" → 2025*2 + 2. Higher = newer edition;
// -1 if the name carries no YYYY_NS semester (then sorting falls back to date alone).
function editionRank(name: string): number {
  const m = /(\d{4})[_-]?([12])\s*S/i.exec(name);
  if (!m) return -1;
  return parseInt(m[1], 10) * 2 + parseInt(m[2], 10);
}

// Newer ranks higher: by semester first (handles editions sharing an upload date),
// then by upload timestamp as a tiebreak.
function compareEdition(a: CkanResource, b: CkanResource): number {
  const ra = editionRank(a.name ?? "");
  const rb = editionRank(b.name ?? "");
  if (ra !== rb) return ra - rb;
  const ta = Date.parse(a.created ?? a.last_modified ?? "") || 0;
  const tb = Date.parse(b.created ?? b.last_modified ?? "") || 0;
  return ta - tb;
}

/** Pick the current terrace CSV from a package's resource list, or null if none
 *  look usable (→ caller falls back to the last-known-good id). */
function pickCurrentResource(resources: CkanResource[]): string | null {
  const csv = resources.filter(
    (r) =>
      typeof r.id === "string" &&
      r.id.length > 0 &&
      (r.format ?? "").toUpperCase() === "CSV" &&
      r.datastore_active === true,
  );
  // Defend against an unrelated CSV ever being added to the package: prefer the
  // terrace data-set files, but fall back to any datastore CSV if the naming changes.
  const named = csv.filter((r) => /terrasses/i.test(r.name ?? ""));
  const pool = named.length > 0 ? named : csv;
  if (pool.length === 0) return null;
  return pool.reduce((best, r) => (compareEdition(r, best) > 0 ? r : best)).id ?? null;
}

/** Discover the current resource id from the stable package, or null on any
 *  failure/timeout. Soft failure: logged as a warning; the caller uses the
 *  last-known-good id so the app still loads. */
async function discoverResourceId(): Promise<string | null> {
  const url = `${CKAN_API_BASE}/package_show?id=${encodeURIComponent(TERRACES_PACKAGE_ID)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": DISCOVERY_USER_AGENT },
    });
    if (!res.ok) throw new Error(`CKAN package_show responded ${res.status}`);
    const json = await res.json();
    const resources: CkanResource[] | undefined = json?.result?.resources;
    if (!json?.success || !Array.isArray(resources))
      throw new Error("CKAN package_show returned success:false or no resources");
    const id = pickCurrentResource(resources);
    if (!id) throw new Error("CKAN package_show listed no usable terrace CSV");
    return id;
  } catch (err) {
    console.warn(
      `[HAYSOL][TERRACES] resource discovery failed; using last-known-good ${FALLBACK_RESOURCE_ID}.`,
      controller.signal.aborted ? `(timed out after ${DISCOVERY_TIMEOUT_MS}ms)` : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Current resource id (discovered) or the last-known-good fallback. */
async function resolveResourceId(): Promise<{ id: string; source: ResourceSource }> {
  const discovered = await discoverResourceId();
  if (discovered) return { id: discovered, source: "discovered" };
  return { id: FALLBACK_RESOURCE_ID, source: "fallback" };
}

// Distinctive marker for the one failure that matters: the feed is actually down
// (what would otherwise be a silent empty map). grep Vercel function logs for this
// string, or wire a Log Drain alert on it — see the FAIL-LOUD notes in the PR.
const TERRACES_ALERT = "🟥 [HAYSOL][TERRACES] DATA FEED FAILURE";

/** Paginate the full dataset for one resource id and assert it returned REAL data.
 *  Throws a distinctive error on 404 (in fetchPage), zero rows, or a schema change
 *  that leaves no usable coordinates — so a broken feed fails loudly rather than
 *  silently empty. */
async function loadAllForResource(resourceId: string): Promise<Terrace[]> {
  const first = await fetchPage(resourceId, 0, PAGE_SIZE);
  if (first.total === 0) {
    throw new Error(
      `Terrace feed returned ZERO rows (resource ${resourceId}) — dataset empty, withdrawn, or replaced.`,
    );
  }
  const total = Math.min(first.total, MAX_RECORDS);
  const all: Terrace[] = [...first.terraces];
  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
    const page = await fetchPage(resourceId, offset, PAGE_SIZE);
    all.push(...page.terraces);
  }
  if (all.length === 0) {
    throw new Error(
      `Terrace feed had ${first.total} rows but NONE had usable coordinates (resource ${resourceId}) — likely a schema change (renamed LATITUD/LONGITUD/EMPLACAMENT).`,
    );
  }
  return all;
}

// In-memory cache (per warm server instance). The dataset is republished ~every
// 6 months, so a long TTL is safe; this is what shields the upstream API from
// every visitor paying the 7-request pagination cost. Keyed by resource id too, so
// a republish discovered within an instance's lifetime isn't served stale.
const TERRACES_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let terracesCache: {
  at: number;
  resourceId: string;
  source: ResourceSource;
  data: Terrace[];
} | null = null;

/**
 * Fetch ALL terraces for the CURRENT edition. Resolves the resource id at runtime
 * (discovery → last-known-good fallback), paginates the full dataset (~6,900 records,
 * SEQUENTIALLY — the API 503s under parallel bursts, so one page at a time with
 * per-page retry/backoff), and validates the result is real data. If a DISCOVERED id
 * yields a broken result we retry ONCE with the last-known-good id, so the worst case
 * is never worse than today. Throws (loudly) only when the feed is genuinely down, so
 * React Query shows an error instead of an empty map. Returns the terraces + the
 * id/source actually used (for cache keying / logging).
 */
async function loadAllTerraces(): Promise<{
  terraces: Terrace[];
  resourceId: string;
  source: ResourceSource;
}> {
  if (terracesCache && Date.now() - terracesCache.at < TERRACES_CACHE_TTL_MS) {
    return {
      terraces: terracesCache.data,
      resourceId: terracesCache.resourceId,
      source: terracesCache.source,
    };
  }

  const resolved = await resolveResourceId();
  if (resolved.source === "discovered" && resolved.id !== FALLBACK_RESOURCE_ID) {
    console.info(
      `[HAYSOL][TERRACES] serving discovered edition ${resolved.id}, newer than the built-in fallback ${FALLBACK_RESOURCE_ID}. A republish was handled automatically; consider bumping FALLBACK_RESOURCE_ID.`,
    );
  }

  try {
    const terraces = await loadAllForResource(resolved.id);
    terracesCache = {
      at: Date.now(),
      resourceId: resolved.id,
      source: resolved.source,
      data: terraces,
    };
    return { terraces, resourceId: resolved.id, source: resolved.source };
  } catch (primaryErr) {
    // A discovered id that fails → fall back ONCE to the last-known-good id, so we
    // never do worse than today's hardcoded behaviour.
    if (resolved.source === "discovered" && resolved.id !== FALLBACK_RESOURCE_ID) {
      console.error(
        `${TERRACES_ALERT} discovered resource ${resolved.id} failed — falling back to last-known-good ${FALLBACK_RESOURCE_ID}.`,
        primaryErr,
      );
      try {
        const terraces = await loadAllForResource(FALLBACK_RESOURCE_ID);
        terracesCache = {
          at: Date.now(),
          resourceId: FALLBACK_RESOURCE_ID,
          source: "fallback",
          data: terraces,
        };
        return { terraces, resourceId: FALLBACK_RESOURCE_ID, source: "fallback" };
      } catch (fallbackErr) {
        console.error(
          `${TERRACES_ALERT} last-known-good resource ${FALLBACK_RESOURCE_ID} ALSO failed — the terrace feed is down.`,
          fallbackErr,
        );
        throw fallbackErr;
      }
    }
    console.error(
      `${TERRACES_ALERT} terrace feed failed for resource ${resolved.id} (source=${resolved.source}) — the terrace feed is down.`,
      primaryErr,
    );
    throw primaryErr;
  }
}

// Edge cache (Vercel CDN). A visitor WITHOUT a warm localStorage copy (first-ever
// visit, or just after a new dataset edition) is the remaining slow path — it would
// otherwise hit the lambda, and on a cold instance pay the 7-page upstream
// pagination. Caching this GET at the edge serves it from Vercel's CDN instead:
// shared across all such visitors and surviving lambda cold starts.
//   • s-maxage=600 — the CDN treats it fresh for 10 min. The data changes ~twice a
//     year (a republish, now picked up automatically by runtime discovery — see
//     loadAllTerraces); this short window bounds how long the edge serves the old
//     edition to new visitors after a republish (then it revalidates against a
//     lambda, which re-discovers).
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
  const { terraces, resourceId } = await loadAllTerraces();
  // Return the version derived from the id ACTUALLY used (discovered or fallback) so
  // the client keys its persisted cache to the real edition — busting correctly when
  // the dataset is republished.
  return { terraces, version: versionFor(resourceId) };
});

/* ─── client-side: version-keyed persistence ─────────────────────────────────
 * Keep the last good copy in localStorage, stamped with the version of the edition
 * the server actually served (`<shape tag>:<resource id>` — discovered or fallback).
 * React Query seeds from it (see MapView): any SAME-SHAPE copy paints pins instantly
 * and, while still fresh, skips the network entirely — so repeat visits stay instant
 * even right after a republish. The backstop below then revalidates against the
 * server (which auto-discovers the current edition) and re-persists under the new
 * version. A Terrace-shape change (tag bump) instead lands in the query key, so old
 * caches are ignored and a fresh fetch runs.
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
    if (
      !parsed ||
      typeof parsed.version !== "string" ||
      typeof parsed.at !== "number" ||
      !Array.isArray(parsed.terraces)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedTerraces(terraces: Terrace[], version: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: PersistedTerraces = { version, at: Date.now(), terraces };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — non-fatal, we just skip persistence.
  }
}

/**
 * Client entry point (used as the React Query `queryFn`). Calls the cached server
 * function, then persists the result — stamped with the version of the edition the
 * server actually served (discovered or fallback) — for instant future loads.
 */
export async function fetchTerraces(): Promise<Terrace[]> {
  const { terraces, version } = await getTerraces();
  writePersistedTerraces(terraces, version);
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
