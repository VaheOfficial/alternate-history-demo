import { feature as topoFeature } from "topojson-client";
import type { MapData, MetaFile, ProvinceFeature, ProvinceMeta } from "./types";

interface TopoMaybe {
  type: "Topology";
  objects: Record<string, unknown>;
}

/**
 * Pick a stable id for a Natural Earth admin-1 feature. Must mirror the
 * server-side logic in scripts/lib/extract-meta.ts so meta and topology join cleanly.
 */
function pickShapeId(p: Record<string, unknown>, index: number): string {
  const iso = String(p.iso_3166_2 ?? "");
  if (iso && iso !== "-99" && iso !== "") return iso;
  const code = String(p.adm1_code ?? "");
  if (code && code !== "-99" && code !== "") return code;
  const gn = String(p.gn_id ?? "");
  if (gn && gn !== "-99" && gn !== "0" && gn !== "") return `gn_${gn}`;
  const a3 = String(p.adm0_a3 ?? "XXX");
  return `${a3}_${index}`;
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

  const metaByShapeId = new Map<string, ProvinceMeta>();
  for (const p of meta.provinces) {
    metaByShapeId.set(p.shape_id, p);
  }

  const objKey = Object.keys(topo.objects)[0];
  if (!objKey) throw new Error("topojson has no objects");

  const featureCollection = topoFeature(
    topo as any,
    (topo as any).objects[objKey],
  ) as any;
  const features: ProvinceFeature[] = featureCollection.features;

  const byShapeId = new Map<string, ProvinceFeature>();
  features.forEach((f, i) => {
    const raw = (f.properties as any) ?? {};
    const sid = pickShapeId(raw, i);
    if (!sid) return;

    const fromMeta = metaByShapeId.get(sid);
    const normalized: ProvinceMeta = fromMeta ?? {
      shape_id: sid,
      name: String(raw.name ?? raw.name_en ?? "unknown"),
      iso_country: String(raw.adm0_a3 ?? ""),
      shape_group: String(raw.adm0_a3 ?? ""),
    };
    f.properties = normalized;
    byShapeId.set(sid, f);
  });
  return { byShapeId, features, meta };
}
