import { readFile, writeFile } from "node:fs/promises";
import mapshaper from "mapshaper";

export interface SimplifyOptions {
  inputGeoJsonPath: string;
  outputTopoJsonPath: string;
  /** Optional sibling geojson output (post-dissolve, pre-simplify-effect-on-coords).
   *  When set, the same mapshaper pass also writes the dissolved geojson — used
   *  downstream by extract-meta when tile-merging has been applied. */
  outputGeoJsonPath?: string;
  /** Fraction of vertices to retain. 0.05 = 5%. Lower = smaller file. */
  retainFraction: number;
  /** Optional: if set, mapshaper dissolves features sharing this property
   *  value BEFORE simplifying. Used by the tile-balancing step to merge
   *  small admin_1 polygons into clusters. */
  dissolveBy?: string;
  /** When `dissolveBy` is set, this list of property names is preserved on
   *  the dissolved feature (taking the first occurrence). */
  copyFields?: string[];
}

export async function simplifyToTopoJson(
  opts: SimplifyOptions,
): Promise<{ bytes: number }> {
  console.log(`[simplify] reading ${opts.inputGeoJsonPath}`);
  const inputBuf = await readFile(opts.inputGeoJsonPath);

  const steps = ["-i input.geojson"];
  if (opts.dissolveBy) {
    const fields = (opts.copyFields ?? []).join(",");
    steps.push(
      `-dissolve2 ${opts.dissolveBy}${fields ? ` copy-fields=${fields}` : ""}`,
    );
  }
  steps.push(
    `-simplify ${(opts.retainFraction * 100).toFixed(1)}% keep-shapes`,
    "-clean",
  );

  const outputs = ["-o output.topojson format=topojson"];
  if (opts.outputGeoJsonPath) {
    outputs.push("-o output.geojson format=geojson");
  }
  const cmd = [...steps, ...outputs].join(" ");

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
  if (opts.outputGeoJsonPath) {
    const geo = result["output.geojson"];
    if (geo) await writeFile(opts.outputGeoJsonPath, geo);
  }
  return { bytes: topo.length };
}
