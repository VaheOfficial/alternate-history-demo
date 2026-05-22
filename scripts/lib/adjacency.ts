import { readFile, writeFile } from "node:fs/promises";

/**
 * Compute province adjacency from the dissolved geojson.
 *
 * Two provinces are adjacent iff they share ANY edge (vertex pair). We hash
 * each segment by canonical endpoint pair (rounded to 7 decimal places ≈ 1cm
 * precision); any segment hashed by more than one province implies adjacency.
 *
 * Result: { generated_at, count, adjacency: { [shape_id]: [shape_id, ...] } }
 * — one neighbour list per province, both directions populated.
 */

interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

function pickShapeId(p: Record<string, unknown>, idx: number): string {
  const mg = String(p.merge_group ?? "");
  if (mg && mg !== "-99") return mg;
  const code = String(p.adm1_code ?? "");
  if (code && code !== "-99" && code !== "") return code;
  const iso = String(p.iso_3166_2 ?? "");
  if (iso && iso !== "-99" && iso !== "") return iso;
  const a3 = String(p.adm0_a3 ?? "XXX");
  return `${a3}_${idx}`;
}

function segKey(a: [number, number], b: [number, number]): string {
  // Round to ~1cm precision in geographic coords.
  const r = (v: number) => Math.round(v * 1e7) / 1e7;
  const [ax, ay, bx, by] = [r(a[0]), r(a[1]), r(b[0]), r(b[1])];
  if (ax < bx || (ax === bx && ay < by)) return `${ax},${ay}|${bx},${by}`;
  return `${bx},${by}|${ax},${ay}`;
}

function* iterRings(f: Feature): IterableIterator<Array<[number, number]>> {
  if (f.geometry.type === "Polygon") {
    for (const ring of f.geometry.coordinates as number[][][]) {
      yield ring as Array<[number, number]>;
    }
  } else if (f.geometry.type === "MultiPolygon") {
    for (const poly of f.geometry.coordinates as number[][][][]) {
      for (const ring of poly) {
        yield ring as Array<[number, number]>;
      }
    }
  }
}

export interface AdjacencyFile {
  generated_at: string;
  count: number;
  adjacency: Record<string, string[]>;
}

export async function buildAdjacency(
  dissolvedGeoJsonPath: string,
  outputPath: string,
): Promise<{ pairs: number }> {
  const raw = await readFile(dissolvedGeoJsonPath, "utf-8");
  const fc: FeatureCollection = JSON.parse(raw);

  // Map: seg-key → list of shape_ids touching that segment.
  const segOwners = new Map<string, string[]>();
  fc.features.forEach((f, idx) => {
    const sid = pickShapeId(f.properties, idx);
    for (const ring of iterRings(f)) {
      for (let i = 0; i < ring.length - 1; i++) {
        const k = segKey(ring[i], ring[i + 1]);
        let owners = segOwners.get(k);
        if (!owners) {
          owners = [];
          segOwners.set(k, owners);
        }
        if (!owners.includes(sid)) owners.push(sid);
      }
    }
  });

  // Adjacency = pairs of distinct shape_ids sharing any segment.
  const adj = new Map<string, Set<string>>();
  for (const owners of segOwners.values()) {
    if (owners.length < 2) continue;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        if (!adj.has(owners[i])) adj.set(owners[i], new Set());
        if (!adj.has(owners[j])) adj.set(owners[j], new Set());
        adj.get(owners[i])!.add(owners[j]);
        adj.get(owners[j])!.add(owners[i]);
      }
    }
  }

  const out: AdjacencyFile = {
    generated_at: new Date().toISOString(),
    count: adj.size,
    adjacency: {},
  };
  let pairs = 0;
  for (const [sid, neighbours] of adj) {
    const arr = [...neighbours].sort();
    out.adjacency[sid] = arr;
    pairs += arr.length;
  }
  await writeFile(outputPath, JSON.stringify(out));
  return { pairs: pairs / 2 }; // each pair counted twice
}
