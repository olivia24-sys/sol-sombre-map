/* ════════════════════════════════════════════════════════════════════════
 * [BUSINESS NAMES] — Barcelona commercial-activities census
 * ────────────────────────────────────────────────────────────────────────
 * The terrace-licence dataset has NO business name (only an address). The
 * city's ground-floor commercial census DOES: field `Nom_Local` (e.g. "BAR
 * RESTAURANTE GAUDÍ"), with street, house number and coordinates. We join a
 * terrace to its business by ADDRESS (street + number) near the terrace point,
 * preferring food/drink premises. 100% Barcelona open data — no OSM.
 *
 * Dataset: cens-locals-planta-baixa-act-economica (≈44k premises). We query it
 * with a coordinate bounding box via CKAN's SQL endpoint (CORS-enabled).
 * ════════════════════════════════════════════════════════════════════════ */

const CENSUS_RESOURCE_ID = "38babeec-5c47-43d3-84e7-b13a4b89004f"; // 2024 census
const SQL_ENDPOINT = "https://opendata-ajuntament.barcelona.cat/data/api/3/action/datastore_search_sql";

// Activity names (Nom_Activitat) that mean "you could sit at a terrace here".
const FOOD_DRINK_RE = /\b(bars?|restaurant|cibercaf|cafeteri|menjar|tapes|degustaci|gelat|orxat|pizz|cerve)/i;

// Street-type words + articles to ignore when comparing streets, so the
// open-data abbreviations ("AV.", "PG.", "G.V.") match the census's names.
const STREET_STOPWORDS = new Set([
  "carrer", "c", "cr", "avinguda", "avgda", "av", "passeig", "pg", "pge", "ptge",
  "passatge", "ronda", "rda", "via", "gran", "rambla", "rambles", "rbla",
  "placa", "plaza", "pl", "p", "travessera", "trav", "baixada", "pujada",
  "cami", "moll", "gv", "g", "v",
  "de", "del", "dels", "d", "la", "les", "el", "els", "l", "i", "a",
]);

// Lowercase + strip accents.
function deburr(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Core street tokens (street-type words + articles removed).
function streetTokens(street: string): Set<string> {
  return new Set(deburr(street).split(/[^a-z0-9]+/).filter((t) => t && !STREET_STOPWORDS.has(t)));
}

// Split a "Street, 25" address into core tokens + house number.
function parseAddress(addr: string): { tokens: Set<string>; number: string } {
  const d = deburr(addr);
  const numMatch = d.match(/(\d+)\s*[a-z]?\s*$/);
  const number = numMatch ? numMatch[1] : "";
  const streetPart = d.replace(/,?\s*\d+\s*[a-z]?\s*$/, "");
  return { tokens: streetTokens(streetPart), number };
}

// 0..1 token-overlap similarity between two street-token sets.
function tokenSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

// Is house number `n` within the census premise's [ini, fin] range?
function numberInRange(n: string, ini: string, fin: string): boolean {
  const num = parseInt(n, 10);
  if (!Number.isFinite(num)) return false;
  const a = parseInt(ini, 10);
  const b = parseInt(fin, 10);
  if (Number.isFinite(a) && Number.isFinite(b)) return num >= Math.min(a, b) && num <= Math.max(a, b);
  if (Number.isFinite(a)) return num === a;
  return false;
}

// Great-circle distance in metres (tie-breaker among address matches).
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// "BAR RESTAURANTE GAUDÍ" → "Bar Restaurante Gaudí" (census names are UPPERCASE).
function titleCase(s: string): string {
  return s.toLowerCase().split(/(\s+)/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

type CensusRecord = {
  Nom_Local?: string;
  Nom_Activitat?: string;
  Nom_Via?: string;
  Num_Policia_Inicial?: string;
  Num_Policia_Final?: string;
  Latitud?: string;
  Longitud?: string;
};

/**
 * Business name for a terrace, from the commercial census. Matches by ADDRESS
 * (street + house number) near the terrace, preferring food/drink premises.
 * Returns null if nothing suitable → callers fall back to the street address.
 */
export async function fetchBusinessName(lat: number, lng: number, terraceAddress: string): Promise<string | null> {
  // ~30 m bounding box around the terrace coordinate.
  const dLat = 30 / 111_000;
  const dLng = 30 / (111_000 * Math.cos((lat * Math.PI) / 180));
  const sql =
    `SELECT "Nom_Local","Nom_Activitat","Nom_Via","Num_Policia_Inicial","Num_Policia_Final","Latitud","Longitud" ` +
    `FROM "${CENSUS_RESOURCE_ID}" ` +
    `WHERE CAST("Latitud" AS double precision) BETWEEN ${lat - dLat} AND ${lat + dLat} ` +
    `AND CAST("Longitud" AS double precision) BETWEEN ${lng - dLng} AND ${lng + dLng} LIMIT 100`;

  const res = await fetch(`${SQL_ENDPOINT}?sql=${encodeURIComponent(sql)}`);
  if (!res.ok) throw new Error(`Census API responded ${res.status}`);
  const json = await res.json();
  if (!json?.success) return null;
  const records: CensusRecord[] = json.result?.records ?? [];

  const target = parseAddress(terraceAddress);

  let addrFood: { name: string; dist: number } | null = null; // food/drink at the exact address
  let addrAny: { name: string; dist: number } | null = null; // any business at the exact address
  let nearFood: { name: string; dist: number } | null = null; // nearest food/drink in the box

  for (const r of records) {
    const nom = (r.Nom_Local ?? "").trim();
    if (!nom || nom.toUpperCase() === "SN") continue; // "SN" = vacant unit

    const rLat = parseFloat(String(r.Latitud));
    const rLng = parseFloat(String(r.Longitud));
    const dist = Number.isFinite(rLat) && Number.isFinite(rLng) ? haversineM(lat, lng, rLat, rLng) : Infinity;

    const isFood = FOOD_DRINK_RE.test(r.Nom_Activitat ?? "");
    const streetMatch = tokenSim(target.tokens, streetTokens(r.Nom_Via ?? "")) >= 0.5;
    const numberMatch = !!target.number && numberInRange(target.number, r.Num_Policia_Inicial ?? "", r.Num_Policia_Final ?? "");

    if (streetMatch && numberMatch) {
      if (isFood && (!addrFood || dist < addrFood.dist)) addrFood = { name: nom, dist };
      if (!addrAny || dist < addrAny.dist) addrAny = { name: nom, dist };
    }
    if (isFood && (!nearFood || dist < nearFood.dist)) nearFood = { name: nom, dist };
  }

  // Prefer a food/drink business at the exact address; then any business at
  // that address; then the nearest food/drink premise if it's very close.
  const pick = addrFood ?? addrAny ?? (nearFood && nearFood.dist <= 25 ? nearFood : null);
  return pick ? titleCase(pick.name) : null;
}
