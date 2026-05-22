import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from "pixi.js";
import { geoEquirectangular, geoPath } from "d3-geo";
import type { GeoPath } from "d3-geo";

import type { ProvinceFeature } from "./types";
import { worldExtentAtBase } from "./renderer";
import type { City, CityKind } from "./cities";
import type { Country } from "./countries";

/**
 * A geoPath context that captures projected polygon rings as flat number
 * arrays. Lets us pipe d3-geo's antimeridian-aware path stream into PIXI.
 */
class RingCollector {
  current: number[] = [];
  rings: number[][] = [];

  reset(): void {
    this.current = [];
    this.rings = [];
  }
  beginPath(): void {
    this.current = [];
  }
  moveTo(x: number, y: number): void {
    if (this.current.length) this.rings.push(this.current);
    this.current = [x, y];
  }
  lineTo(x: number, y: number): void {
    this.current.push(x, y);
  }
  closePath(): void {
    if (this.current.length >= 6) this.rings.push(this.current);
    this.current = [];
  }
}

export interface SceneHandles {
  app: Application;
  /** Container that holds tiles + polygons + borders. Pan/zoom applied here. */
  mapContainer: Container;
  /** Child container of mapContainer — holds satellite tile sprites. */
  tileContainer: Container;
  /** Child container of mapContainer — country fills (Graphics). */
  fillsContainer: Container;
  /** Child container of mapContainer — borders (Graphics). */
  bordersContainer: Container;
  /** Sibling container on the stage — city markers, kept at constant screen size. */
  cityContainer: Container;
  /** Sibling container on the stage — country labels (above provinces, below cities). */
  countryLabelContainer: Container;
  destroy(): void;
}

export async function createPixiScene(
  host: HTMLDivElement,
  width: number,
  height: number,
  backgroundColor: number,
): Promise<SceneHandles> {
  const app = new Application();
  await app.init({
    width,
    height,
    background: backgroundColor,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: "webgl",
  });
  host.appendChild(app.canvas);

  const mapContainer = new Container();
  const tileContainer = new Container();
  const fillsContainer = new Container();
  const bordersContainer = new Container();
  mapContainer.addChild(tileContainer);
  mapContainer.addChild(fillsContainer);
  mapContainer.addChild(bordersContainer);
  app.stage.addChild(mapContainer);

  // Country labels go between provinces and cities. Like cities, they live on
  // the stage (not inside mapContainer) so font size stays constant.
  const countryLabelContainer = new Container();
  countryLabelContainer.eventMode = "none";
  app.stage.addChild(countryLabelContainer);

  // Cities sit on the stage (above mapContainer) so they don't get scaled by
  // the map's pan/zoom transform — markers stay constant size on screen.
  const cityContainer = new Container();
  cityContainer.eventMode = "none";
  app.stage.addChild(cityContainer);

  return {
    app,
    mapContainer,
    tileContainer,
    fillsContainer,
    bordersContainer,
    cityContainer,
    countryLabelContainer,
    destroy() {
      try {
        app.destroy({ removeView: true }, { children: true, texture: true });
      } catch {
        // ignore
      }
    },
  };
}

function hexToInt(color: string): { rgb: number } {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 6) return { rgb: parseInt(hex, 16) };
    if (hex.length === 8) return { rgb: parseInt(hex.slice(0, 6), 16) };
  }
  return { rgb: 0x808080 };
}

export interface BuildPolygonsOptions {
  features: ProvinceFeature[];
  width: number;
  height: number;
  fillByShapeId: Map<string, string>;
  neutralLand: string;
  borderColor: string;
  borderAlpha: number;
  borderWidth: number;
  fillAlpha: number;
}

/**
 * Build (or rebuild) country fills + borders inside the provided containers.
 */
