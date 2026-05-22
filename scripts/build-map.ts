import { mkdir } from "node:fs/promises";
import { downloadCached } from "./lib/download.ts";
import { simplifyToTopoJson } from "./lib/simplify.ts";
import { extractMeta } from "./lib/extract-meta.ts";

// Natural Earth 10m admin_1 (public domain). Hosted via the maintainer's own
// GitHub repo so the URL is stable.
const NATURAL_EARTH_ADM1 =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";

const CACHE_DIR = "scripts/.cache";
const PUBLIC_DIR = "public";
const RETAIN_FRACTION = 0.08; // 8% — NE is already much simpler than geoBoundaries

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });

  const rawPath = `${CACHE_DIR}/ne_10m_admin_1_states_provinces.geojson`;
  await downloadCached({
    url: NATURAL_EARTH_ADM1,
    destination: rawPath,
    expectedMinBytes: 10 * 1024 * 1024,
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
