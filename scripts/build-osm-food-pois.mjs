/* ════════════════════════════════════════════════════════════════════════
 * [BUSINESS NAMES] — One-time offline OpenStreetMap food/drink POI enrichment
 * ────────────────────────────────────────────────────────────────────────
 * Fetches every food/drink point of interest in Barcelona from OpenStreetMap
 * (via Overpass) and bakes name + coordinates + category into a STATIC file
 * the app ships with: `src/data/osm-food-pois.json`.
 *
 * WHY OFFLINE (do not change this to a runtime fetch): querying Overpass
 * per-terrace from the browser failed in production — the browser can't set a
 * User-Agent (overpass-api.de bot-blocks it), Overpass rate-limits ~4 slots per
 * IP, and its 5xx responses carry no CORS header, so the browser surfaced a bare
 * "Failed to fetch". We therefore fetch ONCE here, from a CLI/server context,
 * and the app's name matcher reads from the baked JSON with NO network call at
 * request time. (Building footprints for the shadow engine are a separate,
 * server-proxied Overpass call — see src/lib/overpass.ts — untouched here.)
 *
 * RUN (whenever you want to refresh the POI snapshot, ~twice a year is plenty):
 *   node scripts/build-osm-food-pois.mjs
 *   # or: bun scripts/build-osm-food-pois.mjs
 *
 * ATTRIBUTION: POI data is © OpenStreetMap contributors, made available under
 * the ODbL. The app shows this credit in the map UI (see MapView's attribution
 * control). The generated JSON also carries the attribution string.
 * ════════════════════════════════════════════════════════════════════════ */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../src/data/osm-food-pois.json");

/* ─── what counts as a terrace venue ──────────────────────────────────────
 * A terrace always belongs to a food/drink venue, so we only pull these OSM
 * `amenity` values. This is the OSM-side mirror of the census food filter
 * (src/lib/census.ts) and keeps the static file food/drink ONLY — every POI in
 * it is a verified eating/drinking place, so any match is safe to display. */
const FOOD_AMENITIES = [
  "bar",
  "cafe",
  "restaurant",
  "fast_food",
  "pub",
  "biergarten",
  "food_court",
  "ice_cream",
];
const AMENITY_RE = `^(${FOOD_AMENITIES.join("|")})$`;

/* ─── one bounding box per Barcelona district ──────────────────────────────
 * [south, west, north, east]. Boxes are generous and deliberately OVERLAP at
 * the seams so a POI near a district border is never dropped; duplicates are
 * removed by OSM element id after fetching. Their union covers the whole
 * built-up city (every licensed terrace sits inside it). One Overpass query is
 * issued per district, as required, to keep each response small. */
const DISTRICTS = [
  { name: "Ciutat Vella", bbox: [41.3640, 2.1620, 41.3920, 2.1990] },
  { name: "Eixample", bbox: [41.3740, 2.1430, 41.4060, 2.1880] },
  { name: "Sants-Montjuïc", bbox: [41.3470, 2.1130, 41.3880, 2.1760] },
  { name: "Les Corts", bbox: [41.3700, 2.1060, 41.3980, 2.1450] },
  { name: "Sarrià-Sant Gervasi", bbox: [41.3850, 2.0980, 41.4350, 2.1560] },
  { name: "Gràcia", bbox: [41.3920, 2.1340, 41.4220, 2.1700] },
  { name: "Horta-Guinardó", bbox: [41.4050, 2.1300, 41.4520, 2.1820] },
  { name: "Nou Barris", bbox: [41.4140, 2.1600, 41.4560, 2.2030] },
  { name: "Sant Andreu", bbox: [41.4030, 2.1760, 41.4520, 2.2150] },
  { name: "Sant Martí", bbox: [41.3800, 2.1760, 41.4280, 2.2350] },
];

/* ─── Overpass plumbing ────────────────────────────────────────────────────
 * Same mirrors and etiquette as the app's server proxy: descriptive UA,
 * per-request timeout, retry with backoff while rotating mirrors. Requests are
 * serialised (one district at a time) to stay well inside Overpass rate limits. */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 1500;
const REQUEST_TIMEOUT_MS = 90_000;
const PER_DISTRICT_PAUSE_MS = 2000; // be polite between districts
const USER_AGENT =
  "HaySol/1.0 (https://sol-sombre-map.vercel.app; Barcelona terrace sun/shade finder; one-time POI build)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildQuery([south, west, north, east]) {
  // `out center tags` gives nodes their lat/lon and ways a computed centre, so
  // both kinds of POI resolve to a single coordinate.
  return (
    `[out:json][timeout:90];` +
    `(` +
    `node["amenity"~"${AMENITY_RE}"](${south},${west},${north},${east});` +
    `way["amenity"~"${AMENITY_RE}"](${south},${west},${north},${east});` +
    `);` +
    `out center tags;`
  );
}

async function overpassRequest(query) {
  let lastError;
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
      if ([429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass busy (${res.status})`);
      if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = controller.signal.aborted
        ? new Error(`Overpass timed out after ${REQUEST_TIMEOUT_MS}ms (${endpoint})`)
        : err;
      if (attempt < MAX_ATTEMPTS - 1) {
        const wait = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 500;
        console.warn(`  ↻ ${endpoint} failed (${lastError.message}); retrying in ${Math.round(wait)}ms`);
        await sleep(wait);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Overpass: all attempts failed");
}

// Round to 6 dp (~0.11 m) — ample for a 25 m match, and keeps the file small.
const round6 = (n) => Math.round(n * 1e6) / 1e6;

async function main() {
  console.log(`Fetching Barcelona food/drink POIs from OpenStreetMap (${DISTRICTS.length} districts)…\n`);

  // Dedupe by OSM element id (overlapping bboxes will return the same POI twice).
  const byId = new Map();

  for (const { name, bbox } of DISTRICTS) {
    process.stdout.write(`• ${name}… `);
    const json = await overpassRequest(buildQuery(bbox));
    const elements = Array.isArray(json?.elements) ? json.elements : [];
    let kept = 0;
    for (const el of elements) {
      const tags = el.tags ?? {};
      const poiName = (tags.name ?? "").trim();
      if (!poiName) continue; // unnamed POI is useless as a label

      const lat = el.type === "node" ? el.lat : el.center?.lat;
      const lon = el.type === "node" ? el.lon : el.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const key = `${el.type}/${el.id}`;
      if (byId.has(key)) continue;

      byId.set(key, [round6(lon), round6(lat), poiName, tags.amenity]);
      kept++;
    }
    console.log(`${elements.length} elements, ${kept} new named POIs (total ${byId.size})`);
    await sleep(PER_DISTRICT_PAUSE_MS);
  }

  // Compact, stable schema: pois = [ [lng, lat, name, category], … ].
  // [lng, lat] matches the GeoJSON ordering used elsewhere in the app.
  const pois = [...byId.values()].sort((a, b) => a[2].localeCompare(b[2]));

  const payload = {
    attribution: "© OpenStreetMap contributors",
    license: "ODbL (https://opendatacommons.org/licenses/odbl/)",
    source: "OpenStreetMap via Overpass API",
    generatedAt: new Date().toISOString().slice(0, 10),
    schema: "[lng, lat, name, category]",
    count: pois.length,
    pois,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload), "utf8");

  const byCat = {};
  for (const p of pois) byCat[p[3]] = (byCat[p[3]] ?? 0) + 1;
  console.log(`\n✓ Wrote ${pois.length} POIs → ${OUT_PATH}`);
  console.log("  by category:", byCat);
}

main().catch((err) => {
  console.error("\n✗ Build failed:", err);
  process.exit(1);
});
