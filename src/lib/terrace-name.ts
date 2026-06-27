/* ════════════════════════════════════════════════════════════════════════
 * [BUSINESS NAMES] — Terrace name matcher (census + OpenStreetMap, food-only)
 * ────────────────────────────────────────────────────────────────────────
 * Resolves the name to show for a terrace by combining two sources, in strict
 * priority order, food/drink ONLY throughout:
 *
 *   a. Census food/drink venue at the terrace's exact address  → most reliable
 *   b. Nearest OpenStreetMap food/drink venue within ~25 m     → offline, baked
 *   c. Nearest census food/drink premise within ~25 m          → fallback
 *   d. (none) → null, so the caller shows the clean street address
 *
 * A terrace always belongs to a food/drink venue, so we NEVER return a non-food
 * business name: both sources are food/drink-only by construction (census via
 * its activity filter, OSM via the build script's amenity filter). When no
 * food/drink venue is confidently nearby we return null and the UI shows the
 * honest street address rather than a wrong shop name.
 *
 * Both sources run in parallel: the census is a live, CORS-enabled Barcelona
 * open-data call; OSM is a pure offline lookup over a baked static file (no
 * Overpass call at request time). If either source fails it is simply skipped.
 * ════════════════════════════════════════════════════════════════════════ */

import { fetchCensusFood } from "@/lib/census";
import { nearestOsmFood } from "@/lib/osm-names";

/** Which source produced the displayed name (handy for debugging/analytics). */
export type TerraceNameSource = "census-address" | "osm-nearby" | "census-nearby";

export type ResolvedTerraceName = { name: string; source: TerraceNameSource };

/** Radius for the "nearby" fallbacks (b) and (c). */
const NEARBY_RADIUS_M = 25;

/**
 * Best food/drink name for a terrace, or null if none is confidently nearby (in
 * which case the caller shows the street address). Never returns a non-food name.
 */
export async function resolveTerraceName(
  lat: number,
  lng: number,
  terraceAddress: string,
): Promise<ResolvedTerraceName | null> {
  // Census (live open data) and OSM (offline static) in parallel. Each is
  // independently optional — a failure in one must not lose the other.
  const [census, osm] = await Promise.all([
    fetchCensusFood(lat, lng, terraceAddress).catch(() => ({ addressFood: null, nearestFood: null })),
    nearestOsmFood(lat, lng, NEARBY_RADIUS_M).catch(() => null),
  ]);

  // a. Census food/drink venue matched to the terrace's exact address.
  if (census.addressFood) return { name: census.addressFood, source: "census-address" };

  // b. Nearest OpenStreetMap food/drink venue within ~25 m.
  if (osm) return { name: osm.name, source: "osm-nearby" };

  // c. Nearest census food/drink premise within ~25 m.
  if (census.nearestFood && census.nearestFood.distM <= NEARBY_RADIUS_M) {
    return { name: census.nearestFood.name, source: "census-nearby" };
  }

  // d. Nothing trustworthy → caller falls back to the clean street address.
  return null;
}
