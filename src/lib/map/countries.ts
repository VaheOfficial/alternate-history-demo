export interface Country {
  iso_a3: string;
  name: string;
  formal_name: string;
  map_color: number;
  continent: string;
  label_lon: number;
  label_lat: number;
  bbox: [number, number, number, number];
  area_deg2: number;
}

export interface CountriesFile {
  generated_at: string;
  source: string;
  count: number;
  countries: Country[];
}

export async function loadCountries(): Promise<Country[]> {
  const resp = await fetch("/countries.json");
  if (!resp.ok) throw new Error(`failed to load countries.json: ${resp.status}`);
  const file = (await resp.json()) as CountriesFile;
  return file.countries;
}
