import { geoContains, geoBounds, geoEquirectangular } from "d3-geo";
import type { ProvinceFeature } from "./types";

interface IndexedProvince {
  feature: ProvinceFeature;
  shape_id: string;
  /** Geographic bounding box [west, south, east, north]. */
  bbox: [number, number, number, number];
}

export interface ProvinceIndex {
  width: number;
  height: number;
  inverse: (x: number, y: number) => [number, number] | null;
  provinces: IndexedProvince[];
}

/**
 * Build an inverse-projection-aware spatial index for province features.
 * Used to translate mouse coords → (lon, lat) → which province polygon (if any)
 * sits under the cursor.
 */
export function buildProvinceIndex(
  features: ProvinceFeature[],
  width: number,
  height: number,
): ProvinceIndex {
  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])
    .rotate([0, 0])
    .center([0, 0]);

  const inverse = (x: number, y: number): [number, number] | null => {
    const r = projection.invert?.([x, y]);
    if (!r) return null;
    return r as [number, number];
  };

  const provinces: IndexedProvince[] = features.map((f) => {
    const [[w, s], [e, n]] = geoBounds(f);
    return {
      feature: f,
      shape_id: String((f.properties as { shape_id?: string }).shape_id ?? ""),
      bbox: [w, s, e, n],
    };
  });

  return { width, height, inverse, provinces };
}

/**
 * Hit test against the world index. `worldX/worldY` are in the same coordinate
 * space the projection was built in (i.e. canvas pixels at zoom 1, NOT the
 * scaled/pannned display coords — caller is responsible for transforming).
 * Returns the shape_id of the topmost province containing the point, or null.
 */
export function pickProvince(
  index: ProvinceIndex,
  worldX: number,
  worldY: number,
): string | null {
  const ll = index.inverse(worldX, worldY);
  if (!ll) return null;
  const [lon, lat] = ll;

  for (const p of index.provinces) {
    const [w, s, e, n] = p.bbox;
    // d3-geo's geoBounds returns a WRAP-AROUND bbox when a polygon crosses
    // the antimeridian (e.g. Alaska, Russia, Fiji): `w > e`. The longitude
    // is in range iff lon >= w OR lon <= e — NOT the standard between-test.
    if (lat < s || lat > n) continue;
    if (w <= e) {
      if (lon < w || lon > e) continue;
    } else {
      if (lon < w && lon > e) continue;
    }
    if (geoContains(p.feature, [lon, lat])) {
      return p.shape_id;
    }
  }
  return null;
}
