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

  // Build meta lookup so we can normalize each feature's properties.
  const metaByShapeId = new Map<string, ProvinceMeta>();
  for (const p of meta.provinces) {
    metaByShapeId.set(p.shape_id, p);
  }

  // mapshaper names its output layer after the input filename ('input' here).
  // Pick whichever object key exists defensively.
  const objKey = Object.keys(topo.objects)[0];
  if (!objKey) throw new Error("topojson has no objects");

  const featureCollection = topoFeature(
    topo as any,
    (topo as any).objects[objKey],
  ) as any;
  const features: ProvinceFeature[] = featureCollection.features;

  const byShapeId = new Map<string, ProvinceFeature>();
  for (const f of features) {
    // geoBoundaries preserves camelCase property names through mapshaper.
    // Normalize: prefer the meta file (snake_case) and fall back to whatever
    // the topojson properties contain.
    const raw = (f.properties as any) ?? {};
    const sid =
      String(raw.shape_id ?? raw.shapeID ?? (f as any).id ?? "") || undefined;
    if (!sid) continue;

    const fromMeta = metaByShapeId.get(sid);
    const normalized: ProvinceMeta = fromMeta ?? {
      shape_id: sid,
      name: String(raw.shapeName ?? raw.name ?? "unknown"),
      iso_country: String(raw.shapeISO ?? raw.iso_country ?? ""),
      shape_group: String(raw.shapeGroup ?? raw.shape_group ?? ""),
    };
    f.properties = normalized;
    byShapeId.set(sid, f);
  }
  return { byShapeId, features, meta };
}
