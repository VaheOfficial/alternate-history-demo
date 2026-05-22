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

export function pathsFor(
  features: ProvinceFeature[],
  path: GeoPath,
): Map<string, Path2D> {
  const result = new Map<string, Path2D>();
  for (const f of features) {
    const d = path(f);
    if (!d) continue;
    const sid = (f.properties as any).shape_id;
    result.set(sid, new Path2D(d));
  }
  return result;
}
