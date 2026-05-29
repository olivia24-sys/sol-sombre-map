/* ════════════════════════════════════════════════════════════════════════
 * [SUN POSITION] — SunCalc wrapper (Step 3)
 * ────────────────────────────────────────────────────────────────────────
 * Computes the sun's altitude + azimuth for Barcelona at a given time.
 *  - altitude ≤ 0  → the sun is at/below the horizon → night
 *  - azimuth       → direction of the sun, needed by Step 4 (shadow casting)
 *
 * IMPORTANT azimuth convention: SunCalc measures azimuth from SOUTH, going
 * clockwise (west = positive). We also expose `bearingFromNorthDeg`, a normal
 * compass bearing (0°=N, 90°=E, 180°=S, 270°=W), which Step 4 uses to cast a
 * ray in the direction OPPOSITE the sun.
 * ════════════════════════════════════════════════════════════════════════ */

import SunCalc from "suncalc";

export const BCN = { lat: 41.3851, lng: 2.1734 };

export type SunPosition = {
  altitudeRad: number; // radians above the horizon (≤ 0 → below → night)
  azimuthRad: number; // SunCalc convention: from SOUTH, clockwise (W positive)
  altitudeDeg: number;
  /** Compass bearing of the sun: degrees from NORTH, clockwise. */
  bearingFromNorthDeg: number;
  isNight: boolean;
};

export function getSunPosition(date: Date, lat = BCN.lat, lng = BCN.lng): SunPosition {
  const { altitude, azimuth } = SunCalc.getPosition(date, lat, lng);
  const altitudeDeg = (altitude * 180) / Math.PI;
  // Convert SunCalc's south-based azimuth to a compass bearing from north.
  const bearingFromNorthDeg = (((azimuth * 180) / Math.PI + 180) % 360 + 360) % 360;
  return {
    altitudeRad: altitude,
    azimuthRad: azimuth,
    altitudeDeg,
    bearingFromNorthDeg,
    isNight: altitude <= 0,
  };
}

/**
 * The next sunrise at or after `date`, as an ISO string (Step 5 night message:
 * "El sol sale a las 07:23"). Uses today's sunrise if it's still ahead,
 * otherwise tomorrow's.
 */
export function getNextSunriseISO(date: Date, lat = BCN.lat, lng = BCN.lng): string | null {
  const today = SunCalc.getTimes(date, lat, lng).sunrise;
  if (today instanceof Date && !isNaN(today.getTime()) && today > date) return today.toISOString();

  const tomorrow = new Date(date.getTime() + 24 * 3_600_000);
  const next = SunCalc.getTimes(tomorrow, lat, lng).sunrise;
  return next instanceof Date && !isNaN(next.getTime()) ? next.toISOString() : null;
}
