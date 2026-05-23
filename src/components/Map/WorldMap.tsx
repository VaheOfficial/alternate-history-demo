import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMapData } from "./useMapData";
import { buildCountryFillMap } from "../../lib/map/renderer";
import {
  applyView,
  buildCities,
  buildCountryHighlight,
  buildCountryLabels,
  buildPolygons,
  buildUnits,
  clampView,
  createCityLayer,
  createCountryLabelLayer,
  createHighlightLayer,
  createPixiScene,
  createTileSet,
  createUnitLayer,
  resetTiles,
  resizeRenderer,
  updateCities,
  updateCountryHighlight,
  updateCountryLabels,
  updateTiles,
  updateUnits,
  worldExtentAtBase,
  type CityLayer,
  type CountryLabelLayer,
  type HighlightLayer,
  type SceneHandles,
  type TileSet,
  type UnitLayer,
} from "../../lib/map/pixi-renderer";
import { loadCities, type City } from "../../lib/map/cities";
import { loadCountries, type Country } from "../../lib/map/countries";
import { buildProvinceIndex, pickProvince, type ProvinceIndex } from "../../lib/map/hit-test";

const COLORS = {
  background: 0x040810,
  neutralLand: "#3a5e3a",
  border: "#2a2218",
  borderAlpha: 0.5,
};

const BG_DARKEN = 0.55;
const TILE_MAX_LOD = 5;

interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}

const INITIAL_VIEW: ViewState = { panX: 0, panY: 0, zoom: 1 };

function clampToWorld(
  v: ViewState,
  canvasSize: { w: number; h: number },
): ViewState {
  const ext = worldExtentAtBase(canvasSize.w, canvasSize.h);
  return clampView(v, { w: canvasSize.w, h: canvasSize.h }, ext);
}

export interface ProvinceHoverInfo {
  shape_id: string;
  /** Mouse position in viewport pixels, for tooltip placement. */
  clientX: number;
  clientY: number;
}

