import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMapData } from "./useMapData";
import {
  createProjection,
  pathsFor,
  type Viewport,
} from "../../lib/map/projection";
import { render } from "../../lib/map/renderer";

const COLORS = {
  background: "#0a1a2b",
  neutralLand: "#3a5e3a",
  border: "#1f2f1f",
};

export function WorldMap({
  ownershipColors,
}: {
  ownershipColors?: Map<string, string>;
}) {
  const state = useMapData();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 500 });
  const [viewport, setViewport] = useState<Viewport>({
    width: 800,
    height: 500,
    centerLon: 0,
    centerLat: 0,
    zoom: 1,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ w: Math.floor(cr.width), h: Math.floor(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setViewport((v) => {
      if (v.width === size.w && v.height === size.h) return v;
      return { ...v, width: size.w, height: size.h };
    });
  }, [size]);

  const paths = useMemo(() => {
    if (state.status !== "ready") return null;
    const { path } = createProjection(viewport);
    return pathsFor(state.data.features, path);
  }, [state, viewport]);

  useEffect(() => {
    if (!paths) return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = viewport.width * dpr;
    c.height = viewport.height * dpr;
    c.style.width = `${viewport.width}px`;
    c.style.height = `${viewport.height}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, {
      paths,
      width: viewport.width,
      height: viewport.height,
      fillByShapeId: ownershipColors,
      background: COLORS.background,
      neutralLand: COLORS.neutralLand,
      borderColor: COLORS.border,
    });
  }, [paths, viewport, ownershipColors]);

  const dragRef = useRef<{
    x: number;
    y: number;
    lon: number;
    lat: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      lon: viewport.centerLon,
      lat: viewport.centerLat,
    };
    setDragging(true);
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    const degPerPx = 360 / viewport.width / viewport.zoom;
    setViewport((v) => ({
      ...v,
      centerLon: dragRef.current!.lon - dx * degPerPx,
      centerLat: clamp(dragRef.current!.lat + dy * degPerPx, -85, 85),
    }));
  };
  const onMouseUp = () => {
    dragRef.current = null;
    setDragging(false);
  };
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setViewport((v) => ({ ...v, zoom: clamp(v.zoom * factor, 0.5, 16) }));
  }, []);

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
        style={{ display: "block", cursor: dragging ? "grabbing" : "grab" }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 4,
          right: 8,
          fontSize: "0.7rem",
          color: "#999",
          background: "rgba(0,0,0,0.4)",
          padding: "2px 6px",
          borderRadius: 3,
          pointerEvents: "none",
        }}
      >
        Map data © geoBoundaries CC BY 4.0 · {state.data.meta.count} provinces
      </div>
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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
