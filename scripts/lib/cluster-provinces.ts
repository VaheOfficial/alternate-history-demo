import { readFile, writeFile } from "node:fs/promises";

/**
 * Per-country tile balancing — runs BEFORE mapshaper's dissolve.
 *
 * Goals:
 *   - Big countries (USA, Russia, China) get a sensible tile count so each
 *     tile is a meaningful piece of territory — not a Wyoming-spans-half-
 *     the-continent super-tile, and not 500 micro-tiles either.
 *   - Mid-size countries keep their natural admin_1 count (Poland 16,
 *     Germany 16, Italy 21).
 *   - Small countries keep enough detail (Latvia ~11, Estonia ~9).
 *
 * Algorithm:
 *   1. Target tile count per country = clamp(√area * 2.5, 5, 60).
 *   2. If a country already has ≤ target admin_1 polygons → keep as-is.
 *   3. Otherwise k-means cluster centroids into target groups:
 *      - k-means++ init (deterministic: pick the polygon farthest from
 *        the existing seeds each round, starting from the largest).
 *      - Lloyd's algorithm, max 20 iterations, weight centroids by area
 *        so big polygons anchor their cluster.
 *   4. Each polygon's `merge_group` = "<iso>|<anchor adm1_code>".
 *      Mapshaper's `-dissolve2 merge_group` then physically unions them.
 */

interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
  [k: string]: unknown;
}

interface Centroid {
  x: number;
  y: number;
  area: number;
  bbox: [number, number, number, number];
}

function bboxAndCentroid(geometry: Feature["geometry"]): Centroid {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number;
      const y = c[1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
      count += 1;
      return;
    }
    for (const inner of c) visit(inner);
  };
  visit(geometry.coordinates);
  if (count === 0) {
    return { x: 0, y: 0, area: 0, bbox: [0, 0, 0, 0] };
  }
  return {
    x: sumX / count,
    y: sumY / count,
    area: Math.max(0, (maxX - minX) * (maxY - minY)),
    bbox: [minX, minY, maxX, maxY],
  };
}

/** Area in deg² → target tile count. Multiplier 2.0 keeps every country
 *  meaningful but cuts Algeria/Egypt/Guinea-style over-subdivision.
 *  Min 8 keeps small countries playable, max 60 caps the giants. */
function targetCount(areaDeg2: number): number {
  if (areaDeg2 <= 0) return 1;
  const raw = Math.round(Math.sqrt(areaDeg2) * 2.0);
  return Math.max(8, Math.min(60, raw));
}

/** Union the bboxes of every entry to get the country's overall bbox.
 *  Summing individual bbox areas overcounts (bboxes overlap) — using the
 *  union gives a stable area estimate that doesn't grow with admin_1
 *  granularity. */
function countryBboxArea(entries: Entry[]): number {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const e of entries) {
    const [w, s, ee, n] = e.centroid.bbox;
    if (w < minX) minX = w;
    if (s < minY) minY = s;
    if (ee > maxX) maxX = ee;
    if (n > maxY) maxY = n;
  }
  if (!Number.isFinite(minX)) return 0;
  return Math.max(0, (maxX - minX) * (maxY - minY));
}

function pickShapeId(p: Record<string, unknown>, fallbackIndex: number): string {
  const code = String(p.adm1_code ?? "");
  if (code && code !== "-99" && code !== "") return code;
  const iso = String(p.iso_3166_2 ?? "");
  if (iso && iso !== "-99" && iso !== "") return iso;
  const a3 = String(p.adm0_a3 ?? "XXX");
  return `${a3}_${fallbackIndex}`;
}

export interface ClusterStats {
  /** Number of admin_1 polygons read. */
  inputFeatures: number;
  /** Number of distinct merge_groups produced (after clustering). */
  groupsAfter: number;
  /** Sample of (iso → before/after count) for countries that were reduced. */
  reductions: Array<{ iso: string; before: number; after: number }>;
}

interface Entry {
  feature: Feature;
  idx: number;
  centroid: Centroid;
}

/** Squared planar distance — good enough for clustering within a country. */
function distSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Deterministic k-means++ init: largest polygon = seed 0, then repeatedly
 *  pick the polygon FARTHEST from any existing seed (no randomness). */
