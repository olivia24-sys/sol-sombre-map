/* ════════════════════════════════════════════════════════════════════════
 * [BUSINESS NAMES] — OpenStreetMap food/drink venue names (OFFLINE)
 * ────────────────────────────────────────────────────────────────────────
 * A second name source alongside the city census (src/lib/census.ts). Reads
 * from a STATIC file of Barcelona food/drink POIs baked at build time
 * (src/data/osm-food-pois.json) — there is NO Overpass / network call at
 * request time. Querying Overpass per-terrace from the browser failed in
 * production (CORS + rate limits), so we ship the data instead and just scan
 * it in memory. Refresh the file with `node scripts/build-osm-food-pois.mjs`.
 *
 * Every POI in the file is a verified eating/drinking place (the build script
 * only pulls food/drink `amenity` values), so any match here is guaranteed to
 * be a food/drink venue — safe to display as a terrace name.
 *
 * Attribution: this data is © OpenStreetMap contributors (shown in the map UI).
 * ════════════════════════════════════════════════════════════════════════ */

// One baked POI: [lng, lat, name, category] — [lng, lat] matches GeoJSON order.
type RawPoi = [lng: number, lat: number, name: string, category: string];

/** A nearby OpenStreetMap food/drink venue. */
export type OsmFoodMatch = { name: string; category: string; distM: number };

/** Required OSM attribution string — surfaced in the map's attribution control. */
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

// Lazy-loaded once per session via a dynamic import, so the ~330 KB POI table
// is a separate async chunk (kept out of the initial bundle) and is fetched —
// same-origin, then browser-cached — only when a user first opens a terrace.
let poisPromise: Promise<RawPoi[]> | null = null;
function loadPois(): Promise<RawPoi[]> {
  if (!poisPromise) {
    poisPromise = import("@/data/osm-food-pois.json")
      // The baked file's tuple shape is wider than TS infers from the JSON, so we
      // assert it through `unknown` to our own RawPoi type.
      .then((mod) => (mod as unknown as { default: { pois: RawPoi[] } }).default.pois ?? [])
      .catch((err) => {
        poisPromise = null; // let a transient chunk-load failure retry next time
        throw err;
      });
  }
  return poisPromise;
}

// Great-circle distance in metres.
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Nearest OpenStreetMap food/drink venue to a point, within `maxM` metres.
 * Returns null if none is close enough. Pure offline lookup over the baked file.
 */
export async function nearestOsmFood(lat: number, lng: number, maxM = 25): Promise<OsmFoodMatch | null> {
  const pois = await loadPois();

  // Cheap bounding-box pre-filter so we only run haversine on plausible POIs.
  const dLat = maxM / 111_000;
  const dLng = maxM / (111_000 * Math.cos((lat * Math.PI) / 180));

  let best: OsmFoodMatch | null = null;
  for (const [pLng, pLat, name, category] of pois) {
    if (Math.abs(pLat - lat) > dLat || Math.abs(pLng - lng) > dLng) continue;
    const distM = haversineM(lat, lng, pLat, pLng);
    if (distM <= maxM && (best === null || distM < best.distM)) {
      best = { name, category, distM };
    }
  }
  return best;
}
