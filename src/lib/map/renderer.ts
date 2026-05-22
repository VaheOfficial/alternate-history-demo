import type { MapData } from "./types";

export interface RenderOptions {
  paths: Map<string, Path2D>;
  width: number;
  height: number;
  fillByShapeId?: Map<string, string>;
  background: string;
  neutralLand: string;
  borderColor: string;
}

export function render(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions,
): void {
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, opts.width, opts.height);

  ctx.lineWidth = 0.4;
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
