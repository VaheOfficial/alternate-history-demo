import { feature as topoFeature } from "topojson-client";
import type { MapData, MetaFile, ProvinceFeature, ProvinceMeta } from "./types";

interface TopoMaybe {
  type: "Topology";
  objects: Record<string, unknown>;
}

export async function loadMapData(): Promise<MapData> {
  const [topoResp, metaResp] = await Promise.all([
    fetch("/world.topojson"),
    fetch("/world-meta.json"),
  ]);
  if (!topoResp.ok)
    throw new Error(`failed to load world.topojson: ${topoResp.status}`);
  if (!metaResp.ok)
    throw new Error(`failed to load world-meta.json: ${metaResp.status}`);

  const topo = (await topoResp.json()) as TopoMaybe;
  const meta = (await metaResp.json()) as MetaFile;

  // mapshaper names its output layer after the input filename ('input' here).
  // We pick whichever object key exists defensively.
  const objKey = Object.keys(topo.objects)[0];
  if (!objKey) throw new Error("topojson has no objects");

  const featureCollection = topoFeature(
    topo as any,
    (topo as any).objects[objKey],
  ) as any;
  const features: ProvinceFeature[] = featureCollection.features;

  const byShapeId = new Map<string, ProvinceFeature>();
  for (const f of features) {
    const props = f.properties as ProvinceMeta | (Record<string, unknown> & { shapeID?: string });
    const sid = (props as ProvinceMeta).shape_id ?? (props as any).shapeID;
    if (sid) {
      (f.properties as ProvinceMeta).shape_id = sid;
      byShapeId.set(sid, f);
    }
  }
  return { byShapeId, features, meta };
}