export function buildPolygons(
  fillsContainer: Container,
  bordersContainer: Container,
  opts: BuildPolygonsOptions,
): void {
  for (const c of [fillsContainer, bordersContainer]) {
    for (const child of [...c.children]) {
      c.removeChild(child);
      child.destroy({ children: true });
    }
  }

  const projection = geoEquirectangular()
    .scale(opts.width / (2 * Math.PI))
    .translate([opts.width / 2, opts.height / 2])
    .rotate([0, 0])
    .center([0, 0]);
  const collector = new RingCollector();
  const path: GeoPath = geoPath(projection, collector as any);

  const widthLimit = opts.width * 0.95;
  const heightLimit = opts.height * 0.95;
  const ringsByColor = new Map<string, number[][]>();
  const allBorderRings: number[][] = [];

  for (const f of opts.features) {
    collector.reset();
    path(f);
    const rings = collector.rings.filter((r) => r.length >= 6);
    if (rings.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < minX) minX = r[i];
        if (r[i] > maxX) maxX = r[i];
        if (r[i + 1] < minY) minY = r[i + 1];
        if (r[i + 1] > maxY) maxY = r[i + 1];
      }
    }
    if (maxX - minX >= widthLimit && maxY - minY >= heightLimit) continue;

    const sid = (f.properties as any).shape_id;
    const color = opts.fillByShapeId.get(sid) ?? opts.neutralLand;
    let group = ringsByColor.get(color);
    if (!group) {
      group = [];
      ringsByColor.set(color, group);
    }
    for (const r of rings) {
      group.push(r);
      allBorderRings.push(r);
    }
  }

  const fills = new Graphics();
  for (const [color, rings] of ringsByColor) {
    const { rgb } = hexToInt(color);
    for (const r of rings) {
      fills.poly(r, true);
    }
    fills.fill({ color: rgb, alpha: opts.fillAlpha });
  }
  fillsContainer.addChild(fills);

  const borders = new Graphics();
  for (const r of allBorderRings) {
    borders.poly(r, true);
  }
  const { rgb: borderRgb } = hexToInt(opts.borderColor);
  borders.stroke({
    width: opts.borderWidth,
    color: borderRgb,
    alpha: opts.borderAlpha,
    pixelLine: true,
  });
  bordersContainer.addChild(borders);
}

// ─── Tile pyramid loader ───────────────────────────────────────────────────

export interface TileSet {
  container: Container;
  worldExtent: { x0: number; y0: number; x1: number; y1: number };
  maxLOD: number;
  /** 0..1 — how much to darken each tile via grayscale tint. */
  darken: number;

  loaded: Map<string, { sprite: Sprite; lastUsed: number; lod: number; col: number; row: number }>;
  pending: Set<string>;
  /** Soft cap on loaded sprites. */
  maxLoaded: number;
}

export function createTileSet(
  container: Container,
  worldExtent: { x0: number; y0: number; x1: number; y1: number },
  maxLOD: number,
  darken: number,
): TileSet {
  return {
    container,
    worldExtent,
    maxLOD,
    darken,
    loaded: new Map(),
    pending: new Set(),
    maxLoaded: 512,
  };
}

function tintForDarken(darken: number): number {
  const v = Math.max(0, Math.min(255, Math.round((1 - darken) * 255)));
  return (v << 16) | (v << 8) | v;
}

/**
 * Pick an LOD level for the current user zoom.
 * - zoom 1   → LOD 0 (lowest)
 * - zoom 2   → LOD 1
 * - zoom 4   → LOD 2
 * - zoom 8   → LOD 3
 * - zoom 16  → LOD 4
 * - zoom 32+ → LOD 5 (capped to availability)
 */
function chooseLOD(zoom: number, maxLOD: number): number {
  const ideal = Math.max(0, Math.floor(Math.log2(Math.max(zoom, 1))));
  return Math.min(maxLOD, ideal);
}

/**
 * Sync the tile container with the viewport. Triggers async loads for tiles
 * at the current LOD that intersect the viewport. Tiles at OTHER LODs that
 * also intersect the viewport stay visible as backfill — eliminating the
 * flicker that happens when LOD changes (old tiles vanish before new arrive).
 */
