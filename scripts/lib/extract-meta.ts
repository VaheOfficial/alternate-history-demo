import { readFile, writeFile } from "node:fs/promises";

interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
}

export interface ProvinceMeta {
  shape_id: string;
  name: string;
  iso_country: string; // ISO 3166-1 alpha-3 of containing country
  shape_group: string; // == iso_country for our purposes
  /** 1-13 — Natural Earth's pre-computed map color index ensuring adjacent countries differ. */
  map_color: number;
  /** Approximate area in deg² (bbox-derived). Used downstream to distribute country
   *  population across provinces by area share. Coarse but stable. */
  area_deg2: number;
}

export interface MetaFile {
  generated_at: string;
  source: string;
  count: number;
  provinces: ProvinceMeta[];
}

/**
 * Pick a stable id for a feature. When the pipeline dissolves polygons by a
 * `merge_group` (tile-balancing step), that group string IS the identity of
 * the resulting merged polygon — use it directly. Otherwise fall back to
 * adm1_code → iso_3166_2 → gn_id → a3+index.
 */
function pickShapeId(p: Record<string, unknown>, index: number): string {
  const mg = String(p.merge_group ?? "");
  if (mg && mg !== "-99") return mg;
  const code = String(p.adm1_code ?? "");
  if (code && code !== "-99" && code !== "") return code;
  const iso = String(p.iso_3166_2 ?? "");
  if (iso && iso !== "-99" && iso !== "") return iso;
  const gn = String(p.gn_id ?? "");
  if (gn && gn !== "-99" && gn !== "0" && gn !== "") return `gn_${gn}`;
  const a3 = String(p.adm0_a3 ?? "XXX");
  return `${a3}_${index}`;
}

export async function extractMeta(
  geojsonPath: string,
  outputPath: string,
): Promise<MetaFile> {
  const raw = await readFile(geojsonPath, "utf-8");
  const parsed: { features: GeoJsonFeature[] } = JSON.parse(raw);

  const provinces: ProvinceMeta[] = parsed.features.map((f, i) => {
    const p = f.properties;
    const shape_id = pickShapeId(p, i);
    const name = String(p.name ?? p.name_en ?? "unknown");
    const country = String(p.adm0_a3 ?? "");
    const mcRaw = Number(p.mapcolor13 ?? p.mapcolor9 ?? 1);
    const map_color =
      Number.isFinite(mcRaw) && mcRaw >= 1 && mcRaw <= 13 ? Math.round(mcRaw) : 1;
    const area_deg2 = f.geometry ? bboxArea(f.geometry) : 0;
    return {
      shape_id,
      name,
      iso_country: country,
      shape_group: country,
      map_color,
      area_deg2,
    };
  });

  const file: MetaFile = {
    generated_at: new Date().toISOString(),
    source: "Natural Earth 10m admin_1 states + provinces (public domain)",
    count: provinces.length,
    provinces,
  };
  await writeFile(outputPath, JSON.stringify(file));
  return file;
}

function bboxArea(geometry: { type: string; coordinates: unknown }): number {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number;
      const y = c[1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      return;
    }
    for (const inner of c) visit(inner);
  };
  visit(geometry.coordinates);
  if (!Number.isFinite(minX)) return 0;
  return Math.max(0, (maxX - minX) * (maxY - minY));
}
