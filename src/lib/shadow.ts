/* ════════════════════════════════════════════════════════════════════════
 * [SHADOW MATHS] — ray-casting sun/shade per terrace (Steps 4 & 5)
 * ────────────────────────────────────────────────────────────────────────
 * Pure, DOM-free geometry so it can run inside a Web Worker. For each terrace
 * we cast a ray toward the sun and check whether a building tall enough to
 * block the sunlight stands within reach:
 *
 *     a building at distance d blocks the sun if  height ≥ d · tan(altitude)
 *     (its shadow reaches  height / tan(altitude)  metres)
 *
 * Direction note: the brief describes casting "opposite the sun's azimuth"
 * (the way a shadow points). The building that shades a terrace sits between
 * the terrace and the sun, so we cast toward the sun's compass bearing — same
 * physics, stated from the other end.
 *
 *   computeTerraceStates() — Step 4: sun/shade for every terrace (one moment)
 *   computeDuration()      — Step 5: how long the current state lasts, by
 *                            re-testing one terrace every 15 min
 * ════════════════════════════════════════════════════════════════════════ */

import { point, lineString, destination, lineIntersect, distance } from "@turf/turf";
import type { BuildingFeature } from "./overpass";
import { getSunPosition } from "./sun";

// Beyond this, low-sun geometry produces unrealistically long shadows that
// would wrongly shade far-away terraces — so we ignore anything past it.
export const MAX_SHADOW_DISTANCE_M = 150;

// Step 5 sampling: re-test the terrace every 15 min, up to this horizon.
const STEP_MINUTES = 15;
const HORIZON_HOURS = 14;

const BCN_LAT = 41.3851;
// 150 m expressed in degrees, so the proximity prefilter is a quick compare.
const THRESH_LAT = MAX_SHADOW_DISTANCE_M / 111_000;
const THRESH_LNG = MAX_SHADOW_DISTANCE_M / (111_000 * Math.cos((BCN_LAT * Math.PI) / 180));

export type SunDirection = {
  altitudeRad: number; // sun height above horizon (≤ 0 → night)
  bearingFromNorthDeg: number; // compass bearing of the sun (0=N, 90=E, 180=S, 270=W)
};

export type TerracePoint = { id: string; lng: number; lat: number };

/** id → "sun" | "shade" */
export type ShadeResult = Record<string, "sun" | "shade">;

/** Result of the "how long does this last?" calc (Step 5). */
export type DurationResult = {
  current: "sun" | "shade";
  changeAtISO: string | null; // when it flips to the opposite state…
  untilSunset: boolean; // …or true if the sun sets first (lasts "hasta el atardecer")
};

type IndexedBuilding = {
  feature: BuildingFeature;
  height: number;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

/** Precompute building bounding boxes for the proximity prefilter. */
function indexBuildings(buildings: BuildingFeature[]): IndexedBuilding[] {
  return buildings.map((feature) => {
    const ring = feature.geometry.coordinates[0];
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { feature, height: feature.properties.height, minLng, minLat, maxLng, maxLat };
  });
}

/** Is this terrace in shade for the given sun position? (false at night) */
function isShaded(t: TerracePoint, indexed: IndexedBuilding[], sun: SunDirection): boolean {
  const tanAlt = Math.tan(sun.altitudeRad);
  if (sun.altitudeRad <= 0 || tanAlt <= 0) return false;

  const from = point([t.lng, t.lat]);
  const end = destination(from, MAX_SHADOW_DISTANCE_M, sun.bearingFromNorthDeg, { units: "meters" });
  const ray = lineString([[t.lng, t.lat], end.geometry.coordinates]);

  for (const b of indexed) {
    // Skip buildings whose bbox is clearly farther than the shadow cap.
    if (
      b.maxLat < t.lat - THRESH_LAT ||
      b.minLat > t.lat + THRESH_LAT ||
      b.maxLng < t.lng - THRESH_LNG ||
      b.minLng > t.lng + THRESH_LNG
    ) {
      continue;
    }

    const hits = lineIntersect(ray, b.feature);
    if (hits.features.length === 0) continue;

    let nearest = Infinity;
    for (const f of hits.features) {
      const d = distance(from, f, { units: "meters" });
      if (d < nearest) nearest = d;
    }

    if (nearest <= MAX_SHADOW_DISTANCE_M && b.height >= nearest * tanAlt) return true;
  }
  return false;
}

/** Step 4: sun/shade for every terrace at one moment. */
export function computeTerraceStates(
  terraces: TerracePoint[],
  buildings: BuildingFeature[],
  sun: SunDirection
): ShadeResult {
  const indexed = indexBuildings(buildings);
  const result: ShadeResult = {};
  for (const t of terraces) result[t.id] = isShaded(t, indexed, sun) ? "shade" : "sun";
  return result;
}

/**
 * Step 5: how long the terrace's current sun/shade state lasts. Steps forward
 * in 15-min increments, recomputing the sun position each time, until the
 * state flips or the sun sets.
 */
export function computeDuration(
  terrace: TerracePoint,
  buildings: BuildingFeature[],
  start: Date
): DurationResult {
  const indexed = indexBuildings(buildings);
  const current: "sun" | "shade" = isShaded(terrace, indexed, getSunPosition(start)) ? "shade" : "sun";

  const stepMs = STEP_MINUTES * 60_000;
  const endMs = start.getTime() + HORIZON_HOURS * 3_600_000;

  for (let t = start.getTime() + stepMs; t <= endMs; t += stepMs) {
    const at = new Date(t);
    const sun = getSunPosition(at);
    if (sun.isNight) return { current, changeAtISO: null, untilSunset: true }; // sets before flipping
    const state: "sun" | "shade" = isShaded(terrace, indexed, sun) ? "shade" : "sun";
    if (state !== current) return { current, changeAtISO: at.toISOString(), untilSunset: false };
  }

  return { current, changeAtISO: null, untilSunset: true };
}