export function updateTiles(
  tiles: TileSet,
  view: { panX: number; panY: number; zoom: number },
  canvas: { w: number; h: number },
): void {
  const lod = chooseLOD(view.zoom, tiles.maxLOD);
  const wExt = tiles.worldExtent;

  // World-space viewport rect (inverse of the container transform).
  const wx0 = (0 - view.panX) / view.zoom;
  const wy0 = (0 - view.panY) / view.zoom;
  const wx1 = (canvas.w - view.panX) / view.zoom;
  const wy1 = (canvas.h - view.panY) / view.zoom;

  const vx0 = Math.max(wx0, wExt.x0);
  const vy0 = Math.max(wy0, wExt.y0);
  const vx1 = Math.min(wx1, wExt.x1);
  const vy1 = Math.min(wy1, wExt.y1);

  // Trigger loads for current-LOD tiles intersecting the viewport.
  if (vx0 < vx1 && vy0 < vy1) {
    const totalCols = Math.pow(2, lod + 1);
    const totalRows = Math.pow(2, lod);
    const tileW = (wExt.x1 - wExt.x0) / totalCols;
    const tileH = (wExt.y1 - wExt.y0) / totalRows;

    const col0 = Math.max(0, Math.floor((vx0 - wExt.x0) / tileW));
    const row0 = Math.max(0, Math.floor((vy0 - wExt.y0) / tileH));
    const col1 = Math.min(totalCols - 1, Math.floor((vx1 - wExt.x0) / tileW));
    const row1 = Math.min(totalRows - 1, Math.floor((vy1 - wExt.y0) / tileH));

    const now = Date.now();
    for (let x = col0; x <= col1; x++) {
      for (let y = row0; y <= row1; y++) {
        const key = `${lod}/${x}/${y}`;
        const existing = tiles.loaded.get(key);
        if (existing) {
          existing.lastUsed = now;
        } else if (!tiles.pending.has(key)) {
          loadTile(tiles, lod, x, y, tileW, tileH);
        }
      }
    }
  }

  // Visibility: ANY loaded tile is visible if its world rect intersects the
  // viewport, regardless of LOD. New tiles are added on top (later children
  // in the container), so when a current-LOD tile loads, it covers the old
  // backfill seamlessly.
  for (const [, entry] of tiles.loaded) {
    const tCols = Math.pow(2, entry.lod + 1);
    const tRows = Math.pow(2, entry.lod);
    const tW = (wExt.x1 - wExt.x0) / tCols;
    const tH = (wExt.y1 - wExt.y0) / tRows;
    const tx0 = wExt.x0 + entry.col * tW;
    const ty0 = wExt.y0 + entry.row * tH;
    const tx1 = tx0 + tW;
    const ty1 = ty0 + tH;
    entry.sprite.visible = tx0 < vx1 && tx1 > vx0 && ty0 < vy1 && ty1 > vy0;
  }

  // LRU eviction — evict off-screen tiles first.
  if (tiles.loaded.size > tiles.maxLoaded) {
    const entries = [...tiles.loaded.entries()]
      .filter(([, e]) => !e.sprite.visible)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const toEvict = tiles.loaded.size - tiles.maxLoaded;
    for (let i = 0; i < Math.min(toEvict, entries.length); i++) {
      const [key, t] = entries[i];
      tiles.container.removeChild(t.sprite);
      t.sprite.destroy();
      tiles.loaded.delete(key);
    }
  }
}

async function loadTile(
  tiles: TileSet,
  z: number,
  x: number,
  y: number,
  tileW: number,
  tileH: number,
): Promise<void> {
  const key = `${z}/${x}/${y}`;
  tiles.pending.add(key);
  try {
    const url = `/tiles/${z}/${x}/${y}.jpg`;
    const tex = (await Assets.load(url)) as Texture;
    if (!tiles.pending.has(key)) return; // canceled
    const sprite = new Sprite(tex);
    sprite.x = tiles.worldExtent.x0 + x * tileW;
    sprite.y = tiles.worldExtent.y0 + y * tileH;
    sprite.width = tileW;
    sprite.height = tileH;
    sprite.tint = tintForDarken(tiles.darken);
    tiles.container.addChild(sprite);
    tiles.loaded.set(key, {
      sprite,
      lastUsed: Date.now(),
      lod: z,
      col: x,
      row: y,
    });
  } catch {
    // 404 or load error — skip silently. The polygon layer still covers the area.
  } finally {
    tiles.pending.delete(key);
  }
}

/**
 * Reset the tile set when the canvas resizes — drops all loaded sprites since
 * their world-coords change with the new extent.
 */
export function resetTiles(tiles: TileSet, worldExtent: TileSet["worldExtent"]): void {
  for (const t of tiles.loaded.values()) {
    tiles.container.removeChild(t.sprite);
    t.sprite.destroy();
  }
  tiles.loaded.clear();
  tiles.pending.clear();
  tiles.worldExtent = worldExtent;
}

export function applyView(
  container: Container,
  view: { panX: number; panY: number; zoom: number },
): void {
  container.position.set(view.panX, view.panY);
  container.scale.set(view.zoom, view.zoom);
}

// ─── City markers ──────────────────────────────────────────────────────────

