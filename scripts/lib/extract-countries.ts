import { readFile, writeFile } from "node:fs/promises";

interface RawFeature {
  type: "Feature";
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  properties: Record<string, unknown>;
}

export interface Country {
  /** ISO 3166-1 alpha-3 (e.g. "USA", "FRA"). */
  iso_a3: string;
  /** Common short name ("United States", "France"). */
  name: string;
  /** Formal long name ("United States of America"). */
  formal_name: string;
  /** Pre-computed Natural Earth 1..13 color ensuring adjacent-country separation. */
  map_color: number;
  /** Approximate continent ("Europe", "Asia", ...). */
  continent: string;
  /** Suggested label anchor (lon, lat) — Natural Earth's label_x / label_y. */
  label_lon: number;
  label_lat: number;
  /** Bounding box in geographic coords (xmin, ymin, xmax, ymax). */
  bbox: [number, number, number, number];
  /** Rough country area in deg^2 (bbox-derived; used for label size scaling). */
  area_deg2: number;
}

export interface CountriesFile {
  generated_at: string;
  source: string;
  count: number;
  countries: Country[];
}

function bboxOf(geometry: RawFeature["geometry"]): [number, number, number, number] {
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
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

export async function extractCountries(
  geojsonPath: string,
  outputPath: string,
): Promise<CountriesFile> {
  const raw = await readFile(geojsonPath, "utf-8");
  const parsed: { features: RawFeature[] } = JSON.parse(raw);

  const countries: Country[] = [];
  for (const f of parsed.features) {
    const p = f.properties;
    const iso_a3 = String(p.ADM0_A3 ?? p.adm0_a3 ?? p.ISO_A3 ?? "").trim();
    if (!iso_a3 || iso_a3 === "-99") continue;

    const name = String(p.NAME ?? p.name ?? p.NAME_EN ?? iso_a3);
    const formal_name = String(p.FORMAL_EN ?? p.formal_en ?? name);
    const map_color = Number(p.MAPCOLOR13 ?? p.mapcolor13 ?? 1) || 1;
    const continent = String(p.CONTINENT ?? p.continent ?? "");

    const bbox = bboxOf(f.geometry);
    const area_deg2 = Math.max(0, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));

    // Natural Earth provides label coordinates; fall back to bbox center.
    const labelX = Number(p.LABEL_X ?? p.label_x);
    const labelY = Number(p.LABEL_Y ?? p.label_y);
    const label_lon = Number.isFinite(labelX) ? labelX : (bbox[0] + bbox[2]) / 2;
    const label_lat = Number.isFinite(labelY) ? labelY : (bbox[1] + bbox[3]) / 2;

    countries.push({
      iso_a3,
      name,
      formal_name,
      map_color: map_color >= 1 && map_color <= 13 ? Math.round(map_color) : 1,
      continent,
      label_lon,
      label_lat,
      bbox,
      area_deg2,
    });
  }

  // De-dupe by iso_a3, keeping the largest-area polygon (handles France's
  // overseas territories sharing the ISO code as the metropolitan polygon).
  const byIso = new Map<string, Country>();
  for (const c of countries) {
    const prev = byIso.get(c.iso_a3);
    if (!prev || c.area_deg2 > prev.area_deg2) byIso.set(c.iso_a3, c);
  }
  const deduped = [...byIso.values()].sort((a, b) => b.area_deg2 - a.area_deg2);

  const file: CountriesFile = {
    generated_at: new Date().toISOString(),
    source: "Natural Earth 10m admin_0 countries (public domain)",
    count: deduped.length,
    countries: deduped,
  };
  await writeFile(outputPath, JSON.stringify(file));
  return file;
}