export function WorldMap({
  ownershipColors,
  playerIso,
  selectedIso,
  ownedByIso,
  onProvinceHover,
  onProvinceClick,
  unitStacks,
}: {
  ownershipColors?: Map<string, string>;
  /** ISO3 of the player's nation — outlined permanently. */
  playerIso?: string | null;
  /** ISO3 of a currently-clicked country — outlined transiently. */
  selectedIso?: string | null;
  /**
   * Live ownership map: ISO3 → set of shape_ids currently owned by that
   * nation. Drives the country-outline highlight, replacing the
   * baked-at-build-time outline file so newly-conquered territory
   * extends the highlight ring.
   */
  ownedByIso?: Map<string, Set<string>>;
  onProvinceHover?: (info: ProvinceHoverInfo | null) => void;
  onProvinceClick?: (shape_id: string, modifiers: { shift: boolean }) => void;
  /** Per-province unit stack data — drawn as small circles with count badges. */
  unitStacks?: Array<{
    lon: number;
    lat: number;
    ownerColor: string;
    altOwnerColor?: string;
    count: number;
  }>;
}) {
  const state = useMapData();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandles | null>(null);
  const tilesRef = useRef<TileSet | null>(null);
  const cityLayerRef = useRef<CityLayer | null>(null);
  const countryLayerRef = useRef<CountryLabelLayer | null>(null);
  const highlightLayerRef = useRef<HighlightLayer | null>(null);
  const unitLayerRef = useRef<UnitLayer | null>(null);
  const indexRef = useRef<ProvinceIndex | null>(null);

  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 500 });
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [ready, setReady] = useState(false);
  const [cities, setCities] = useState<City[] | null>(null);
  const [countries, setCountries] = useState<Country[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCities(), loadCountries()])
      .then(([c, cs]) => {
        if (cancelled) return;
        setCities(c);
        setCountries(cs);
      })
      .catch(() => {
        // fall through with no labels
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const countryFill = useMemo(() => {
    if (state.status !== "ready") return null;
    return buildCountryFillMap(state.data);
  }, [state]);
  const effectiveFill = ownershipColors ?? countryFill ?? undefined;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      const w = Math.max(1, Math.floor(cr.width));
      const h = Math.max(1, Math.floor(cr.height));
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initialize the PIXI scene + tile set once.
  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    let scene: SceneHandles | null = null;

    (async () => {
      scene = await createPixiScene(
        hostRef.current!,
        size.w,
        size.h,
        COLORS.background,
      );
      if (cancelled) {
        scene.destroy();
        return;
      }
      sceneRef.current = scene;
      tilesRef.current = createTileSet(
        scene.tileContainer,
        worldExtentAtBase(size.w, size.h),
        TILE_MAX_LOD,
        BG_DARKEN,
      );
      cityLayerRef.current = createCityLayer(scene.cityContainer);
      countryLayerRef.current = createCountryLabelLayer(scene.countryLabelContainer);
      highlightLayerRef.current = createHighlightLayer(scene.highlightContainer);
      unitLayerRef.current = createUnitLayer(scene.unitContainer);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (scene) scene.destroy();
      sceneRef.current = null;
      tilesRef.current = null;
      cityLayerRef.current = null;
      countryLayerRef.current = null;
      highlightLayerRef.current = null;
      unitLayerRef.current = null;
      indexRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild polygons + labels + reset tile set on size/data/fill changes.
  useEffect(() => {
    const scene = sceneRef.current;
    const tiles = tilesRef.current;
    const cityLayer = cityLayerRef.current;
    const countryLayer = countryLayerRef.current;
    const highlightLayer = highlightLayerRef.current;
    const unitLayer = unitLayerRef.current;
    if (!scene || !tiles || !cityLayer || !countryLayer || !highlightLayer || !unitLayer || !ready) return;
    if (state.status !== "ready") return;

    resizeRenderer(scene.app, size.w, size.h);

    buildPolygons(scene.fillsContainer, scene.bordersContainer, {
      features: state.data.features,
      width: size.w,
      height: size.h,
      fillByShapeId: effectiveFill ?? new Map(),
      neutralLand: COLORS.neutralLand,
      borderColor: COLORS.border,
      borderAlpha: COLORS.borderAlpha,
      borderWidth: 1,
      fillAlpha: 0.42,
    });

    if (cities) buildCities(cityLayer, cities, size.w, size.h);
    if (countries) buildCountryLabels(countryLayer, countries, size.w, size.h);
    indexRef.current = buildProvinceIndex(state.data.features, size.w, size.h);

    // Outer-boundary highlight, computed live from current ownership so
    // conquered territory immediately extends the ring. Internal segments
    // between two co-owned provinces are filtered out via segment-count
    // dissolve inside buildCountryHighlight.
    buildCountryHighlight(
      highlightLayer,
      state.data.features,
      ownedByIso ?? new Map(),
      size.w,
      size.h,
      [
        ...(playerIso
          ? [
              {
                iso_a3: playerIso,
                color: "#7aa2f7",
                baseWidth: 3.0,
                alpha: 0.95,
              },
            ]
          : []),
        ...(selectedIso
          ? [
              {
                iso_a3: selectedIso,
                color: "#f5d76e",
                baseWidth: 2.6,
                alpha: 0.95,
              },
            ]
          : []),
      ],
    );

    resetTiles(tiles, worldExtentAtBase(size.w, size.h));
    const clamped = clampToWorld(view, size);
    const applyV = clamped;
    if (clamped.panX !== view.panX || clamped.panY !== view.panY) {
      setView(clamped);
    }
    if (unitStacks && unitStacks.length > 0) {
      buildUnits(unitLayer, size.w, size.h, unitStacks);
    } else {
      buildUnits(unitLayer, size.w, size.h, []);
    }

    applyView(scene.mapContainer, applyV);
    updateTiles(tiles, applyV, { w: size.w, h: size.h });
    updateCities(cityLayer, applyV, { w: size.w, h: size.h });
    updateCountryLabels(countryLayer, applyV, { w: size.w, h: size.h });
    updateCountryHighlight(highlightLayer, applyV);
    updateUnits(unitLayer, applyV, { w: size.w, h: size.h });
  }, [ready, state, size, effectiveFill, cities, countries, ownedByIso, playerIso, selectedIso, unitStacks]);

  // Per-view update: apply transform + sync tile / city / country / highlight.
  useEffect(() => {
    const scene = sceneRef.current;
    const tiles = tilesRef.current;
    const cityLayer = cityLayerRef.current;
    const countryLayer = countryLayerRef.current;
    const highlightLayer = highlightLayerRef.current;
    const unitLayer = unitLayerRef.current;
    if (!scene || !tiles || !cityLayer || !countryLayer || !highlightLayer || !unitLayer || !ready) return;
    applyView(scene.mapContainer, view);
    updateTiles(tiles, view, { w: size.w, h: size.h });
    updateCities(cityLayer, view, { w: size.w, h: size.h });
    updateCountryLabels(countryLayer, view, { w: size.w, h: size.h });
    updateCountryHighlight(highlightLayer, view);
    updateUnits(unitLayer, view, { w: size.w, h: size.h });
  }, [view, ready, size.w, size.h]);

  // Drag (pan) — also tracks recent drag distance so a click that follows a
  // tiny mouse-down/move/up doesn't get suppressed as a drag.
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    moved: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: view.panX,
      panY: view.panY,
      moved: 0,
    };
    setDragging(true);
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const c = hostRef.current;
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
      setView((v) =>
        clampToWorld({ ...v, panX: drag.panX + dx, panY: drag.panY + dy }, size),
      );
      return;
    }

    // Hover hit-test: only when not dragging, and only if the parent cares.
    if (!c || !onProvinceHover) return;
    const idx = indexRef.current;
    if (!idx) return;
    const rect = c.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = (sx - viewRef.current.panX) / viewRef.current.zoom;
    const wy = (sy - viewRef.current.panY) / viewRef.current.zoom;
    const sid = pickProvince(idx, wx, wy);
    if (sid) {
      onProvinceHover({ shape_id: sid, clientX: e.clientX, clientY: e.clientY });
    } else {
      onProvinceHover(null);
    }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const wasDrag = drag && drag.moved > 4;
    dragRef.current = null;
    setDragging(false);
    if (wasDrag || !onProvinceClick) return;

    const c = hostRef.current;
    const idx = indexRef.current;
    if (!c || !idx) return;
    const rect = c.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = (sx - viewRef.current.panX) / viewRef.current.zoom;
    const wy = (sy - viewRef.current.panY) / viewRef.current.zoom;
    const sid = pickProvince(idx, wx, wy);
    if (sid) onProvinceClick(sid, { shift: e.shiftKey });
  };

  const onMouseLeave = () => {
    dragRef.current = null;
    setDragging(false);
    if (onProvinceHover) onProvinceHover(null);
  };

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const c = hostRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const newZoom = clamp(v.zoom * factor, 0.4, 64);
        const wx = (mouseX - v.panX) / v.zoom;
        const wy = (mouseY - v.panY) / v.zoom;
        return clampToWorld(
          {
            panX: mouseX - wx * newZoom,
            panY: mouseY - wy * newZoom,
            zoom: newZoom,
          },
          size,
        );
      });
    },
    [size],
  );

  const resetView = () => setView(clampToWorld(INITIAL_VIEW, size));

  return (
    <div style={containerStyle} ref={containerRef}>
      <div
        ref={hostRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
        style={{
          position: "absolute",
          inset: 0,
          cursor: dragging ? "grabbing" : "grab",
        }}
      />
      {state.status === "loading" && (
        <div style={messageStyle}>Loading map…</div>
      )}
      {state.status === "error" && (
        <div style={{ ...messageStyle, color: "salmon" }}>
          Failed to load map: {state.message}
        </div>
      )}
      <button onClick={resetView} style={resetButtonStyle}>
        Reset view
      </button>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: "#040810",
  overflow: "hidden",
};

const messageStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  color: "var(--fg-muted)",
  fontSize: "var(--fs-md)",
  fontWeight: 500,
  letterSpacing: "-0.005em",
  pointerEvents: "none",
};

const resetButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  padding: "7px 14px",
  background: "rgba(15, 17, 21, 0.78)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 550,
  letterSpacing: "-0.005em",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  zIndex: 10,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