export interface CityMarker {
  city: City;
  /** World-space coords (in canvas-pixel reference at zoom 1). */
  worldX: number;
  worldY: number;
  /** Marker (star / dot). */
  graphics: Graphics;
  /** Text label — lazy, created the first time the marker becomes label-visible. */
  label: Text | null;
  /** Minimum user zoom at which the marker becomes visible. Lower = more important. */
  markerZoom: number;
  /** Minimum user zoom at which the label becomes visible. */
  labelZoom: number;
}

export interface CityLayer {
  container: Container;
  markers: CityMarker[];
  /** Where in the city container labels live (children added on demand). */
  labelStyle: TextStyle;
  capitalLabelStyle: TextStyle;
}

/**
 * Build the city marker layer. Each marker is a `Graphics` drawn at fixed
 * screen-pixel size; labels are lazy-instantiated when the user zooms in
 * enough that the marker becomes label-visible.
 */
export function buildCities(
  layer: CityLayer,
  cities: City[],
  width: number,
  height: number,
): void {
  // Clear previous markers + labels.
  for (const child of [...layer.container.children]) {
    layer.container.removeChild(child);
    child.destroy();
  }
  layer.markers.length = 0;

  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])
    .rotate([0, 0])
    .center([0, 0]);

  // Sort by importance (scalerank asc, pop desc) so the first markers added are
  // the most important — at low zoom, drawing fewer markers gives them priority.
  const sorted = [...cities].sort((a, b) => {
    if (a.scalerank !== b.scalerank) return a.scalerank - b.scalerank;
    return (b.pop ?? 0) - (a.pop ?? 0);
  });

  for (const city of sorted) {
    const projected = projection([city.lon, city.lat]);
    if (!projected) continue;
    const [wx, wy] = projected;

    const tier = visibilityFor(city);

    const g = new Graphics();
    drawMarker(g, city.kind);
    g.x = wx;
    g.y = wy;
    g.visible = false;
    layer.container.addChild(g);

    layer.markers.push({
      city,
      worldX: wx,
      worldY: wy,
      graphics: g,
      label: null,
      markerZoom: tier.marker,
      labelZoom: tier.label,
    });
  }
}

/**
 * Returns the zoom thresholds at which a city's marker and label become visible.
 * Combines scalerank (Natural Earth's "global importance") with kind:
 *   - National capitals are biased toward earlier appearance than non-capitals.
 *   - Lower scalerank = appears at lower (more zoomed-out) zoom level.
 */
function visibilityFor(c: City): { marker: number; label: number } {
  const sr = c.scalerank;
  if (c.kind === "national_capital") {
    if (sr <= 1) return { marker: 0, label: 2.5 };   // world capitals: always visible
    if (sr <= 3) return { marker: 1.5, label: 3 };
    if (sr <= 5) return { marker: 2.5, label: 4 };
    return { marker: 4, label: 6 };
  }
  if (c.kind === "regional_capital") {
    if (sr <= 2) return { marker: 2, label: 4 };
    if (sr <= 4) return { marker: 3, label: 5 };
    return { marker: 5, label: 7 };
  }
  // city
  if (sr <= 2) return { marker: 2.5, label: 4.5 };
  if (sr <= 4) return { marker: 4, label: 6 };
  return { marker: 6, label: 8 };
}

function drawMarker(g: Graphics, kind: CityKind): void {
  if (kind === "national_capital") {
    const pts = starPoints(0, 0, 7, 3);
    g.poly(pts, true);
    g.fill({ color: 0xe6c270, alpha: 1 }); // muted gold
    g.stroke({ width: 1.3, color: 0x1a140a, alpha: 0.94 });
  } else if (kind === "regional_capital") {
    const pts = starPoints(0, 0, 4.6, 1.95);
    g.poly(pts, true);
    g.fill({ color: 0xd8d2c4, alpha: 0.95 }); // muted silver
    g.stroke({ width: 1.05, color: 0x141414, alpha: 0.92 });
  } else {
    g.circle(0, 0, 3);
    g.fill({ color: 0xefe9dd, alpha: 0.92 }); // warm white
    g.stroke({ width: 0.95, color: 0x141414, alpha: 0.88 });
  }
}

function starPoints(cx: number, cy: number, outerR: number, innerR: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  return pts;
}

function makeLabel(text: string, style: TextStyle): Text {
  const t = new Text({ text, style });
  t.anchor.set(0, 0.5);
  t.visible = false;
  return t;
}

/**
 * Sync screen positions, visibility, and label state to the current view.
 */
