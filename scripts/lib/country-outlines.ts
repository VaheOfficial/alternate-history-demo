import { readFile, writeFile } from "node:fs/promises";
import mapshaper from "mapshaper";

/**
 * Produce per-country outline polygons from the dissolved admin_1 geojson.
 *
 * Mapshaper's `-dissolve2` is topology-aware: when we dissolve by
 * `adm0_a3`, interior arcs (province-province within the same country) are
 * eliminated and only the country's outer boundary survives. One feature
 * per ISO3.
 *
 * The frontend uses this directly for country highlight rendering — no need
 * to reconstruct outlines from scratch at runtime.
 */
export async function buildCountryOutlines(
  dissolvedGeoJsonPath: string,
  outputPath: string,
): Promise<{ countries: number; bytes: number }> {
  const inputBuf = await readFile(dissolvedGeoJsonPath);
  const cmd = [
    "-i input.geojson",
    "-dissolve2 adm0_a3 copy-fields=adm0_a3",
    "-clean",
    "-o output.geojson format=geojson",
  ].join(" ");
  const result = await mapshaper.applyCommands(cmd, {
    "input.geojson": inputBuf,
  });
  const out = result["output.geojson"];
  if (!out) {
    throw new Error(
      `mapshaper produced no country outlines. keys: ${Object.keys(result).join(",")}`,
    );
  }
  await writeFile(outputPath, out);
  const parsed = JSON.parse(out.toString());
  const count = Array.isArray(parsed?.features) ? parsed.features.length : 0;
  return { countries: count, bytes: out.length };
}
