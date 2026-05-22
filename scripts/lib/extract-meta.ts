import { readFile, writeFile } from "node:fs/promises";

interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
}

export interface ProvinceMeta {
  shape_id: string;
  name: string;
  iso_country: string; // ISO 3166-1 alpha-3 of containing country
  shape_group: string; // == iso_country for our purposes
}

export interface MetaFile {
  generated_at: string;
  source: string;
  count: number;
  provinces: ProvinceMeta[];
}

/**
 * Pick a stable id for a Natural Earth admin-1 feature.
 * Preference order: iso_3166_2 → adm1_code → gn_id → adm0_a3 + index fallback.
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
    return {
      shape_id,
      name,
      iso_country: country,
      shape_group: country,
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
