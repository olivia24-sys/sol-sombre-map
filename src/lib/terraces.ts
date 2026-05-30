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
 * ════════════════════════════════════════════════════════════════════════ */

const API_BASE = "https://opendata-ajuntament.barcelona.cat/data/api/action/datastore_search";
const RESOURCE_ID = "3be007e1-d1c8-4480-ab33-ba30da5eda1d"; // 2025 2nd semester (latest)

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

// Fetch a single page, retrying with exponential backoff on the API's overload
// codes (429/5xx). Returns the parsed terraces + the dataset total.
async function fetchPage(offset: number, limit: number, attempt = 0): Promise<{ total: number; terraces: Terrace[] }> {
  const url = `${API_BASE}?resource_id=${RESOURCE_ID}&limit=${limit}&offset=${offset}`;
  const res = await fetch(url);

  if ([429, 502, 503, 504].includes(res.status) && attempt < 3) {
    await sleep(500 * 2 ** attempt + Math.random() * 250);
    return fetchPage(offset, limit, attempt + 1);
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
}

/**
 * Fetch ALL terraces, paginating through the full dataset (~6,900 records).
 * Pages are fetched SEQUENTIALLY: the open-data API returns 503s under a burst
 * of parallel requests, so we go one at a time (with per-page retry/backoff).
 * Throws on persistent failure so React Query can show an error.
 */
export async function fetchTerraces(): Promise<Terrace[]> {
  const first = await fetchPage(0, PAGE_SIZE);
  const total = Math.min(first.total, MAX_RECORDS);
  const all: Terrace[] = [...first.terraces];

  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
    const page = await fetchPage(offset, PAGE_SIZE);
    all.push(...page.terraces);
  }

  return all;
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
