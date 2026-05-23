# Plan 09 — Fog of War

**Status:** In progress
**Builds on:** Plan 06 (Combat MVP), the live country outline from the
post-Plan-08 polish round.

## Why

Right now every nation's unit stacks are drawn on the map regardless of who
the player is or what they could plausibly know. The user's complaint
(verbatim):

> "We need a fog of war type thing. We shouldnt be able to see troops of
> nations we are not allied with. Unless they are right at our border or we
> have troops nearby. Similar to how the HOI4 fog of war looks."

That's the spec. The original design doc (section 4 of
`2026-05-21-alternate-history-game-design.md`) doesn't have a dedicated fog
section but the design intent ("decisional pause", players see what they
could plausibly know) lines up.

## What "visibility" means in v1

Three buckets per province, evaluated from the player's perspective:

1. **Fully visible** — country fill renders normally, unit stacks render
   normally.
   - Provinces owned by the player or by any allied nation
     (Alliance / DefensivePact treaty including the player).
   - Provinces adjacent (via the existing land adjacency graph) to a
     fully-visible province.
   - Provinces containing any unit owned by the player or an ally
     (covers expeditionary forces, naval-transit landings).

2. **Partial / "geography known"** — country fill still renders (real-world
   borders are public knowledge in a 2026 setting), but unit stacks are
   NOT drawn. We add a subtle dark overlay so the player can tell at a
   glance which provinces are unscouted.

3. **Always visible regardless of bucket** — units owned by the player
   or an ally are drawn wherever they are. If you have a division inside
   enemy territory it still shows on the map for you, even if the province
   itself is bucket 2.

## What's out of scope for this plan

- **Server-side visibility filter.** The Rust backend keeps shipping the full
  world to the frontend; the LLM is omniscient (it's the narrator). Only the
  rendered map is filtered. A real anti-cheat-style server filter is its own
  plan; this is a single-player offline game and per-client filtering is
  fine for v1.
- **Last-seen snapshots.** HOI4 shows "last seen 3 days ago" stale data for
  units in formerly-scouted provinces. v1 just hides current unit stacks in
  unscouted provinces — no historical-state cache.
- **Naval / air sightlines, recon planes, intelligence services.** All v2.
- **Visibility for NPC AI.** NPC nations still see the full world when
  picking their actions. Restricting their information is a much bigger
  AI-design question; deferred.

## Implementation

All client-side. Single new module + a couple of touch-ups.

### 1. New helper: `src/lib/game/visibility.ts`

```ts
export interface Visibility {
  /** geometry_refs of fully-visible provinces. */
  visibleProvinces: Set<string>;
  /** nation_ids of the player + allies. Unit stacks owned by these are
   *  always visible. */
  alliedNations: Set<string>;
}

export function computeVisibility(
  world: World,
  adjacency: Record<string, string[]>,
): Visibility { ... }
```

Algorithm:
1. Seed `alliedNations` with `world.player_nation`. Walk `world.treaties`;
   for each Alliance / DefensivePact whose `parties` includes the player,
   union the rest in.
2. Build `ownedByAllies = { geometry_ref of every province whose
   owner ∈ alliedNations }`.
3. `visibleProvinces = ownedByAllies` plus, for each ref in
   `ownedByAllies`, every neighbour in `adjacency[ref]`.
4. Plus, for each `unit` whose owner ∈ alliedNations: the
   `geometry_ref` of its containing province.

Edge cases:
- No player nation set (observer mode pre-pick): return a Visibility that
  marks everything visible (no fog).
- Adjacency map empty / not yet loaded: degrade gracefully — render
  everything visible so the user doesn't see weird half-loaded fog.

### 2. GameSession wires it in

```tsx
const visibility = useMemo(
  () => computeVisibility(world, adjacency ?? {}),
  [world, adjacency],
);

const unitStacks = useMemo(() => {
  // existing computation, but skip non-visible enemy stacks:
  if (!visibility.alliedNations.has(u.owner) &&
      !visibility.visibleProvinces.has(province.geometry_ref)) continue;
  ...
}, [..., visibility]);
```

Pass `visibleProvinces` down to `WorldMap` so the renderer can draw the
fog overlay.

### 3. WorldMap + pixi-renderer fog overlay

A new layer (`fogContainer`) drawn between fills and borders. For each
non-visible province, project its outline and fill with `rgba(0, 0, 0, 0.45)`.
Subtle enough that the country mapcolor still shows through, but
distinctly "you don't know what's happening there".

Implementation:
- New `FogLayer` interface mirroring the existing `HighlightLayer`
  pattern.
- `buildFog(layer, features, visibleSet, width, height)` projects every
  non-visible province's rings, stores them, draws fills.
- Triggered in the same useEffect that rebuilds polygons (so it
  refreshes whenever ownership / visibility changes).

### 4. Treaty type predicate

Treaty kinds we count as "ally":
- `Alliance`
- `DefensivePact`

Not allies for visibility:
- `TradeAgreement`, `NonAggression`, `Ceasefire`, `PeaceTreaty`,
  `Vassalage` — none of these imply intelligence-sharing in real life.

## Tests

- `visibility.test.ts` (frontend) — actually skipping since the repo has
  no Vitest setup yet; the logic is small and pure, will be covered by
  manual + screenshot verification.
- `cargo test --lib` should still pass unchanged (no Rust changes).
- Live verification: start a new game as USA. Confirm:
  - All USA provinces clearly visible (units shown).
  - Mexico / Canada provinces visible (border-adjacent), units shown.
  - Allied NATO nations' units visible everywhere.
  - China / Russia / Iran provinces have the dim fog overlay; their unit
    stacks are not drawn.
  - If the player drops a division on a Chinese border via shift+click
    after declaring war, the adjacent Chinese provinces become visible.

## Files touched

- `src/lib/game/visibility.ts` — new helper.
- `src/components/Game/GameSession.tsx` — compute visibility, filter unit
  stacks, pass visible set to WorldMap.
- `src/components/Map/WorldMap.tsx` — new prop, wire fog layer.
- `src/lib/map/pixi-renderer.ts` — new FogLayer + builders.

## Done criteria

1. Player sees only own + allied + border-adjacent + nearby-troop unit
   stacks. Verified by running a new game and checking China is fogged.
2. Fog overlay renders subtly without obscuring country mapcolors.
3. Shift+click movement still works for visible provinces.
4. `pnpm tsc --noEmit` + `pnpm build` + `cargo test --lib` all clean.
5. Plan doc landed.
