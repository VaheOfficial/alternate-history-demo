import { readFile, writeFile } from "node:fs/promises";

interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
}

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

export async function extractMeta(
  geojsonPath: string,
  outputPath: string,
): Promise<MetaFile> {
  const raw = await readFile(geojsonPath, "utf-8");
  const parsed: { features: GeoJsonFeature[] } = JSON.parse(raw);
  const provinces: ProvinceMeta[] = parsed.features
    .map((f) => {
      const p = f.properties;
      const shape_id = String(p.shapeID ?? p.shape_id ?? "");
      if (!shape_id) return null;
      return {
        shape_id,
        name: String(p.shapeName ?? p.shape_name ?? "unknown"),
        iso_country: String(p.shapeISO ?? p.shape_iso ?? ""),
        shape_group: String(p.shapeGroup ?? p.shape_group ?? ""),
      };
    })
    .filter((x): x is ProvinceMeta => x !== null);

  const file: MetaFile = {
    generated_at: new Date().toISOString(),
    source: "geoBoundaries CGAZ ADM1 (CC BY 4.0)",
    count: provinces.length,
    provinces,
  };
  await writeFile(outputPath, JSON.stringify(file));
  return file;
}
