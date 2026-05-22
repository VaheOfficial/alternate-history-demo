import type { MapData } from "./types";

export interface BaseRenderOptions {
  paths: Map<string, Path2D>;
  width: number;
  height: number;
  /** Logical pixel multiplier for the offscreen surface (higher = crisper at zoom). */
  superSample: number;
  fillByShapeId?: Map<string, string>;
  neutralLand: string;
  borderColor: string;
  backgroundImage?: HTMLImageElement | null;
  backgroundDarken?: number;
  worldExtent: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Render the full world (satellite + country fills + province borders) into
 * the given context once. No pan/zoom transform — produces a "base layer" at
 * `width × height × superSample` resolution. Drawn once and composited per
 * frame by the caller.
 */
export function renderBase(
  ctx: CanvasRenderingContext2D,
  opts: BaseRenderOptions,
): void {
  const s = opts.superSample;
  // The context is already sized to (width*s, height*s). We apply a uniform
  // scale of `s` so all coordinates are passed in CSS-pixel space.
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, opts.width, opts.height);

  // Satellite background
  if (opts.backgroundImage) {
    const e = opts.worldExtent;
    const ew = e.x1 - e.x0;
    const eh = e.y1 - e.y0;
    ctx.drawImage(opts.backgroundImage, e.x0, e.y0, ew, eh);
    if (opts.backgroundDarken && opts.backgroundDarken > 0) {
      ctx.fillStyle = `rgba(0,0,0,${opts.backgroundDarken})`;
      ctx.fillRect(e.x0, e.y0, ew, eh);
    }
  }

  // Country fills. Group by color so we only set fillStyle ~13 times instead
  // of once per province — significant state-change reduction.
  const byColor = new Map<string, Path2D>();
  const allBorders = new Path2D();
  for (const [sid, p] of opts.paths) {
    const color = opts.fillByShapeId?.get(sid) ?? opts.neutralLand;
    let group = byColor.get(color);
    if (!group) {
      group = new Path2D();
      byColor.set(color, group);
    }
    group.addPath(p);
    allBorders.addPath(p);
  }

  ctx.globalAlpha = opts.backgroundImage ? 0.42 : 0.85;
  for (const [color, p] of byColor) {
    ctx.fillStyle = color;
    ctx.fill(p);
  }

  // Borders — soft, semi-transparent, drawn last so they sit on top of fills.
  ctx.globalAlpha = 1.0;
  ctx.lineWidth = 0.4;
  ctx.strokeStyle = opts.borderColor;
  ctx.stroke(allBorders);
}

export interface CompositeOptions {
  source: HTMLCanvasElement;
  /** Logical-pixel size the offscreen represents (matches createProjection input). */
  sourceWidth: number;
  sourceHeight: number;
  dpr: number;
  panX: number;
  panY: number;
  zoom: number;
  background: string;
  /** Destination canvas CSS-pixel size. */
  destWidth: number;
  destHeight: number;
}

/**
 * Composite the offscreen base layer onto the main canvas, applying pan + zoom.
 * O(1) per frame.
 */
export function composite(
  ctx: CanvasRenderingContext2D,
  opts: CompositeOptions,
): void {
  ctx.setTransform(opts.dpr, 0, 0, opts.dpr, 0, 0);
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, opts.destWidth, opts.destHeight);

  ctx.setTransform(
    opts.dpr * opts.zoom,
    0,
    0,
    opts.dpr * opts.zoom,
    opts.dpr * opts.panX,
    opts.dpr * opts.panY,
  );
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(opts.source, 0, 0, opts.sourceWidth, opts.sourceHeight);
}

export function buildFillMap(
  data: MapData,
  ownership?: Map<string, string>,
): Map<string, string> {
  if (!ownership) return new Map();
  const out = new Map<string, string>();
  for (const sid of data.byShapeId.keys()) {
    const color = ownership.get(sid);
    if (color) out.set(sid, color);
  }
  return out;
}

/** Hand-tuned palette for Natural Earth mapcolor13 (indices 1-13). */
const PALETTE_13: string[] = [
  "#9c3b3b",
  "#9c3b3b",
  "#b56b2b",
  "#a88b2b",
  "#6a8a35",
  "#3d8048",
  "#3a8a7c",
  "#3072a6",
  "#4055a8",
  "#6e4aaf",
  "#9a4495",
  "#a84573",
  "#7a5a3f",
  "#56789a",
];

export function colorForMapcolor(mc: number): string {
  if (mc >= 1 && mc <= 13) return PALETTE_13[mc];
  return PALETTE_13[1];
}

export function buildCountryFillMap(data: MapData): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of data.features) {
    const props = f.properties as any;
    const sid = props.shape_id as string;
    const mc =
      typeof props.map_color === "number" && props.map_color >= 1 && props.map_color <= 13
        ? props.map_color
        : 1;
    m.set(sid, colorForMapcolor(mc));
  }
  return m;
}

export function worldExtentAtBase(canvasW: number, canvasH: number) {
  const scale = canvasW / (2 * Math.PI);
  const worldW = 2 * Math.PI * scale;
  const worldH = Math.PI * scale;
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  return {
    x0: cx - worldW / 2,
    y0: cy - worldH / 2,
    x1: cx + worldW / 2,
    y1: cy + worldH / 2,
  };
}
