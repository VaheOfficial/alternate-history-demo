import type { Nation, Province, World } from "./types";
import { colorForMapcolor } from "../map/renderer";

/**
 * Build the shape_id → fill-color map for the current world state.
 * Each province is colored by its OWNER nation's `map_color` (Natural Earth
 * mapcolor13 palette), so neighboring countries are always visually distinct.
 *
 * `withSelected` (optional shape_id) renders that province in a highlight
 * color so a clicked province pops above the rest.
 */
export function buildOwnershipColors(
  world: World,
  options?: { selectedShape?: string | null; highlight?: string },
): Map<string, string> {
  const nationById = new Map<string, Nation>();
  for (const n of world.nations) nationById.set(n.id, n);

  const colors = new Map<string, string>();
  for (const p of world.provinces) {
    const n = nationById.get(p.owner);
    const mc = n ? n.map_color : 1;
    colors.set(p.geometry_ref, colorForMapcolor(mc));
  }
  if (options?.selectedShape) {
    colors.set(
      options.selectedShape,
      options.highlight ?? "#f5d76e",
    );
  }
  return colors;
}

export function findProvinceByShape(
  world: World,
  shape_id: string,
): Province | null {
  return world.provinces.find((p) => p.geometry_ref === shape_id) ?? null;
}

export function findNation(world: World, id: string): Nation | null {
  return world.nations.find((n) => n.id === id) ?? null;
}
