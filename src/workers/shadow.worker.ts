/* ════════════════════════════════════════════════════════════════════════
 * [SHADOW WORKER] — runs all shadow maths off the main thread (Steps 4 & 5)
 * ────────────────────────────────────────────────────────────────────────
 * Two request types, both kept here so the UI never blocks:
 *   "states"   → sun/shade for every terrace right now (Step 4)
 *   "duration" → how long one terrace's current state lasts (Step 5)
 * `requestId` lets the UI ignore stale results when inputs change quickly.
 * ════════════════════════════════════════════════════════════════════════ */

import { computeTerraceStates, computeDuration, type SunDirection, type TerracePoint } from "../lib/shadow";
import type { BuildingFeature } from "../lib/overpass";

type StatesMsg = {
  type: "states";
  requestId: number;
  terraces: TerracePoint[];
  buildings: BuildingFeature[];
  sun: SunDirection;
};

type DurationMsg = {
  type: "duration";
  requestId: number;
  terrace: TerracePoint;
  buildings: BuildingFeature[];
  startISO: string;
};

self.onmessage = (e: MessageEvent<StatesMsg | DurationMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === "states") {
      const result = computeTerraceStates(msg.terraces, msg.buildings, msg.sun);
      self.postMessage({ type: "states", requestId: msg.requestId, ok: true, result });
    } else if (msg.type === "duration") {
      const result = computeDuration(msg.terrace, msg.buildings, new Date(msg.startISO));
      self.postMessage({ type: "duration", requestId: msg.requestId, ok: true, result });
    }
  } catch (err) {
    self.postMessage({ type: msg.type, requestId: msg.requestId, ok: false, error: String(err) });
  }
};
