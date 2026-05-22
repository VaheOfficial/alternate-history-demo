import { readFile, writeFile } from "node:fs/promises";

interface RawFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

export type CityKind = "national_capital" | "regional_capital" | "city";

export interface City {
  name: string;
  lon: number;
  lat: number;
  kind: CityKind;
  /** ISO 3166-1 alpha-3 of containing country. */
  country: string;
  /** Population estimate; null if unknown. */
  pop: number | null;
  /** Natural Earth scalerank 0-10 (0 = most globally important). */
  scalerank: number;
}

export interface CitiesFile {
  generated_at: string;
  source: string;
  count: number;
  cities: City[];
}

interface FilterOptions {
  /** Always include features whose featurecla matches these (national capitals). */
  alwaysIncludeFeatureClasses: string[];
  /** Maximum Natural Earth scalerank for non-capital cities (lower = more important). */
  maxScalerankForCities: number;
  /** Minimum population for non-capital cities. */
  minPopForCities: number;
  /** Minimum population for regional (admin-1) capitals to be included. */
  minPopForRegionalCapitals: number;
}

function classify(featurecla: string): CityKind {
  const v = featurecla.toLowerCase();
  if (v.includes("admin-0 capital")) return "national_capital";
  if (v.includes("admin-1 capital")) return "regional_capital";
  return "city";
}

export async function extractCities(
  geojsonPath: string,
  outputPath: string,
  opts: FilterOptions,
): Promise<CitiesFile> {
  const raw = await readFile(geojsonPath, "utf-8");
  const parsed: { features: RawFeature[] } = JSON.parse(raw);

  const cities: City[] = [];
  for (const f of parsed.features) {
    const p = f.properties;
    const featurecla = String(p.featurecla ?? "");
    const kind = classify(featurecla);
    const scalerank = Number(p.scalerank ?? 99);
    const popMax = Number(p.pop_max ?? 0);

    const isNationalCapital = featurecla.toLowerCase().includes("admin-0 capital");
    const isRegionalCapital = featurecla.toLowerCase().includes("admin-1 capital");
    const alwaysInclude = opts.alwaysIncludeFeatureClasses.some((c) =>
      featurecla.toLowerCase().includes(c.toLowerCase()),
    );

    const passesCityFilter =
      scalerank <= opts.maxScalerankForCities && popMax >= opts.minPopForCities;
    const passesRegionalFilter = popMax >= opts.minPopForRegionalCapitals;

    const keep =
      alwaysInclude ||
      isNationalCapital ||
      (isRegionalCapital && passesRegionalFilter) ||
      passesCityFilter;
    if (!keep) continue;

    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;

    const name = String(p.name ?? p.namepar ?? p.name_en ?? "");
    if (!name) continue;
    const country = String(p.adm0_a3 ?? p.iso_a2 ?? "");

    cities.push({
      name,
      lon,
      lat,
      kind,
      country,
      pop: Number.isFinite(popMax) && popMax > 0 ? popMax : null,
      scalerank: Number.isFinite(scalerank) ? scalerank : 99,
    });
  }

  // Sort: capitals first, then by population descending — render order so
  // smaller cities don't overdraw capitals on click/hover.
  cities.sort((a, b) => {
    const rankA = a.kind === "national_capital" ? 0 : a.kind === "regional_capital" ? 1 : 2;
    const rankB = b.kind === "national_capital" ? 0 : b.kind === "regional_capital" ? 1 : 2;
    if (rankA !== rankB) return rankA - rankB;
    return (b.pop ?? 0) - (a.pop ?? 0);
  });

  const file: CitiesFile = {
    generated_at: new Date().toISOString(),
    source: "Natural Earth 10m populated places (public domain)",
    count: cities.length,
    cities,
  };
  await writeFile(outputPath, JSON.stringify(file));
  return file;
}
