export type CityKind = "national_capital" | "regional_capital" | "city";

export interface City {
  name: string;
  lon: number;
  lat: number;
  kind: CityKind;
  country: string;
  pop: number | null;
  /** Natural Earth scalerank 0-10. Lower = more globally significant. */
  scalerank: number;
}

export interface CitiesFile {
  generated_at: string;
  source: string;
  count: number;
  cities: City[];
}

export async function loadCities(): Promise<City[]> {
  const resp = await fetch("/cities.json");
  if (!resp.ok) throw new Error(`failed to load cities.json: ${resp.status}`);
  const file = (await resp.json()) as CitiesFile;
  return file.cities;
}
