import { geoEquirectangular, geoPath } from "d3-geo";
import type { GeoPath, GeoProjection } from "d3-geo";
import type { ProvinceFeature } from "./types";

export interface Viewport {
  width: number;
  height: number;
  centerLon: number;
  centerLat: number;
  zoom: number;
}

export function createProjection(vp: Viewport): {
  projection: GeoProjection;
  path: GeoPath;
} {
  const baseScale = vp.width / (2 * Math.PI);
  const projection = geoEquirectangular()
    .scale(baseScale * vp.zoom)
    .translate([vp.width / 2, vp.height / 2])
    .rotate([-vp.centerLon, 0])
    .center([0, vp.centerLat]);
  const path = geoPath(projection);
  return { projection, path };
}

/**
 * Project features into Path2D objects, keyed by shape_id. When multiple
 * features share a shape_id (e.g. islands of the same admin-1 subdivision),
 * their geometry is merged via Path2D.addPath so all polygons render together.
 *
 * Skips pathological features whose projected bbox spans nearly the entire
 * canvas in BOTH dimensions — this happens for degenerate (near-zero-area)
 * input polygons that confuse d3-geo's antimeridian clipping into emitting
 * the full sphere outline.
 */
export function pathsFor(
  features: ProvinceFeature[],
  path: GeoPath,
  canvas: { width: number; height: number },
): Map<string, Path2D> {
  const result = new Map<string, Path2D>();
  const widthLimit = canvas.width * 0.95;
  const heightLimit = canvas.height * 0.95;
  for (const f of features) {
    const d = path(f);
    if (!d) continue;
    const b = path.bounds(f);
    if (b) {
      const w = b[1][0] - b[0][0];
      const h = b[1][1] - b[0][1];
      if (w >= widthLimit && h >= heightLimit) {
        continue;
      }
    }
    const sid = (f.properties as any).shape_id;
    const existing = result.get(sid);
    if (existing) {
      existing.addPath(new Path2D(d));
    } else {
      result.set(sid, new Path2D(d));
    }
  }
  return result;
}
