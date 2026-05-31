import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { Clock, Pencil, X, ExternalLink, Sun, TreePine, Moon, Plus, Minus, LocateFixed, Loader2, AlertTriangle } from "lucide-react";
import type { Map as MapboxMap, Marker as MapboxMarker, GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { fetchTerraces, terracesToGeoJSON, type Terrace, type TerraceState } from "@/lib/terraces";
import { getSunPosition, getNextSunriseISO } from "@/lib/sun";
import { fetchBuildings, type BBox, type BuildingFeature } from "@/lib/overpass";
import { fetchBusinessName } from "@/lib/census";
import type { ShadeResult, DurationResult } from "@/lib/shadow";

/* ════════════════════════════════════════════════════════════════════════
 * ¿Hay Sol? — MapView
 * ────────────────────────────────────────────────────────────────────────
 * Major systems are marked with banner comments so future steps are easy to
 * find:
 *   [MAP CONFIG]      — Barcelona centre, zoom, style, colours, token
 *   [TERRACE DATA]    — fetched from the open-data feed (src/lib/terraces.ts)
 *   [SUN POSITION]    — SunCalc day/night + azimuth (src/lib/sun.ts)
 *   [MAPBOX INIT]     — create the GL map, SSR-safe (client only)
 *   [TERRACE LAYER]   — GeoJSON source + circle layer + click/hover
 *   [SHADOW ENGINE]   — Overpass buildings + Web Worker ray-casting (Step 4)
 *   [DATA SYNC]       — paint dots from day/night + shadow results
 *   [MAP CONTROLS]    — zoom buttons + geolocate (Step 6)
 *   [UI CHROME]       — time pill, legend, popup, disclaimer (preserved design)
 *
 * Coming next: Step 5 fills the popup duration line.
 * ════════════════════════════════════════════════════════════════════════ */

/* ═══ [MAP CONFIG] ═══════════════════════════════════════════════════════ */

const BCN = { lng: 2.1734, lat: 41.3851 }; // Barcelona centre
// Open zoomed into a neighbourhood, not the whole city: shadow calc needs OSM
// buildings for the viewport, and a city-wide box is tens of thousands of
// buildings (too slow / rejected by the proxy). 16 ≈ a few blocks of dense Eixample.
const DEFAULT_ZOOM = 16;
const MAP_STYLE = "mapbox://styles/mapbox/light-v11"; // clean + minimal

// Dot colours mirror the --dot-sun / --dot-shade design tokens (styles.css).
const COLOR_SUN = "#FFD700"; // sol     (gold)
const COLOR_SHADE = "#3DAA6B"; // sombra  (green)
const COLOR_NIGHT = "#9AA0A6"; // night / unknown / calculating (grey)

// Client-side public token (injected by Vite). See .env / .env.example.
const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN ?? "").trim();
const HAS_TOKEN = TOKEN.startsWith("pk.");

const SOURCE_ID = "terraces";
const LAYER_ID = "terraces-dots";

// How long to wait after the user stops panning before recalculating.
const MOVE_DEBOUNCE_MS = 500;

/* ═══ helpers ════════════════════════════════════════════════════════════ */

function formatWhen(d: Date): string {
  const now = new Date();
  const time = d.toTimeString().slice(0, 5);

  // "Ahora" only within 5 minutes of the real current time — never for a
  // clearly past or future selection.
  if (Math.abs(d.getTime() - now.getTime()) <= 5 * 60_000) return `Ahora · ${time}`;

  // Relative day labels by calendar date.
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return `Hoy · ${time}`;
  if (dayDiff === 1) return `Mañana · ${time}`;
  if (dayDiff === -1) return `Ayer · ${time}`;

  // Otherwise: abbreviated weekday + day-of-month, e.g. "Sáb 31 · 10:00".
  const wd = d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
  return `${wd.charAt(0).toUpperCase() + wd.slice(1)} ${d.getDate()} · ${time}`;
}

