import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMapData } from "./useMapData";
import { buildCountryFillMap } from "../../lib/map/renderer";
import {
  applyView,
  buildCities,
  buildPolygons,
  clampView,
  createCityLayer,
  createPixiScene,
  createTileSet,
  resetTiles,
  resizeRenderer,
  updateCities,
  updateTiles,
  worldExtentAtBase,
  type CityLayer,
  type SceneHandles,
  type TileSet,
} from "../../lib/map/pixi-renderer";
import { loadCities, type City } from "../../lib/map/cities";

const COLORS = {
  background: 0x040810,
  neutralLand: "#3a5e3a",
  // Dark warm slate — softer than pure black over the satellite imagery.
  // Double-draw (each border belongs to two polygons) plus WebGL's tendency
  // to over-cover thin lines means the effective opacity is higher than the
  // alpha here suggests; a non-black base color keeps it readable.
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

export function WorldMap({
  ownershipColors,
}: {
  ownershipColors?: Map<string, string>;
}) {
  const state = useMapData();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandles | null>(null);
  const tilesRef = useRef<TileSet | null>(null);
  const cityLayerRef = useRef<CityLayer | null>(null);

  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 500 });
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [ready, setReady] = useState(false);
  const [cities, setCities] = useState<City[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCities()
      .then((c) => {
        if (!cancelled) setCities(c);
      })
      .catch(() => {
        // fall through with no cities
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
      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (scene) scene.destroy();
      sceneRef.current = null;
      tilesRef.current = null;
      cityLayerRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild polygons + cities + reset tile set on size/data/fill changes.
  useEffect(() => {
    const scene = sceneRef.current;
    const tiles = tilesRef.current;
    const cityLayer = cityLayerRef.current;
    if (!scene || !tiles || !cityLayer || !ready) return;
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

    if (cities) {
      buildCities(cityLayer, cities, size.w, size.h);
    }

    resetTiles(tiles, worldExtentAtBase(size.w, size.h));
    const clamped = clampToWorld(view, size);
    const applyV = clamped;
    if (clamped.panX !== view.panX || clamped.panY !== view.panY) {
      setView(clamped);
    }
    applyView(scene.mapContainer, applyV);
    updateTiles(tiles, applyV, { w: size.w, h: size.h });
    updateCities(cityLayer, applyV, { w: size.w, h: size.h });
  }, [ready, state, size, effectiveFill, cities]);

  // Per-view update: apply transform + sync tile visibility + reposition cities.
  useEffect(() => {
    const scene = sceneRef.current;
    const tiles = tilesRef.current;
    const cityLayer = cityLayerRef.current;
    if (!scene || !tiles || !cityLayer || !ready) return;
    applyView(scene.mapContainer, view);
    updateTiles(tiles, view, { w: size.w, h: size.h });
    updateCities(cityLayer, view, { w: size.w, h: size.h });
  }, [view, ready, size.w, size.h]);

  // Drag (pan).
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: view.panX,
      panY: view.panY,
    };
    setDragging(true);
  };
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    setView((v) =>
      clampToWorld(
        { ...v, panX: drag.panX + dx, panY: drag.panY + dy },
        size,
      ),
    );
  };
  const onMouseUp = () => {
    dragRef.current = null;
    setDragging(false);
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
        onMouseLeave={onMouseUp}
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
