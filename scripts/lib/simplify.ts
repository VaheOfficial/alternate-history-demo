import { readFile, writeFile } from "node:fs/promises";
import mapshaper from "mapshaper";

export interface SimplifyOptions {
  inputGeoJsonPath: string;
  outputTopoJsonPath: string;
  /** Fraction of vertices to retain. 0.05 = 5%. Lower = smaller file. */
  retainFraction: number;
}

export async function simplifyToTopoJson(
  opts: SimplifyOptions,
): Promise<{ bytes: number }> {
  console.log(`[simplify] reading ${opts.inputGeoJsonPath}`);
  const inputBuf = await readFile(opts.inputGeoJsonPath);

  const cmd = [
    "-i input.geojson",
    `-simplify ${(opts.retainFraction * 100).toFixed(1)}% keep-shapes`,
    "-clean",
    "-o output.topojson format=topojson",
  ].join(" ");

  console.log(`[simplify] running mapshaper: ${cmd}`);
  const result = await mapshaper.applyCommands(cmd, {
    "input.geojson": inputBuf,
  });
  const topo = result["output.topojson"];
  if (!topo) {
    throw new Error(
      `mapshaper produced no output. keys: ${Object.keys(result).join(",")}`,
    );
  }
  await writeFile(opts.outputTopoJsonPath, topo);
  return { bytes: topo.length };
}
