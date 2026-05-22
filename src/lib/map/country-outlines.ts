import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

export type CountryOutlineFeature = Feature<
  Polygon | MultiPolygon,
  { adm0_a3: string }
>;

export interface CountryOutlinesFile {
  type: "FeatureCollection";
  features: CountryOutlineFeature[];
}

/** Indexed by ISO3 for O(1) lookup at highlight time. */
export type CountryOutlineIndex = Map<string, CountryOutlineFeature>;

export async function loadCountryOutlines(): Promise<CountryOutlineIndex> {
  const resp = await fetch("/country-outlines.geojson");
  if (!resp.ok) {
    throw new Error(`failed to load country-outlines.geojson: ${resp.status}`);
  }
  const file = (await resp.json()) as FeatureCollection;
  const index: CountryOutlineIndex = new Map();
  for (const f of file.features) {
    const iso = String((f.properties ?? {}).adm0_a3 ?? "");
    if (!iso) continue;
    index.set(iso, f as CountryOutlineFeature);
  }
  return index;
}
