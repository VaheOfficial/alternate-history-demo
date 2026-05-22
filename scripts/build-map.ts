import { mkdir } from "node:fs/promises";
import { downloadCached } from "./lib/download.ts";
import { simplifyToTopoJson } from "./lib/simplify.ts";
import { extractMeta } from "./lib/extract-meta.ts";

const GEOBOUNDARIES_ADM1 =
  "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/CGAZ/geoBoundariesCGAZ_ADM1.geojson";

const CACHE_DIR = "scripts/.cache";
const PUBLIC_DIR = "public";
const RETAIN_FRACTION = 0.05; // 5% of original vertices kept

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });

  const rawPath = `${CACHE_DIR}/geoBoundariesCGAZ_ADM1.geojson`;
  await downloadCached({
    url: GEOBOUNDARIES_ADM1,
    destination: rawPath,
    expectedMinBytes: 50 * 1024 * 1024,
  });

  const { bytes } = await simplifyToTopoJson({
    inputGeoJsonPath: rawPath,
    outputTopoJsonPath: `${PUBLIC_DIR}/world.topojson`,
    retainFraction: RETAIN_FRACTION,
  });
  console.log(
    `[build-map] world.topojson written (${(bytes / 1024 / 1024).toFixed(2)} MB)`,
  );

  const meta = await extractMeta(rawPath, `${PUBLIC_DIR}/world-meta.json`);
  console.log(`[build-map] world-meta.json written (${meta.count} provinces)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
