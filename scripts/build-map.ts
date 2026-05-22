import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { downloadCached } from "./lib/download.ts";
import { simplifyToTopoJson } from "./lib/simplify.ts";
import { extractMeta } from "./lib/extract-meta.ts";
import { extractCities } from "./lib/extract-cities.ts";
import { clearTiles, generateTilePyramid, tilesDirSize } from "./lib/tiles.ts";

const NATURAL_EARTH_ADM1 =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";
const NATURAL_EARTH_CITIES =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson";

// 43200×21600 PNG of NASA Blue Marble (public domain). ~555 MB. Downloaded
// once and cached, then sharp downscales it per zoom level for the tile
// pyramid. Source for ALL satellite tiles.
const NASA_BLUE_MARBLE_43K =
  "https://upload.wikimedia.org/wikipedia/commons/2/23/Blue_Marble_2002.png";

const CACHE_DIR = "scripts/.cache";
const PUBLIC_DIR = "public";
const TILES_DIR = `${PUBLIC_DIR}/tiles`;
const RETAIN_FRACTION = 0.12;
const TILE_SIZE = 256;
const MAX_ZOOM = Number(process.env.MAP_MAX_ZOOM ?? 5);
const TILE_QUALITY = Number(process.env.MAP_TILE_QUALITY ?? 78);

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });

  // --- Province polygons ---
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

  // --- Populated places (cities + capitals) ---
  const citiesRawPath = `${CACHE_DIR}/ne_10m_populated_places_simple.geojson`;
  await downloadCached({
    url: NATURAL_EARTH_CITIES,
    destination: citiesRawPath,
    expectedMinBytes: 200 * 1024,
  });
  const citiesFile = await extractCities(
    citiesRawPath,
    `${PUBLIC_DIR}/cities.json`,
    {
      // National capitals always shown; regional capitals only if big.
      alwaysIncludeFeatureClasses: ["Admin-0 capital"],
      maxScalerankForCities: 5,
      minPopForCities: 1_000_000,
      minPopForRegionalCapitals: 500_000,
    },
  );
  console.log(`[build-map] cities.json written (${citiesFile.count} cities)`);

  // --- Satellite tile pyramid ---
  const sourcePng = `${CACHE_DIR}/blue_marble_43200.png`;
  await downloadCached({
    url: NASA_BLUE_MARBLE_43K,
    destination: sourcePng,
    expectedMinBytes: 200 * 1024 * 1024,
  });

  // Skip regeneration if tiles directory already exists and is non-trivially-sized.
  if (existsSync(TILES_DIR)) {
    const size = await tilesDirSize(TILES_DIR);
    if (size > 5 * 1024 * 1024) {
      console.log(
        `[tiles] using cached tile pyramid at ${TILES_DIR} (${(size / 1024 / 1024).toFixed(2)} MB).`,
      );
      console.log(`[tiles] to regenerate, delete ${TILES_DIR} and re-run.`);
      return;
    }
  }

  await clearTiles(TILES_DIR);
  await generateTilePyramid({
    sourcePath: sourcePng,
    outputDir: TILES_DIR,
    maxZoom: MAX_ZOOM,
    tileSize: TILE_SIZE,
    quality: TILE_QUALITY,
  });
  const size = await tilesDirSize(TILES_DIR);
  console.log(
    `[tiles] complete — ${(size / 1024 / 1024).toFixed(2)} MB across LOD 0..${MAX_ZOOM}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
