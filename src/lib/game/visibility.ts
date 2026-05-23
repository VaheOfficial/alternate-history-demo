import type { TreatyKind, World } from "./types";

/**
 * Fog-of-war visibility, computed per-render from the current world state.
 * v1 is client-side only — the engine still ships the full world; only the
 * map rendering is filtered. See `docs/superpowers/plans/2026-05-22-plan-09-
 * fog-of-war.md` for the design.
 */
export interface Visibility {
  /** geometry_refs of fully-visible provinces. */
  visibleProvinces: Set<string>;
  /**
   * Nation IDs of the player + allies. Unit stacks owned by these nations
   * stay visible everywhere they appear (expeditionary forces, naval-transit
   * landings) even if the containing province itself is fogged.
   */
  alliedNations: Set<string>;
}

const ALLY_TREATY_KINDS: ReadonlySet<TreatyKind> = new Set<TreatyKind>([
  "alliance",
  "defensive_pact",
]);

/**
 * Build the player's visibility map. Adjacency is a `shape_id → neighbours`
 * lookup — typically the same `province-adjacency.json` payload the
 * frontend already loads for shift+click movement.
 *
 * Rules (mirror of the plan doc):
 *  1. Owner-side visibility: provinces owned by player or any ally.
 *  2. Border-scout visibility: each neighbour (one step) of an owner-side
 *     province.
 *  3. Footprint visibility: every province containing an allied unit.
 *  4. No player nation (observer mode): everything visible — no fog.
 */
export function computeVisibility(
  world: World,
  adjacency: Record<string, string[]>,
): Visibility {
  // Observer mode: pre-pick or unassigned. Show everything so the UI
  // doesn't suddenly cover the whole map in fog before the player has
  // picked a country.
  if (!world.player_nation) {
    return {
      visibleProvinces: new Set(world.provinces.map((p) => p.geometry_ref)),
      alliedNations: new Set(),
    };
  }

  // 1. Allied nation set: player + every member of any Alliance / DefensivePact
  //    they're a party to.
  const alliedNations = new Set<string>([world.player_nation]);
  for (const t of world.treaties) {
    if (!ALLY_TREATY_KINDS.has(t.kind)) continue;
    if (!t.parties.includes(world.player_nation)) continue;
    for (const p of t.parties) alliedNations.add(p);
  }

  // 2. Owner-side: every province whose owner is in the allied set.
  const ownedByAllies = new Set<string>();
  for (const p of world.provinces) {
    if (alliedNations.has(p.owner)) ownedByAllies.add(p.geometry_ref);
  }

  // 3. Border-scout: union in every neighbour of an owned province.
  const visibleProvinces = new Set(ownedByAllies);
  for (const ref of ownedByAllies) {
    const neighbours = adjacency[ref];
    if (!neighbours) continue;
    for (const n of neighbours) visibleProvinces.add(n);
  }

  // 4. Footprint: provinces containing an allied unit. Build a province
  //    id → geometry_ref index once so we don't scan O(provinces) per unit.
  const refByProvinceId = new Map<string, string>();
  for (const p of world.provinces) refByProvinceId.set(p.id, p.geometry_ref);
  for (const u of world.units) {
    if (!alliedNations.has(u.owner)) continue;
    const ref = refByProvinceId.get(u.location);
    if (ref) visibleProvinces.add(ref);
  }

  return { visibleProvinces, alliedNations };
}

/**
 * Convenience: would this unit's stack be drawn for the player?
 * Allied units everywhere + enemy units in visible provinces.
 */
export function unitIsVisible(
  ownerId: string,
  provinceRef: string,
  visibility: Visibility,
): boolean {
  if (visibility.alliedNations.has(ownerId)) return true;
  return visibility.visibleProvinces.has(provinceRef);
}