// "2026-05-29T19:45:00" → "19:45"
function hhmm(iso: string): string {
  return new Date(iso).toTimeString().slice(0, 5);
}

// Human countdown between two epoch-ms times, e.g. "2h 15min" or "43min".
function countdown(fromMs: number, toMs: number): string {
  const min = Math.max(0, Math.round((toMs - fromMs) / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// Pad a bbox by a fraction on each side (so edge terraces still see buildings).
function padBBox(b: BBox, frac: number): BBox {
  const dLat = (b.north - b.south) * frac;
  const dLng = (b.east - b.west) * frac;
  return { south: b.south - dLat, west: b.west - dLng, north: b.north + dLat, east: b.east + dLng };
}

// Is `inner` fully inside `outer`? Used to reuse cached buildings on small moves.
function bboxContains(outer: BBox | null, inner: BBox): boolean {
  if (!outer) return false;
  return outer.south <= inner.south && outer.west <= inner.west && outer.north >= inner.north && outer.east >= inner.east;
}

type Props = {
  when: Date;
  onEdit: () => void;
};

export function MapView({ when, onEdit }: Props) {
  const [selected, setSelected] = useState<Terrace | null>(null);
  const [locating, setLocating] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  // Shadow engine state
  const [shadeStates, setShadeStates] = useState<ShadeResult>({});
  const [shadowStatus, setShadowStatus] = useState<"idle" | "loading" | "calculating" | "ready" | "error">("idle");
  const [durationInfo, setDurationInfo] = useState<DurationResult | null>(null); // Step 5: selected terrace
  const [geoError, setGeoError] = useState<string | null>(null); // Step 6: geolocation feedback

  // Live refs
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapboxglRef = useRef<(typeof import("mapbox-gl"))["default"] | null>(null);
  const userMarkerRef = useRef<MapboxMarker | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const buildingsRef = useRef<BuildingFeature[]>([]);
  const buildingsBoundsRef = useRef<BBox | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null); // cancels a stale buildings fetch when the view changes
  const latestStatesReqRef = useRef(0); // dedupe Step 4 "states" results
  const latestDurationReqRef = useRef(0); // dedupe Step 5 "duration" results
  const moveTimerRef = useRef<number | undefined>(undefined);
  const recalcRef = useRef<() => void>(() => {});

  /* ═══ [TERRACE DATA] ═══════════════════════════════════════════════════
   * Fetch the real terraces once (cached by React Query). See lib/terraces.ts.
   * ──────────────────────────────────────────────────────────────────── */
  const terracesQuery = useQuery({
    queryKey: ["terraces"],
    queryFn: () => fetchTerraces(),
    staleTime: Infinity,
    retry: 1,
  });
  const terraces = terracesQuery.data ?? [];

  /* ═══ [BUSINESS NAME] — Barcelona commercial census ════════════════════
   * On selection, look up the business at the terrace's address in the city's
   * ground-floor commercial census (`Nom_Local`) — see src/lib/census.ts.
   * Matches by address near the terrace, prefers food/drink. 100% open data,
   * no OSM. Cached per terrace; null → fall back to the address.
   * ──────────────────────────────────────────────────────────────────── */
  const nameQuery = useQuery({
    queryKey: ["businessName", selected?.id ?? "none"],
    queryFn: () => fetchBusinessName(selected!.lat, selected!.lng, selected!.name),
    enabled: !!selected,
    staleTime: Infinity,
    retry: 1,
  });

  /* ═══ [SUN POSITION] — Step 3 ══════════════════════════════════════════
   * Sun altitude/azimuth for Barcelona at the selected time. Night (altitude
   * ≤ 0) paints every terrace grey; the azimuth feeds the shadow cast below.
   * ──────────────────────────────────────────────────────────────────── */
  const sun = useMemo(() => getSunPosition(when), [when]);

  /* ═══ [SHADOW ENGINE] — Step 4 ═════════════════════════════════════════
   * recalcShadows: fetch buildings for the viewport (cached; refetched only
   * when the view leaves the cached box) and hand terraces + buildings + sun
   * to the Web Worker. Kept in a ref so the (once-registered) `moveend`
   * listener always calls the latest version (current sun/terraces).
   * ──────────────────────────────────────────────────────────────────── */
  recalcRef.current = () => {
    const map = mapRef.current;
    const worker = workerRef.current;
    if (!map || !worker || !mapReady) return;
    if (sun.isNight || terraces.length === 0) return; // night → handled by [DATA SYNC]

    const mb = map.getBounds();
    if (!mb) return;
    const view: BBox = { south: mb.getSouth(), west: mb.getWest(), north: mb.getNorth(), east: mb.getEast() };

    const post = (buildings: BuildingFeature[]) => {
      const requestId = ++latestStatesReqRef.current;
      setShadowStatus("calculating");
      worker.postMessage({
        type: "states",
        requestId,
        terraces: terraces.map((t) => ({ id: t.id, lng: t.lng, lat: t.lat })),
        buildings,
        sun: { altitudeRad: sun.altitudeRad, bearingFromNorthDeg: sun.bearingFromNorthDeg },
      });
    };

    // The view changed, so any in-flight buildings fetch is now stale — abort it
    // before doing anything else. Overpass rate-limits per IP (~4 slots), so
    // leaving superseded requests running is what trips the limit when panning.
    fetchAbortRef.current?.abort();

    if (bboxContains(buildingsBoundsRef.current, view)) {
      post(buildingsRef.current); // reuse cache (small pan / time change) — no fetch needed
      return;
    }

    const padded = padBBox(view, 0.2);
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setShadowStatus("loading");
    fetchBuildings(padded, controller.signal)
      .then((blds) => {
        if (controller.signal.aborted) return; // superseded by a newer view — drop it
        buildingsRef.current = blds;
        buildingsBoundsRef.current = padded;
        post(blds);
      })
      .catch((err) => {
        if (controller.signal.aborted) return; // aborted because the user moved on — not an error
        console.error("Overpass buildings fetch failed:", err);
        setShadowStatus("error");
      });
  };

  // Create the worker once (client-only; Vite bundles the worker from the URL).
  useEffect(() => {
    const worker = new Worker(new URL("../workers/shadow.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<{ type: "states" | "duration"; requestId: number; ok: boolean; result?: ShadeResult | DurationResult }>) => {
      const msg = e.data;
      if (msg.type === "states") {
        if (msg.requestId !== latestStatesReqRef.current) return; // ignore stale
        if (msg.ok && msg.result) {
          setShadeStates(msg.result as ShadeResult);
          setShadowStatus("ready");
        } else {
          setShadowStatus("error");
        }
      } else if (msg.type === "duration") {
        if (msg.requestId !== latestDurationReqRef.current) return; // ignore stale
        setDurationInfo(msg.ok && msg.result ? (msg.result as DurationResult) : null);
      }
    };
    // Without this, a worker that fails to load or throws at the top level would
    // leave the UI stuck on "Calculando sombras…" forever (onmessage never fires).
    // Surface it as an error instead.
    worker.onerror = (event) => {
      console.error("Shadow worker error:", event.message || event);
      setShadowStatus("error");
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
      fetchAbortRef.current?.abort(); // cancel any in-flight buildings fetch on unmount
    };
  }, []);

  // Recompute when the data, map, or time changes. Night clears everything;
  // otherwise dots go grey ("calculando") until the worker returns.
  useEffect(() => {
    if (!mapReady) return;
    if (sun.isNight) {
      setShadeStates({});
      setShadowStatus("idle");
      return;
    }
    setShadeStates({});
    recalcRef.current();
  }, [terraces, mapReady, sun]);

  // Sunrise time for the night message ("El sol sale a las 07:23").
  const sunriseISO = useMemo(() => (sun.isNight ? getNextSunriseISO(when) : null), [sun, when]);

  /* ═══ [SUN UNTIL X] — Step 5 ═══════════════════════════════════════════
   * When a terrace is open in daytime, ask the SAME worker how long its
   * current sun/shade lasts (15-min steps). Re-runs on time change or after a
   * fresh shadow result; the worker keeps it off the UI thread.
   * ──────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!selected || sun.isNight) {
      setDurationInfo(null);
      return;
    }
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = ++latestDurationReqRef.current;
    setDurationInfo(null); // "Calculando…" until it returns
    worker.postMessage({
      type: "duration",
      requestId,
      terrace: { id: selected.id, lng: selected.lng, lat: selected.lat },
      buildings: buildingsRef.current,
      startISO: when.toISOString(),
    });
  }, [selected, when, sun, shadeStates]);

  // Auto-dismiss the geolocation message after a few seconds.
  useEffect(() => {
    if (!geoError) return;
    const t = window.setTimeout(() => setGeoError(null), 6000);
    return () => window.clearTimeout(t);
  }, [geoError]);

  /* ═══ [MAPBOX INIT] ════════════════════════════════════════════════════
   * Create the GL map once, client-side only. mapbox-gl is dynamically
   * imported inside the effect so its browser-only code never runs during SSR.
   * ──────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!HAS_TOKEN) return; // no token → show the overlay instead (see render)
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !mapContainer.current || mapRef.current) return;
      mapboxglRef.current = mapboxgl;
      mapboxgl.accessToken = TOKEN;

      const map = new mapboxgl.Map({
        container: mapContainer.current,
        style: MAP_STYLE,
        center: [BCN.lng, BCN.lat],
        zoom: DEFAULT_ZOOM,
        attributionControl: true, // keep Mapbox/OSM attribution (required by TOS)
      });
      mapRef.current = map;

      // Gestures: scroll-wheel zoom (desktop) + pinch-to-zoom (mobile) — Step 6.
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();

      map.on("load", () => {
        if (cancelled) return;
        map.resize();

        /* ═══ [TERRACE LAYER] ══════════════════════════════════════════════
         * One GeoJSON source + one circle layer renders every terrace. It
         * starts empty; [DATA SYNC] calls setData() once data/shadows arrive.
         * ──────────────────────────────────────────────────────────────── */
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          promoteId: "id",
        });

        map.addLayer({
          id: LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              11, ["case", ["boolean", ["feature-state", "selected"], false], 6, 3],
              14, ["case", ["boolean", ["feature-state", "selected"], false], 9, 5.5],
              17, ["case", ["boolean", ["feature-state", "selected"], false], 14, 9],
            ],
            "circle-color": [
              "match", ["get", "state"],
              "sun", COLOR_SUN,
              "shade", COLOR_SHADE,
              COLOR_NIGHT, // night / unknown / calculating
            ],
            "circle-stroke-width": [
              "case", ["boolean", ["feature-state", "selected"], false], 3.5, 1.5,
            ],
            "circle-stroke-color": [
              "case", ["boolean", ["feature-state", "selected"], false], "#1a1a17", "#ffffff",
            ],
            "circle-opacity": 0.95,
          },
        });

        // Click a dot → open the popup card + highlight via feature-state.
        map.on("click", LAYER_ID, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const props = f.properties as { id: string; name: string; address: string; state: TerraceState };
          const id = String(props.id);
          const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;

          if (selectedIdRef.current && selectedIdRef.current !== id) {
            map.setFeatureState({ source: SOURCE_ID, id: selectedIdRef.current }, { selected: false });
          }
          map.setFeatureState({ source: SOURCE_ID, id }, { selected: true });
          selectedIdRef.current = id;
          setSelected({ id, name: props.name, address: props.address, lng, lat, state: props.state });
        });

        map.on("mouseenter", LAYER_ID, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", LAYER_ID, () => { map.getCanvas().style.cursor = ""; });

        // Recompute shadows after the user pans/zooms (debounced). Buildings
        // are cached per viewport, so small moves reuse the existing data.
        map.on("moveend", () => {
          window.clearTimeout(moveTimerRef.current);
          moveTimerRef.current = window.setTimeout(() => recalcRef.current(), MOVE_DEBOUNCE_MS);
        });

        setMapReady(true);
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      userMarkerRef.current = null;
      selectedIdRef.current = null;
    };
  }, []);

  /* ═══ [DATA SYNC] ══════════════════════════════════════════════════════
   * Paint each dot: night → grey; otherwise the worker's sun/shade result, or
   * grey ("calculando") until it arrives.
   * ──────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!src) return;
    const colored = terraces.map((t) => {
      const state: TerraceState = sun.isNight ? "night" : (shadeStates[t.id] ?? "unknown");
      return { ...t, state };
    });
    src.setData(terracesToGeoJSON(colored));
  }, [terraces, mapReady, sun, shadeStates]);

  /* ═══ [MAP CONTROLS] — Step 6 ══════════════════════════════════════════ */

  const zoomIn = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();

  const handleGeolocate = () => {
    const map = mapRef.current;
    const mapboxgl = mapboxglRef.current;
    if (!map || !mapboxgl) return;

    // Geolocation needs a secure context (HTTPS or localhost). On plain HTTP
    // over a LAN IP, navigator.geolocation is unavailable → tell the user.
    if (!navigator.geolocation || (typeof window !== "undefined" && !window.isSecureContext)) {
      setGeoError("Activa la ubicación para encontrar terrazas cercanas.");
      return;
    }

    setGeoError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        if (userMarkerRef.current) {
          userMarkerRef.current.setLngLat([longitude, latitude]);
        } else {
          const el = document.createElement("div");
          el.className = "haysol-user-dot";
          userMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([longitude, latitude]).addTo(map);
        }
        map.flyTo({ center: [longitude, latitude], zoom: 16, essential: true });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        // PERMISSION_DENIED → ask them to enable it; other errors → generic retry.
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Activa la ubicación para encontrar terrazas cercanas."
            : "No pudimos obtener tu ubicación. Inténtalo de nuevo."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const closePopup = () => {
    const id = selectedIdRef.current;
    if (id && mapRef.current) mapRef.current.setFeatureState({ source: SOURCE_ID, id }, { selected: false });
    selectedIdRef.current = null;
    setSelected(null);
  };

  /* ═══ [UI CHROME] — preserved from the original design ═════════════════ */

  const sel = selected;
  // OSM business name for the open card (null while loading or if none nearby).
  const osmName = sel && nameQuery.data ? nameQuery.data : null;
  const popupSubtitle = sel ? (osmName ? [sel.name, sel.address].filter(Boolean).join(" · ") : sel.address) : "";
  // Live state for the open card — reflects the CURRENT time + shadow results,
  // not the state captured when it was clicked (Step 5 polish).
  const selState: TerraceState | null = sel ? (sun.isNight ? "night" : (shadeStates[sel.id] ?? "unknown")) : null;
  const isSun = selState === "sun";
  const isShade = selState === "shade";
  const isNight = selState === "night";

  // Popup duration line (Step 5).
  let durationText: string | null = null;
  if (isNight) {
    durationText = sunriseISO ? `El sol sale a las ${hhmm(sunriseISO)}` : "El sol sale por la mañana";
  } else if ((isSun || isShade) && durationInfo && durationInfo.current === selState) {
    if (durationInfo.changeAtISO && !durationInfo.untilSunset) {
      const cd = countdown(when.getTime(), new Date(durationInfo.changeAtISO).getTime());
      durationText = isSun
        ? `Sol hasta las ${hhmm(durationInfo.changeAtISO)} · ${cd} más`
        : `Sol desde las ${hhmm(durationInfo.changeAtISO)} · en ${cd}`;
    } else {
      durationText = isSun ? "Sol hasta el atardecer" : "A la sombra hasta el atardecer";
    }
  } else if (isSun || isShade) {
    durationText = "Calculando…";
  }

  // Loading messages → centered bold card (so they're not missed on slow loads);
  // errors → small top pill.
  const loadingMessage = terracesQuery.isPending
    ? "Cargando terrazas…"
    : !sun.isNight && (shadowStatus === "loading" || shadowStatus === "calculating")
      ? "Calculando sombras…"
      : null;
  const errorMessage = terracesQuery.isError
    ? "No se pudieron cargar las terrazas"
    : !sun.isNight && shadowStatus === "error"
      ? "Sombras no disponibles"
      : null;

  return (
    <section className="relative w-full h-screen overflow-hidden bg-muted">
      {/* Real Mapbox canvas mounts here (replaces the old fake SVG map).
          NOTE: mapbox-gl.css adds `.mapboxgl-map { position: relative }`, which
          would override a Tailwind `absolute` class and collapse the height to 0.
          We pin position + insets inline (highest specificity) so the map always
          fills the full-screen <section> regardless of stylesheet load order. */}
      <div ref={mapContainer} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />

      {/* No-token fallback: friendly message instead of a blank/broken map */}
      {!HAS_TOKEN && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-muted px-6 text-center">
          <div className="max-w-sm rounded-3xl bg-background shadow-lg p-6">
            <Sun className="mx-auto size-8 text-terracotta" />
            <h2 className="mt-3 font-display text-xl font-bold">Falta el token de Mapbox</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Añade tu <code className="font-mono">VITE_MAPBOX_TOKEN</code> en el archivo{" "}
              <code className="font-mono">.env</code> y reinicia el servidor para ver el mapa.
            </p>
          </div>
        </div>
      )}

      {/* Loading message — centered + bold (like the night message) so it's not
          missed if a slow Overpass/data load takes a while */}
      {HAS_TOKEN && loadingMessage && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-[min(90%,22rem)] pointer-events-none">
          <div className="rounded-3xl bg-background/95 backdrop-blur px-5 py-4 text-center shadow-lg">
            <p className="flex items-center justify-center gap-2 font-display text-base font-bold">
              <Loader2 className="size-5 animate-spin" /> {loadingMessage}
            </p>
          </div>
        </div>
      )}

      {/* Error pill (top) */}
      {HAS_TOKEN && errorMessage && (
        <div className="absolute top-[4.5rem] left-1/2 -translate-x-1/2 z-20">
          <span className="flex items-center gap-2 rounded-full bg-destructive text-destructive-foreground px-3 py-1.5 shadow-md text-xs font-medium">
            <AlertTriangle className="size-3.5" /> {errorMessage}
          </span>
        </div>
      )}

      {/* Night message — warm + friendly, not an error (Steps 3/4) */}
      {HAS_TOKEN && sun.isNight && !loadingMessage && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-[min(90%,22rem)] pointer-events-none">
          <div className="rounded-3xl bg-background/95 backdrop-blur px-5 py-4 text-center shadow-lg">
            <p className="font-display text-base font-bold">🌙 Esta noche no hay sol</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {sunriseISO ? `El sol sale a las ${hhmm(sunriseISO)}` : "El sol sale por la mañana"}
            </p>
          </div>
        </div>
      )}

      {/* Time pill (top) */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 md:left-6 md:translate-x-0">
        <button
          onClick={onEdit}
          className="flex items-center gap-2 rounded-full bg-foreground text-background pl-4 pr-3 py-2.5 shadow-lg font-display font-semibold text-sm hover:bg-terracotta transition-colors"
        >
          <Clock className="size-4" />
          {formatWhen(when)}
          <span className="ml-1 grid place-items-center size-6 rounded-full bg-background/15">
            <Pencil className="size-3" />
          </span>
        </button>
      </div>

      {/* Legend (top-right) */}
      <div className="absolute top-4 right-4 z-20 hidden sm:flex flex-col gap-1.5 rounded-2xl bg-background/90 backdrop-blur px-3 py-2 shadow-md text-xs font-medium">
        <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-dot-sun ring-2 ring-foreground/10" /> Sol</span>
        <span className="flex items-center gap-2"><span className="size-3 rounded-full bg-dot-shade ring-2 ring-foreground/10" /> Sombra</span>
      </div>

      {/* Map controls (bottom-right): zoom + geolocate */}
      <div className="absolute bottom-6 right-4 z-20 flex flex-col gap-2 items-end">
        <div className="flex flex-col rounded-full bg-background shadow-lg overflow-hidden">
          <button
            onClick={zoomIn}
            aria-label="Acercar"
            className="grid place-items-center size-11 hover:bg-muted transition-colors disabled:opacity-50"
            disabled={!mapReady}
          >
            <Plus className="size-5" />
          </button>
          <div className="h-px bg-border" />
          <button
            onClick={zoomOut}
            aria-label="Alejar"
            className="grid place-items-center size-11 hover:bg-muted transition-colors disabled:opacity-50"
            disabled={!mapReady}
          >
            <Minus className="size-5" />
          </button>
        </div>
        <button
          onClick={handleGeolocate}
          aria-label="Mi ubicación"
          disabled={locating || !mapReady}
          className="grid place-items-center size-12 rounded-full bg-background shadow-lg hover:bg-muted transition-colors disabled:opacity-70"
        >
          {locating ? <Loader2 className="size-5 animate-spin" /> : <LocateFixed className="size-5" />}
        </button>
        {locating && (
          <span className="rounded-full bg-foreground text-background text-xs font-display font-semibold px-3 py-1.5 shadow-lg whitespace-nowrap">
            Buscando tu ubicación...
          </span>
        )}
        {geoError && !locating && (
          <span className="max-w-[220px] rounded-2xl bg-foreground text-background text-xs font-medium px-3 py-2 shadow-lg text-right">
            {geoError}
          </span>
        )}
      </div>

      {/* Disclaimer — shadows are a calculated estimate, not surveyed truth */}
      <div className="absolute bottom-7 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <span className="rounded-full bg-background/60 backdrop-blur-sm px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/90">
          Sombras aproximadas
        </span>
      </div>

      {/* Popup card (bottom sheet) */}
      <AnimatePresence>
        {sel && (
          <motion.div
            key={sel.id}
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute z-30 bottom-0 left-0 right-0 md:left-6 md:bottom-6 md:right-auto md:w-80 rounded-t-3xl md:rounded-3xl bg-background shadow-[0_-8px_30px_rgba(0,0,0,0.15)] p-5 pb-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`grid place-items-center size-9 rounded-full ${
                    isSun
                      ? "bg-dot-sun text-foreground"
                      : isShade
                        ? "bg-dot-shade text-background"
                        : "bg-muted-foreground text-background"
                  }`}
                >
                  {isSun ? <Sun className="size-5" /> : isShade ? <TreePine className="size-5" /> : isNight ? <Moon className="size-5" /> : <Sun className="size-5" />}
                </span>
                <span className="font-display font-semibold text-sm">
                  {isSun ? "En el sol" : isShade ? "En la sombra" : isNight ? "Es de noche" : "Terraza"}
                </span>
              </div>
              <button
                onClick={closePopup}
                className="grid place-items-center size-8 rounded-full hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="size-4" />
              </button>
            </div>
            {/* Step 5: real "Sun until X" line (computed in the worker). */}
            {durationText && (
              <p className="mt-1.5 text-xs text-muted-foreground">{durationText}</p>
            )}
            {/* Heading: OSM business name if found, otherwise the street address */}
            <h2 className="mt-3 font-display text-2xl font-bold leading-tight">{osmName ?? sel.name}</h2>
            {popupSubtitle && <p className="mt-1 text-sm text-muted-foreground">{popupSubtitle}</p>}
            {/* ¿Cómo llegar? — open Google Maps at the terrace's exact GPS
                coordinates (most accurate; Maps drops a pin + offers directions). */}
            <a
              href={`https://www.google.com/maps?q=${sel.lat},${sel.lng}`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 font-display font-semibold text-terracotta hover:text-coral"
            >
              ¿Cómo llegar?
              <ExternalLink className="size-4" />
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
