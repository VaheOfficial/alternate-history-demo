import type { Feature, MultiPolygon, Polygon } from "geojson";

export interface ProvinceMeta {
  shape_id: string;
  name: string;
  iso_country: string;
  shape_group: string;
}

export interface MetaFile {
  generated_at: string;
  source: string;
  count: number;
  provinces: ProvinceMeta[];
}

export type ProvinceFeature = Feature<Polygon | MultiPolygon, ProvinceMeta>;

export interface MapData {
  byShapeId: Map<string, ProvinceFeature>;
  features: ProvinceFeature[];
  meta: MetaFile;
}
