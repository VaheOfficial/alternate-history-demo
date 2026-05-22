import type { MapData } from "./types";

export interface RenderOptions {
  paths: Map<string, Path2D>;
  width: number;
  height: number;
  /** Device-pixel ratio applied as the outer scale; everything below is in CSS px. */
  dpr: number;
  /** Pan offset in CSS pixels (post-zoom screen pixels). */
  panX: number;
  panY: number;
  /** User zoom multiplier on top of the base projection. */
  zoom: number;
  fillByShapeId?: Map<string, string>;
  background: string;
  neutralLand: string;
  borderColor: string;
}

export function render(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions,
): void {
  // Background first, in untransformed space.
  ctx.setTransform(opts.dpr, 0, 0, opts.dpr, 0, 0);
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, opts.width, opts.height);

  // Apply pan + zoom for the world.
  ctx.setTransform(
    opts.dpr * opts.zoom,
    0,
    0,
    opts.dpr * opts.zoom,
    opts.dpr * opts.panX,
    opts.dpr * opts.panY,
  );

  // Constant on-screen border width regardless of zoom.
  ctx.lineWidth = 0.5 / opts.zoom;
  ctx.strokeStyle = opts.borderColor;
  for (const [sid, p] of opts.paths) {
    ctx.fillStyle = opts.fillByShapeId?.get(sid) ?? opts.neutralLand;
    ctx.fill(p);
    ctx.stroke(p);
  }
}

export function clear(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
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

/**
 * Deterministic color per group key (e.g. ISO country code). Used as the
 * default fill until real nation ownership is wired in (Plan 04).
 */
export function colorForGroup(group: string): string {
  let h = 5381;
  for (let i = 0; i < group.length; i++) {
    h = ((h << 5) + h + group.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  // Lower saturation + mid lightness for a flag-ish but muted palette.
  return `hsl(${hue}, 38%, 38%)`;
}

export function buildCountryFillMap(data: MapData): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of data.features) {
    const props = f.properties as any;
    const sid = props.shape_id as string;
    const group =
      (props.shape_group as string) ||
      (props.iso_country as string) ||
      "unknown";
    m.set(sid, colorForGroup(group));
  }
  return m;
}