function pickInitialCentroids(entries: Entry[], k: number): { x: number; y: number }[] {
  const sortedByArea = [...entries].sort(
    (a, b) => b.centroid.area - a.centroid.area,
  );
  const centroids: { x: number; y: number }[] = [
    { x: sortedByArea[0].centroid.x, y: sortedByArea[0].centroid.y },
  ];
  while (centroids.length < k) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < entries.length; i++) {
      let minD = Infinity;
      for (const c of centroids) {
        const d = distSq(entries[i].centroid, c);
        if (d < minD) minD = d;
      }
      if (minD > bestDist) {
        bestDist = minD;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    centroids.push({
      x: entries[bestIdx].centroid.x,
      y: entries[bestIdx].centroid.y,
    });
  }
  return centroids;
}

/** Lloyd's algorithm. Returns the cluster index for each entry. */
function kmeans(entries: Entry[], k: number): number[] {
  let centroids = pickInitialCentroids(entries, k);
  const assignments = new Array<number>(entries.length).fill(0);

  for (let iter = 0; iter < 25; iter++) {
    let changed = false;
    for (let i = 0; i < entries.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distSq(entries[i].centroid, centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }
    if (!changed) break;

    // Recompute centroids — weight each polygon by area so the cluster
    // "follows" its big anchors rather than getting yanked by clusters of
    // small slivers.
    const sums = centroids.map(() => ({ sx: 0, sy: 0, sw: 0 }));
    for (let i = 0; i < entries.length; i++) {
      const c = sums[assignments[i]];
      const w = entries[i].centroid.area + 0.01;
      c.sx += entries[i].centroid.x * w;
      c.sy += entries[i].centroid.y * w;
      c.sw += w;
    }
    centroids = sums.map((s, idx) =>
      s.sw > 0 ? { x: s.sx / s.sw, y: s.sy / s.sw } : centroids[idx],
    );
  }
  return assignments;
}

export async function clusterProvinces(
  inputGeoJsonPath: string,
  outputGeoJsonPath: string,
): Promise<ClusterStats> {
  const raw = await readFile(inputGeoJsonPath, "utf-8");
  const fc: FeatureCollection = JSON.parse(raw);

  const byCountry = new Map<string, Entry[]>();
  fc.features.forEach((f, idx) => {
    const iso = String(f.properties.adm0_a3 ?? "");
    if (!iso) return;
    const c = bboxAndCentroid(f.geometry);
    let list = byCountry.get(iso);
    if (!list) {
      list = [];
      byCountry.set(iso, list);
    }
    list.push({ feature: f, idx, centroid: c });
  });

  const reductions: ClusterStats["reductions"] = [];
  let groupsAfter = 0;

  for (const [iso, entries] of byCountry) {
    const countryArea = countryBboxArea(entries);
    const target = targetCount(countryArea);

    if (entries.length <= target) {
      for (const e of entries) {
        const groupId = pickShapeId(e.feature.properties, e.idx);
        e.feature.properties.merge_group = `${iso}|${groupId}`;
      }
      groupsAfter += entries.length;
      continue;
    }

    // k-means clustering for balanced spatial groups.
    const assignments = kmeans(entries, target);

    // Per-cluster: pick the largest member as the cluster's "anchor" so the
    // merge_group ID is stable across runs.
    const clusterEntries: Entry[][] = Array.from({ length: target }, () => []);
    for (let i = 0; i < entries.length; i++) {
      clusterEntries[assignments[i]].push(entries[i]);
    }
    for (let c = 0; c < target; c++) {
      const cluster = clusterEntries[c];
      if (cluster.length === 0) continue;
      cluster.sort((a, b) => b.centroid.area - a.centroid.area);
      const anchorId = pickShapeId(cluster[0].feature.properties, cluster[0].idx);
      for (const e of cluster) {
        e.feature.properties.merge_group = `${iso}|${anchorId}`;
      }
    }

    reductions.push({ iso, before: entries.length, after: target });
    groupsAfter += target;
  }

  await writeFile(outputGeoJsonPath, JSON.stringify(fc));
  return {
    inputFeatures: fc.features.length,
    groupsAfter,
    reductions,
  };
}
