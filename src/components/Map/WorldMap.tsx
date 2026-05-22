import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMapData } from "./useMapData";
import { createProjection, pathsFor } from "../../lib/map/projection";
import { buildCountryFillMap, render } from "../../lib/map/renderer";

const COLORS = {
  background: "#0a1a2b",
  neutralLand: "#3a5e3a",
  border: "#0e1a0e",
};

interface ViewState {
  /** Pan in CSS pixels (post-zoom screen offset). */
  panX: number;
  panY: number;
  /** User zoom multiplier on top of the base "fits-screen" projection. */
  zoom: number;
}

const INITIAL_VIEW: ViewState = { panX: 0, panY: 0, zoom: 1 };

export function WorldMap({
  ownershipColors,
}: {
  ownershipColors?: Map<string, string>;
}) {
  const state = useMapData();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 500 });
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);

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

  // Compute paths ONCE per size change (and once on data load). Pan/zoom
  // do NOT recompute paths — we transform the canvas context instead.
  const paths = useMemo(() => {
    if (state.status !== "ready") return null;
    const { path } = createProjection({
      width: size.w,
      height: size.h,
      centerLon: 0,
      centerLat: 0,
      zoom: 1,
    });
    return pathsFor(state.data.features, path);
  }, [state, size.w, size.h]);

  const countryFill = useMemo(() => {
    if (state.status !== "ready") return null;
    return buildCountryFillMap(state.data);
  }, [state]);

  const effectiveFill = ownershipColors ?? countryFill ?? undefined;

  // Draw on any change to paths, view, size, or fill.
  useEffect(() => {
    if (!paths) return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== size.w * dpr || c.height !== size.h * dpr) {
      c.width = size.w * dpr;
      c.height = size.h * dpr;
      c.style.width = `${size.w}px`;
      c.style.height = `${size.h}px`;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    render(ctx, {
      paths,
      width: size.w,
      height: size.h,
      dpr,
      panX: view.panX,
      panY: view.panY,
      zoom: view.zoom,
      fillByShapeId: effectiveFill ?? undefined,
      background: COLORS.background,
      neutralLand: COLORS.neutralLand,
      borderColor: COLORS.border,
    });
  }, [paths, view, size, effectiveFill]);

  // Drag (pan).
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: view.panX,
      panY: view.panY,
    };
    setDragging(true);
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    setView((v) => ({ ...v, panX: drag.panX + dx, panY: drag.panY + dy }));
  };
  const onMouseUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  // Wheel zoom — zoom toward cursor for natural feel.
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const c = canvasRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const newZoom = clamp(v.zoom * factor, 0.4, 32);
        // World point under cursor: (mouseX - v.panX) / v.zoom
        const wx = (mouseX - v.panX) / v.zoom;
        const wy = (mouseY - v.panY) / v.zoom;
        return {
          panX: mouseX - wx * newZoom,
          panY: mouseY - wy * newZoom,
          zoom: newZoom,
        };
      });
    },
    [],
  );

  const resetView = () => setView(INITIAL_VIEW);

  if (state.status === "loading") {
    return (
      <div style={containerStyle} ref={containerRef}>
        <div style={messageStyle}>Loading map…</div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={containerStyle} ref={containerRef}>
        <div style={{ ...messageStyle, color: "salmon" }}>
          Failed to load map: {state.message}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle} ref={containerRef}>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        style={{
          display: "block",
          cursor: dragging ? "grabbing" : "grab",
        }}
      />
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
  background: COLORS.background,
  overflow: "hidden",
};

const messageStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  color: "#bbb",
};

const resetButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  padding: "4px 10px",
  background: "rgba(0,0,0,0.5)",
  color: "#eee",
  border: "1px solid #444",
  borderRadius: 4,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.8rem",
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