export function updateCities(
  layer: CityLayer,
  view: { panX: number; panY: number; zoom: number },
  canvas: { w: number; h: number },
): void {
  for (const m of layer.markers) {
    const sx = m.worldX * view.zoom + view.panX;
    const sy = m.worldY * view.zoom + view.panY;

    // Marker visibility — tier + culling.
    const offscreen =
      sx < -24 || sx > canvas.w + 24 || sy < -24 || sy > canvas.h + 24;
    const wantMarker = !offscreen && view.zoom >= m.markerZoom;
    m.graphics.visible = wantMarker;
    if (wantMarker) {
      m.graphics.x = sx;
      m.graphics.y = sy;
    }

    // Label visibility — lazy create.
    const wantLabel = wantMarker && view.zoom >= m.labelZoom;
    if (wantLabel) {
      if (!m.label) {
        const style =
          m.city.kind === "national_capital"
            ? layer.capitalLabelStyle
            : layer.labelStyle;
        m.label = makeLabel(m.city.name, style);
        layer.container.addChild(m.label);
      }
      m.label.visible = true;
      // Offset label so it doesn't sit on top of the marker.
      const offset =
        m.city.kind === "national_capital"
          ? 11
          : m.city.kind === "regional_capital"
            ? 8
            : 7;
      m.label.x = sx + offset;
      m.label.y = sy;
    } else if (m.label) {
      m.label.visible = false;
    }
  }
}

export function createCityLayer(container: Container): CityLayer {
  // City label — Inter Variable, antialias-friendly halo + drop shadow so the
  // text reads cleanly over both bright continents and dark ocean.
  const labelStyle = new TextStyle({
    fontFamily: '"Inter Variable", "Inter", system-ui, Arial, sans-serif',
    fontSize: 13,
    fill: 0xf6efe1,
    stroke: { color: 0x0a0a0a, width: 3.5 },
    fontWeight: "500",
    letterSpacing: 0.1,
    dropShadow: {
      color: 0x000000,
      distance: 1,
      blur: 2,
      angle: Math.PI / 4,
      alpha: 0.75,
    },
  });
  const capitalLabelStyle = new TextStyle({
    fontFamily: '"Inter Variable", "Inter", system-ui, Arial, sans-serif',
    fontSize: 15,
    fill: 0xfdf2cc,
    stroke: { color: 0x0a0a0a, width: 4.5 },
    fontWeight: "700",
    letterSpacing: 0.15,
    dropShadow: {
      color: 0x000000,
      distance: 1,
      blur: 2.5,
      angle: Math.PI / 4,
      alpha: 0.85,
    },
  });
  return {
    container,
    markers: [],
    labelStyle,
    capitalLabelStyle,
  };
}

/**
 * Clamp pan + zoom so the world stays on-screen:
 *   - If the scaled world is SMALLER than the canvas (zoomed out enough),
 *     pan is forced to center the world.
 *   - If the scaled world is LARGER than the canvas (zoomed in), pan is
 *     clamped so the world bounds still cover the canvas — you can't push
 *     the world entirely off-screen.
 */
export function clampView(
  view: { panX: number; panY: number; zoom: number },
  canvas: { w: number; h: number },
  worldExtent: { x0: number; y0: number; x1: number; y1: number },
): { panX: number; panY: number; zoom: number } {
  const worldW = worldExtent.x1 - worldExtent.x0;
  const worldH = worldExtent.y1 - worldExtent.y0;
  const scaledW = worldW * view.zoom;
  const scaledH = worldH * view.zoom;

  let panX = view.panX;
  let panY = view.panY;

  if (scaledW <= canvas.w) {
    panX = (canvas.w - scaledW) / 2 - worldExtent.x0 * view.zoom;
  } else {
    const minPanX = canvas.w - worldExtent.x1 * view.zoom;
    const maxPanX = -worldExtent.x0 * view.zoom;
    panX = Math.max(minPanX, Math.min(maxPanX, panX));
  }
  if (scaledH <= canvas.h) {
    panY = (canvas.h - scaledH) / 2 - worldExtent.y0 * view.zoom;
  } else {
    const minPanY = canvas.h - worldExtent.y1 * view.zoom;
    const maxPanY = -worldExtent.y0 * view.zoom;
    panY = Math.max(minPanY, Math.min(maxPanY, panY));
  }

  return { panX, panY, zoom: view.zoom };
}

export function resizeRenderer(
  app: Application,
  width: number,
  height: number,
): void {
  app.renderer.resize(width, height);
}

// ─── Country name labels ───────────────────────────────────────────────────

