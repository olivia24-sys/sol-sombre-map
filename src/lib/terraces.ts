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
 * ════════════════════════════════════════════════════════════════════════ */

const API_BASE = "https://opendata-ajuntament.barcelona.cat/data/api/action/datastore_search";
const RESOURCE_ID = "3be007e1-d1c8-4480-ab33-ba30da5eda1d"; // 2025 2nd semester (latest)
const DEFAULT_LIMIT = 500; // start small for performance, per the brief

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
  name: string; // EMPLACAMENT (street location), title-cased
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

/**
 * Fetch + normalise terraces from the open-data API.
 * Throws on network / API failure so callers (React Query) can show an error.
 */
export async function fetchTerraces(limit = DEFAULT_LIMIT): Promise<Terrace[]> {
  const url = `${API_BASE}?resource_id=${RESOURCE_ID}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-data API responded ${res.status}`);

  const json = await res.json();
  if (!json?.success) throw new Error("Open-data API returned success:false");

  const records: RawRecord[] = json.result?.records ?? [];
  const terraces: Terrace[] = [];

  for (const r of records) {
    const lat = parseFloat(String(r.LATITUD));
    const lng = parseFloat(String(r.LONGITUD));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!inBarcelona(lat, lng)) continue;

    const emplacament = (r.EMPLACAMENT ?? "").trim();
    terraces.push({
      id: String(r._id),
      name: emplacament ? titleCase(emplacament) : "Terraza",
      address: [r.NOM_BARRI, r.NOM_DISTRICTE].filter(Boolean).join(" · "),
      lng,
      lat,
      state: "unknown", // coloured by Step 3 (day/night) + Step 4 (shadows)
    });
  }

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
