# Plan 03 — Map Pipeline + Static Render

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a world map you can see and interact with. After this plan: the user opens the app, switches to a "Map" tab, sees ~3,000 province polygons drawn on a canvas, can pan and zoom, and provinces show a neutral land color (real ownership coloring lands in a later plan when scenarios + game state exist). The map data is sourced automatically by a build script — no manual downloads.

**Architecture:**

- **Data source:** [geoBoundaries](https://www.geoboundaries.org) CGAZ ADM1 (Comprehensive Global Administrative Zones, admin level 1). Licensed CC BY 4.0 — permissive, commercial-OK with attribution. This replaces the spec's tentative GADM choice because GADM's "non-commercial use only" terms are too restrictive for a distributable indie game.
- **Build pipeline:** A Node/TS script downloads the GeoJSON once (~100–200 MB cached, gitignored), runs `mapshaper` programmatically to simplify polygons and convert to TopoJSON, writes the result to `public/world.topojson` (~5–15 MB shipped) plus `public/world-meta.json` (province id → name mapping for runtime joins).
- **Renderer:** React component that loads the topojson on mount, converts back to GeoJSON via `topojson-client`, projects via `d3-geo` (equirectangular), and draws on a `<canvas>` with cached `Path2D` per province for fast pan/zoom redraws.

**Tech Stack:** New JS deps — `mapshaper` (build-time only, dev-dep), `topojson-client` (runtime), `d3-geo` (runtime), `node-fetch` *not needed* (Node 18+ has native fetch). No new Rust crates.

**Spec reference:** [2026-05-21-alternate-history-game-design.md](../specs/2026-05-21-alternate-history-game-design.md) §10 (Map), §17 (Open question about GADM licensing — resolved by switching to geoBoundaries).

**Scope notes:**

- **Real ownership coloring deferred to Plan 04.** This plan just gets the map *visible* with a neutral land color. We do plumb the data path (`ownerByProvinceRef` prop) so Plan 04 can wire ownership in without re-architecting.
- **Pan/zoom only.** No clickable-province event yet (that's Plan 05 for actions, Plan 06 for frontline editing).
- **One projection (equirectangular).** Robinson or Mercator are runtime swaps later; not in Plan 03.
- **No tile-based streaming or LOD.** The whole topojson loads on app start. For ~3,000 polygons after simplification, the cold-load + redraw budget is fine. If perf testing during this plan shows otherwise, we add PixiJS in a follow-up.
- **Attribution:** geoBoundaries CC BY 4.0 requires attribution. We add a small credit line on the map.

---

## License + sourcing decision

**Primary source:** [geoBoundaries CGAZ ADM1](https://www.geoboundaries.org/globalDownloads.html), GitHub raw URL:

```
https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/CGAZ/geoBoundariesCGAZ_ADM1.geojson
```

Each feature has a `shapeID` (globally unique province id, used as our `Province.geometry_ref`), `shapeName`, `shapeISO` (ISO 3166-1 alpha-3 of containing country), and `shapeGroup`.

**Attribution string** (rendered on the map):
> Map data © geoBoundaries CC BY 4.0

---

## File structure

### Scripts (`scripts/`)

```
scripts/
├── build-map.ts                     # main build script
├── lib/
│   ├── download.ts                  # fetch + cache to scripts/.cache/
│   ├── simplify.ts                  # mapshaper invocation wrapper
│   └── extract-meta.ts              # produces world-meta.json
├── .cache/                          # gitignored, holds raw GeoJSON
└── tsconfig.json                    # node-tsconfig pointed at this dir
```

### Public assets (generated)

```
public/
├── world.topojson                   # generated, gitignored
├── world-meta.json                  # generated, gitignored
├── tauri.svg                        # existing
└── vite.svg                         # existing
```

### Frontend (`src/`)

```
src/
├── App.tsx                          # add tab switcher Settings | Map
├── components/
│   ├── Map/
│   │   ├── WorldMap.tsx             # main React component (canvas host)
│   │   ├── MapPage.tsx              # page wrapper with credit line
│   │   └── useMapData.ts            # hook: load + parse topojson once
│   └── shared/
│       └── Tabs.tsx                 # tiny tab switcher
└── lib/
    └── map/
        ├── loader.ts                # fetch + topojson-client conversion
        ├── projection.ts            # d3-geo wrapper + viewport transforms
        ├── renderer.ts              # canvas draw routine with cached Path2D
        └── types.ts                 # ProvinceFeature, ProvinceMeta types
```

---

## JS dependencies (add in Task 1)

Runtime:
```
d3-geo
topojson-client
```

Dev:
```
mapshaper
@types/d3-geo
@types/topojson-client
```

---

## Task 1 — Add JS dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```
pnpm add d3-geo topojson-client
pnpm add -D mapshaper @types/d3-geo @types/topojson-client tsx
```

(`tsx` lets us run `scripts/build-map.ts` directly without a separate build step.)

- [ ] **Step 2: Add npm scripts**

In `package.json` `"scripts"`:

```json
"map:build": "tsx scripts/build-map.ts",
"map:clean": "node -e \"const fs = require('fs'); for (const f of ['public/world.topojson','public/world-meta.json']) try { fs.unlinkSync(f) } catch {}\""
```

- [ ] **Step 3: pnpm-workspace.yaml — allow mapshaper postinstall**

mapshaper has a postinstall step (it depends on `optipng-bin` / similar through its tree on some platforms — verify after install). If pnpm flags any ignored builds, add them to `pnpm-workspace.yaml` under `allowBuilds:`.

- [ ] **Step 4: Verify install**

```
pnpm install
```

- [ ] **Step 5: Commit**

```
git add package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "Plan 03 deps: mapshaper (dev) + d3-geo + topojson-client + tsx"
```

---

## Task 2 — Build script: download module

**Files:**
- Create: `scripts/build-map.ts` (stub)
- Create: `scripts/lib/download.ts`
- Create: `scripts/tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: tsconfig**

Create `scripts/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 2: download.ts**

```ts
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface DownloadOptions {
  url: string;
  destination: string;   // local path
  expectedMinBytes?: number;
}

export async function downloadCached(opts: DownloadOptions): Promise<void> {
  await mkdir(dirname(opts.destination), { recursive: true });

  try {
    const s = await stat(opts.destination);
    if (s.size > 0 && (!opts.expectedMinBytes || s.size >= opts.expectedMinBytes)) {
      console.log(`[download] cache hit: ${opts.destination} (${s.size} bytes)`);
      return;
    }
  } catch {
    // not present yet
  }

  console.log(`[download] fetching ${opts.url}`);
  const res = await fetch(opts.url);
  if (!res.ok) {
    throw new Error(`download failed ${res.status} ${res.statusText} from ${opts.url}`);
  }
  if (!res.body) {
    throw new Error("no body in download response");
  }
  const out = createWriteStream(opts.destination);
  // Node 18+ ReadableStream → web stream → Node stream
  const webStream = res.body as unknown as ReadableStream<Uint8Array>;
  const nodeStream = Readable.fromWeb(webStream as any);
  await pipeline(nodeStream, out);
  const finalSize = (await stat(opts.destination)).size;
  console.log(`[download] saved ${opts.destination} (${finalSize} bytes)`);
  if (opts.expectedMinBytes && finalSize < opts.expectedMinBytes) {
    throw new Error(`downloaded file smaller than expected (${finalSize} < ${opts.expectedMinBytes})`);
  }
}
```

- [ ] **Step 3: Stub build-map.ts**

```ts
import { downloadCached } from "./lib/download.ts";

const GEOBOUNDARIES_ADM1 =
  "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/CGAZ/geoBoundariesCGAZ_ADM1.geojson";

const CACHE_DIR = "scripts/.cache";

async function main() {
  await downloadCached({
    url: GEOBOUNDARIES_ADM1,
    destination: `${CACHE_DIR}/geoBoundariesCGAZ_ADM1.geojson`,
    expectedMinBytes: 50 * 1024 * 1024, // expect at least 50 MB raw
  });
  console.log("[build-map] download step complete (next: simplify + convert)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: .gitignore additions**

Append to `.gitignore`:

```
# Plan 03 generated map assets
scripts/.cache/
public/world.topojson
public/world-meta.json
```

- [ ] **Step 5: Test the download once**

```
pnpm map:build
```

Expected: downloads ~150–250 MB to `scripts/.cache/geoBoundariesCGAZ_ADM1.geojson`. Takes 30s–3min depending on connection. Subsequent runs hit cache.

If download fails (network, GitHub rate limits): keep the script's expectedMinBytes check — surface a clear error.

- [ ] **Step 6: Commit**

```
git add scripts/.cache/.gitkeep scripts/build-map.ts scripts/lib/download.ts scripts/tsconfig.json .gitignore package.json pnpm-lock.yaml 2>/dev/null
# Note: scripts/.cache contents are gitignored, so .cache dir itself won't be staged
git commit -m "Plan 03: build-map script + downloader (geoBoundaries CGAZ ADM1)"
```

---

## Task 3 — Build script: simplify + topojson conversion

**Files:**
- Create: `scripts/lib/simplify.ts`
- Modify: `scripts/build-map.ts`

mapshaper exposes a programmatic API. We feed it the raw GeoJSON, run `-simplify` and `-o format=topojson`, and capture the result.

- [ ] **Step 1: simplify.ts**

```ts
import { readFile, writeFile } from "node:fs/promises";
import mapshaper from "mapshaper";

export interface SimplifyOptions {
  inputGeoJsonPath: string;
  outputTopoJsonPath: string;
  /** Fraction of vertices to retain. 0.05 = 5%. Lower = smaller file, blockier coastlines. */
  retainFraction: number;
}

export async function simplifyToTopoJson(opts: SimplifyOptions): Promise<{ bytes: number }> {
  console.log(`[simplify] reading ${opts.inputGeoJsonPath}`);
  const inputBuf = await readFile(opts.inputGeoJsonPath);
  // mapshaper.applyCommands takes a string-tagged input, runs a CLI-style
  // command, and returns an object keyed by output filename.
  const cmd = [
    "-i input.geojson",
    `-simplify ${(opts.retainFraction * 100).toFixed(1)}% keep-shapes`,
    "-clean",
    "-o output.topojson format=topojson",
  ].join(" ");

  const result = await mapshaper.applyCommands(cmd, {
    "input.geojson": inputBuf,
  });
  const topo = result["output.topojson"];
  if (!topo) {
    throw new Error(`mapshaper produced no output. keys: ${Object.keys(result).join(",")}`);
  }
  await writeFile(opts.outputTopoJsonPath, topo);
  return { bytes: topo.length };
}
```

- [ ] **Step 2: Wire simplify into build-map.ts**

Replace `scripts/build-map.ts` with:

```ts
import { mkdir } from "node:fs/promises";
import { downloadCached } from "./lib/download.ts";
import { simplifyToTopoJson } from "./lib/simplify.ts";

const GEOBOUNDARIES_ADM1 =
  "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/CGAZ/geoBoundariesCGAZ_ADM1.geojson";

const CACHE_DIR = "scripts/.cache";
const PUBLIC_DIR = "public";
const RETAIN_FRACTION = 0.05; // 5%

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
  console.log(`[build-map] world.topojson written (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run + verify size**

```
pnpm map:build
```

Expected: `public/world.topojson` is written, size between 4 MB and 20 MB. If it's outside that range, adjust `RETAIN_FRACTION` (lower for smaller; up to 0.10 if quality looks bad).

- [ ] **Step 4: Commit**

```
git add scripts/lib/simplify.ts scripts/build-map.ts
git commit -m "Plan 03: simplify + topojson conversion via mapshaper"
```

---

## Task 4 — Province metadata extractor

**Files:**
- Create: `scripts/lib/extract-meta.ts`
- Modify: `scripts/build-map.ts`

We need a lookup table from the topojson feature ids (geoBoundaries `shapeID`) to human-friendly names + ISO codes. The frontend uses this to join with `World.provinces` (whose `geometry_ref` will be these shapeIDs).

- [ ] **Step 1: extract-meta.ts**

```ts
import { readFile, writeFile } from "node:fs/promises";

interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
}

export interface ProvinceMeta {
  shape_id: string;        // geoBoundaries shapeID — our geometry_ref
  name: string;
  iso_country: string;     // ISO 3166-1 alpha-3 of containing country
  shape_group: string;     // sometimes equals iso_country
}

export interface MetaFile {
  generated_at: string;
  source: string;
  count: number;
  provinces: ProvinceMeta[];
}

export async function extractMeta(geojsonPath: string, outputPath: string): Promise<MetaFile> {
  const raw = await readFile(geojsonPath, "utf-8");
  const parsed: { features: GeoJsonFeature[] } = JSON.parse(raw);
  const provinces: ProvinceMeta[] = parsed.features
    .map((f) => {
      const p = f.properties;
      const shape_id = String(p.shapeID ?? p.shape_id ?? "");
      if (!shape_id) return null;
      return {
        shape_id,
        name: String(p.shapeName ?? p.shape_name ?? "unknown"),
        iso_country: String(p.shapeISO ?? p.shape_iso ?? ""),
        shape_group: String(p.shapeGroup ?? p.shape_group ?? ""),
      };
    })
    .filter((x): x is ProvinceMeta => x !== null);

  const file: MetaFile = {
    generated_at: new Date().toISOString(),
    source: "geoBoundaries CGAZ ADM1 (CC BY 4.0)",
    count: provinces.length,
    provinces,
  };
  await writeFile(outputPath, JSON.stringify(file));
  return file;
}
```

- [ ] **Step 2: Wire into build-map.ts**

In `scripts/build-map.ts`, after the simplify call, add:

```ts
import { extractMeta } from "./lib/extract-meta.ts";

// ... after simplifyToTopoJson:
const meta = await extractMeta(rawPath, `${PUBLIC_DIR}/world-meta.json`);
console.log(`[build-map] world-meta.json written (${meta.count} provinces)`);
```

- [ ] **Step 3: Run + verify**

```
pnpm map:build
```

Expected: `public/world-meta.json` contains ~3,000+ entries. File size ~500 KB – 2 MB.

- [ ] **Step 4: Commit**

```
git add scripts/lib/extract-meta.ts scripts/build-map.ts
git commit -m "Plan 03: extract province metadata (id, name, ISO)"
```

---

## Task 5 — Frontend: types + loader

**Files:**
- Create: `src/lib/map/types.ts`
- Create: `src/lib/map/loader.ts`

- [ ] **Step 1: types.ts**

```ts
import type { Feature, MultiPolygon, Polygon } from "geojson";

export interface ProvinceMeta {
  shape_id: string;
  name: string;
  iso_country: string;
  shape_group: string;
}

export interface MetaFile {
  generated_at: string;
  source: string;
  count: number;
  provinces: ProvinceMeta[];
}

export type ProvinceFeature = Feature<Polygon | MultiPolygon, ProvinceMeta>;

export interface MapData {
  /** GeoJSON features keyed by shape_id for fast lookup. */
  byShapeId: Map<string, ProvinceFeature>;
  /** Iteration order: arbitrary, matches topojson encoding. */
  features: ProvinceFeature[];
  meta: MetaFile;
}
```

(`geojson` types come bundled with the `@types/d3-geo` install — d3-geo depends on them transitively. If TS can't find them, install `@types/geojson`.)

- [ ] **Step 2: loader.ts**

```ts
import { feature as topoFeature } from "topojson-client";
import type { MapData, MetaFile, ProvinceFeature, ProvinceMeta } from "./types";

interface TopoMaybe {
  type: "Topology";
  objects: Record<string, unknown>;
}

export async function loadMapData(): Promise<MapData> {
  const [topoResp, metaResp] = await Promise.all([
    fetch("/world.topojson"),
    fetch("/world-meta.json"),
  ]);
  if (!topoResp.ok) throw new Error(`failed to load world.topojson: ${topoResp.status}`);
  if (!metaResp.ok) throw new Error(`failed to load world-meta.json: ${metaResp.status}`);

  const topo = (await topoResp.json()) as TopoMaybe;
  const meta = (await metaResp.json()) as MetaFile;

  // mapshaper names its layer 'input' by default (from our '-i input.geojson').
  // Pick whichever object key exists.
  const objKey = Object.keys(topo.objects)[0];
  if (!objKey) throw new Error("topojson has no objects");

  const featureCollection = topoFeature(topo as any, (topo as any).objects[objKey]) as any;
  const features: ProvinceFeature[] = featureCollection.features;

  // Cross-walk: features keep the original geoBoundaries properties on .properties.
  // Index by shape_id for join performance.
  const byShapeId = new Map<string, ProvinceFeature>();
  for (const f of features) {
    const sid = (f.properties as ProvinceMeta).shape_id ?? (f.properties as any).shapeID;
    if (sid) {
      // Normalize: ensure properties has shape_id field.
      (f.properties as ProvinceMeta).shape_id = sid;
      byShapeId.set(sid, f);
    }
  }
  return { byShapeId, features, meta };
}
```

- [ ] **Step 3: Commit**

```
git add src/lib/map
git commit -m "Plan 03: frontend map types + loader"
```

---

## Task 6 — Frontend: projection + renderer

**Files:**
- Create: `src/lib/map/projection.ts`
- Create: `src/lib/map/renderer.ts`

- [ ] **Step 1: projection.ts**

```ts
import { geoEquirectangular, geoPath } from "d3-geo";
import type { GeoPath, GeoProjection } from "d3-geo";
import type { ProvinceFeature } from "./types";

export interface Viewport {
  width: number;
  height: number;
  /** Center pan offset in world units (degrees) — applied via projection translate. */
  centerLon: number;
  centerLat: number;
  /** Zoom multiplier on top of the base scale. */
  zoom: number;
}

export function createProjection(vp: Viewport): { projection: GeoProjection; path: GeoPath } {
  const baseScale = vp.width / (2 * Math.PI); // equirectangular fits world width = 2π · scale
  const projection = geoEquirectangular()
    .scale(baseScale * vp.zoom)
    .translate([vp.width / 2, vp.height / 2])
    .rotate([-vp.centerLon, 0])
    .center([0, vp.centerLat]);
  const path = geoPath(projection);
  return { projection, path };
}

export function pathsFor(
  features: ProvinceFeature[],
  path: GeoPath,
): Map<string, Path2D> {
  const result = new Map<string, Path2D>();
  for (const f of features) {
    const d = path(f);
    if (!d) continue;
    const sid = (f.properties as any).shape_id;
    result.set(sid, new Path2D(d));
  }
  return result;
}
```

- [ ] **Step 2: renderer.ts**

```ts
import type { MapData } from "./types";

export interface RenderOptions {
  paths: Map<string, Path2D>;
  width: number;
  height: number;
  /** Optional: hex color per shape_id; missing keys use neutralLand. */
  fillByShapeId?: Map<string, string>;
  background: string;
  neutralLand: string;
  borderColor: string;
}

export function render(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
  // background
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, opts.width, opts.height);

  // provinces
  ctx.lineWidth = 0.4;
  ctx.strokeStyle = opts.borderColor;
  for (const [sid, p] of opts.paths) {
    ctx.fillStyle = opts.fillByShapeId?.get(sid) ?? opts.neutralLand;
    ctx.fill(p);
    ctx.stroke(p);
  }
}

export function clear(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
}

// Helper for joining map data with optional ownership.
export function buildFillMap(
  data: MapData,
  ownership?: Map<string, string>, // shape_id -> hex color
): Map<string, string> {
  if (!ownership) return new Map();
  const out = new Map<string, string>();
  for (const sid of data.byShapeId.keys()) {
    const color = ownership.get(sid);
    if (color) out.set(sid, color);
  }
  return out;
}
```

- [ ] **Step 3: Commit**

```
git add src/lib/map/projection.ts src/lib/map/renderer.ts
git commit -m "Plan 03: equirectangular projection + canvas renderer"
```

---

## Task 7 — Frontend: WorldMap component with pan/zoom

**Files:**
- Create: `src/components/Map/useMapData.ts`
- Create: `src/components/Map/WorldMap.tsx`

- [ ] **Step 1: useMapData.ts**

```ts
import { useEffect, useState } from "react";
import { loadMapData } from "../../lib/map/loader";
import type { MapData } from "../../lib/map/types";

type State =
  | { status: "loading" }
  | { status: "ready"; data: MapData }
  | { status: "error"; message: string };

export function useMapData(): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadMapData()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
```

- [ ] **Step 2: WorldMap.tsx**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMapData } from "./useMapData";
import { createProjection, pathsFor, type Viewport } from "../../lib/map/projection";
import { render } from "../../lib/map/renderer";

const COLORS = {
  background: "#0a1a2b",
  neutralLand: "#3a5e3a",
  border: "#1f2f1f",
};

export function WorldMap({
  ownershipColors,
}: {
  ownershipColors?: Map<string, string>;
}) {
  const state = useMapData();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 500 });
  const [viewport, setViewport] = useState<Viewport>({
    width: 800,
    height: 500,
    centerLon: 0,
    centerLat: 0,
    zoom: 1,
  });

  // Observe canvas container size.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ w: Math.floor(cr.width), h: Math.floor(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sync viewport with size.
  useEffect(() => {
    setViewport((v) => ({ ...v, width: size.w, height: size.h }));
  }, [size]);

  // Recompute paths when viewport or data changes.
  const paths = useMemo(() => {
    if (state.status !== "ready") return null;
    const { path } = createProjection(viewport);
    return pathsFor(state.data.features, path);
  }, [state, viewport]);

  // Draw.
  useEffect(() => {
    if (!paths) return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = viewport.width * dpr;
    c.height = viewport.height * dpr;
    c.style.width = `${viewport.width}px`;
    c.style.height = `${viewport.height}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, {
      paths,
      width: viewport.width,
      height: viewport.height,
      fillByShapeId: ownershipColors,
      background: COLORS.background,
      neutralLand: COLORS.neutralLand,
      borderColor: COLORS.border,
    });
  }, [paths, viewport, ownershipColors]);

  // Pan + zoom interactions.
  const dragRef = useRef<{ x: number; y: number; lon: number; lat: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      lon: viewport.centerLon,
      lat: viewport.centerLat,
    };
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    // 1px of drag ≈ (degrees) inverse of base scale; use simple heuristic.
    const degPerPx = (360 / viewport.width) / viewport.zoom;
    setViewport((v) => ({
      ...v,
      centerLon: dragRef.current!.lon - dx * degPerPx,
      centerLat: clamp(dragRef.current!.lat + dy * degPerPx, -85, 85),
    }));
  };
  const onMouseUp = () => {
    dragRef.current = null;
  };
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setViewport((v) => ({ ...v, zoom: clamp(v.zoom * factor, 0.5, 16) }));
  }, []);

  if (state.status === "loading") {
    return (
      <div style={containerStyle} ref={containerRef}>
        <div style={messageStyle}>Loading map…</div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={containerStyle} ref={containerRef}>
        <div style={{ ...messageStyle, color: "salmon" }}>
          Failed to load map: {state.message}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle} ref={containerRef}>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        style={{ display: "block", cursor: dragRef.current ? "grabbing" : "grab" }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 4,
          right: 8,
          fontSize: "0.7rem",
          color: "#999",
          background: "rgba(0,0,0,0.4)",
          padding: "2px 6px",
          borderRadius: 3,
          pointerEvents: "none",
        }}
      >
        Map data © geoBoundaries CC BY 4.0 · {state.data.meta.count} provinces
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  background: COLORS.background,
  overflow: "hidden",
};

const messageStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  color: "#bbb",
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
```

- [ ] **Step 3: Commit**

```
git add src/components/Map
git commit -m "Plan 03: WorldMap React component with pan/zoom"
```

---

## Task 8 — Tabs + MapPage + wire into App

**Files:**
- Create: `src/components/shared/Tabs.tsx`
- Create: `src/components/Map/MapPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Tabs.tsx**

```tsx
import { ReactNode } from "react";

export interface Tab<K extends string> {
  key: K;
  label: string;
}

export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab<K>[];
  active: K;
  onChange: (k: K) => void;
}): ReactNode {
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #333", padding: "8px 16px 0" }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            background: active === t.key ? "#2a2a2a" : "transparent",
            color: active === t.key ? "#eee" : "#888",
            border: "1px solid #333",
            borderBottom: active === t.key ? "1px solid #2a2a2a" : "1px solid #333",
            padding: "6px 14px",
            cursor: "pointer",
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            marginBottom: -1,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: MapPage.tsx**

```tsx
import { WorldMap } from "./WorldMap";

export function MapPage() {
  return (
    <div style={{ height: "calc(100vh - 50px)" }}>
      <WorldMap />
    </div>
  );
}
```

- [ ] **Step 3: Wire App.tsx**

Replace `src/App.tsx`:

```tsx
import { useState } from "react";
import "./App.css";
import { MapPage } from "./components/Map/MapPage";
import { Settings } from "./components/Settings";
import { Tabs } from "./components/shared/Tabs";

type TabKey = "settings" | "map";

function App() {
  const [tab, setTab] = useState<TabKey>("settings");
  return (
    <main>
      <Tabs<TabKey>
        tabs={[
          { key: "settings", label: "Settings" },
          { key: "map", label: "Map" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "settings" ? <Settings /> : <MapPage />}
    </main>
  );
}

export default App;
```

- [ ] **Step 4: Commit**

```
git add src/components/shared/Tabs.tsx src/components/Map/MapPage.tsx src/App.tsx
git commit -m "Plan 03: tabs + MapPage + App tab switcher"
```

---

## Task 9 — Final verification

**Files:**
- (none — verification step)

- [ ] **Step 1: Frontend build**

```
pnpm build
```

Expected: clean. The `public/world.topojson` + `public/world-meta.json` are NOT bundled into the JS — they're served as static assets via fetch, so they don't bloat the JS bundle.

- [ ] **Step 2: Rust test suite (regression check — no Rust changes in this plan)**

```
cd src-tauri && cargo test
```

Expected: same counts as end of Plan 02 — 33 unit + 2 integration = 35 passed, 1 ignored.

- [ ] **Step 3: Manual smoke test (user runs)**

```
pnpm tauri dev
```

Expected:
- App opens with two tabs (Settings | Map)
- Settings still works (regression check)
- Click Map → loading state for ~1s, then world map appears
- Pan with mouse drag works
- Wheel zoom works
- Attribution "Map data © geoBoundaries CC BY 4.0 · N provinces" visible bottom-right

- [ ] **Step 4: Push**

```
git push
```

---

## Plan 03 acceptance criteria

- [ ] `pnpm map:build` produces `public/world.topojson` (4-20 MB) and `public/world-meta.json` (500 KB – 2 MB)
- [ ] `pnpm build` succeeds with no warnings
- [ ] All Plan 01 + Plan 02 tests still pass
- [ ] App opens with Settings | Map tabs
- [ ] Map tab loads and renders ~3,000 province polygons
- [ ] Pan via mouse drag works
- [ ] Zoom via mouse wheel works
- [ ] Attribution line is visible

---

## Open questions / known limitations

- **Cold-load time**: First fetch of world.topojson (5–20 MB) on a slow disk could take 1–3 seconds. If this feels bad, Plan 04 can add a tiny loading splash.
- **No clickable provinces** — adding pointer hit-testing means computing which polygon contains the cursor on every mousemove. We'll add this in Plan 05 when interactions matter (Action Validator wiring).
- **Pan jumps near zoom edges**: at high zoom levels, pan deltas in screen pixels translate to small lat/lon shifts; the current heuristic is OK but not perfect.
- **No tile-based rendering**: at extreme zoom, drawing all 3,000 polygons every frame may stutter. Mitigation strategies (viewport culling, PixiJS) are out of scope for Plan 03; revisit if smoke test shows clear stutter.

---

## Next plan

Plan 04 — **Minimal game loop.** Pick a nation + scenario from a (small, hand-curated) seed list, click "Jump 1 month," World Event Generator (using a tiny prompt) produces an event, displayed. First playable thing. Wires the provider + persistence + map together.