export interface CountryLabel {
  country: Country;
  worldX: number;
  worldY: number;
  /** Approx country diameter in world-pixels at zoom 1 (for font sizing). */
  worldSize: number;
  text: Text;
}

export interface CountryLabelLayer {
  container: Container;
  labels: CountryLabel[];
  baseStyle: TextStyle;
}

export function createCountryLabelLayer(container: Container): CountryLabelLayer {
  const baseStyle = new TextStyle({
    fontFamily: '"Inter Variable", "Inter", system-ui, Arial, sans-serif',
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 2.4,
    fill: 0xf2ead7,
    stroke: { color: 0x0a0a0a, width: 4 },
    align: "center",
    dropShadow: {
      color: 0x000000,
      distance: 1,
      blur: 3,
      angle: Math.PI / 4,
      alpha: 0.85,
    },
  });
  return { container, labels: [], baseStyle };
}

/**
 * Rebuild the country name layer. Each label is a `Text` placed at the
 * country's Natural Earth label anchor, in uppercase tracked form. Visibility
 * is driven by zoom — see `updateCountryLabels`.
 */
export function buildCountryLabels(
  layer: CountryLabelLayer,
  countries: Country[],
  width: number,
  height: number,
): void {
  for (const child of [...layer.container.children]) {
    layer.container.removeChild(child);
    child.destroy();
  }
  layer.labels.length = 0;

  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])
    .rotate([0, 0])
    .center([0, 0]);

  for (const country of countries) {
    const projected = projection([country.label_lon, country.label_lat]);
    if (!projected) continue;
    const [wx, wy] = projected;

    // worldSize ≈ projected width of the country at zoom 1, in canvas pixels.
    const [x0, , x1] = country.bbox;
    const worldSize = Math.abs(((x1 - x0) / 360) * width);

    const text = new Text({
      text: country.name.toUpperCase(),
      style: layer.baseStyle,
    });
    text.anchor.set(0.5, 0.5);
    text.visible = false;
    layer.container.addChild(text);
    layer.labels.push({ country, worldX: wx, worldY: wy, worldSize, text });
  }
}

/**
 * Update country label visibility, position, and per-country font size.
 *   - Tiny countries (worldSize < threshold for current zoom) stay hidden.
 *   - Font size scales with the country's projected pixel size; we want a
 *     country to read at "fits inside the country" weight.
 *   - Fade in/out near the visibility boundary instead of popping.
 */
export function updateCountryLabels(
  layer: CountryLabelLayer,
  view: { panX: number; panY: number; zoom: number },
  canvas: { w: number; h: number },
): void {
  // Visibility band: anything whose pixel diameter at current zoom is between
  // ~70 (too small to read) and ~700 (so big the label feels lost) qualifies.
  const minPx = 80;
  const fadeMinPx = 110;
  const fadeMaxPx = 900;
  const maxPx = 1400;

  for (const lbl of layer.labels) {
    const sx = lbl.worldX * view.zoom + view.panX;
    const sy = lbl.worldY * view.zoom + view.panY;
    const projectedPx = lbl.worldSize * view.zoom;

    const offscreen =
      sx < -200 || sx > canvas.w + 200 || sy < -100 || sy > canvas.h + 100;
    if (offscreen || projectedPx < minPx || projectedPx > maxPx) {
      lbl.text.visible = false;
      continue;
    }

    // Smooth fade near the band edges.
    let alpha = 1;
    if (projectedPx < fadeMinPx) {
      alpha = (projectedPx - minPx) / (fadeMinPx - minPx);
    } else if (projectedPx > fadeMaxPx) {
      alpha = Math.max(0, (maxPx - projectedPx) / (maxPx - fadeMaxPx));
    }
    if (alpha <= 0.03) {
      lbl.text.visible = false;
      continue;
    }

    // Font size: roughly proportional to country diameter, clamped to a
    // legible range. Bigger countries get bigger names, same as HOI4 / EU4.
    const fontSize = clamp(projectedPx / 18, 12, 34);
    if (Math.abs(lbl.text.style.fontSize - fontSize) > 0.5) {
      lbl.text.style.fontSize = fontSize;
      lbl.text.style.letterSpacing = clamp(fontSize * 0.15, 2, 6);
      lbl.text.style.stroke = {
        color: 0x0a0a0a,
        width: clamp(fontSize / 4, 3, 6),
      };
    }

    lbl.text.x = sx;
    lbl.text.y = sy;
    lbl.text.alpha = alpha;
    lbl.text.visible = true;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export { worldExtentAtBase };
