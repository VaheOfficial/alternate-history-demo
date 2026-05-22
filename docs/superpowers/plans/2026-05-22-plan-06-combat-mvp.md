# Plan 06 — Combat MVP

**Goal:** Wars become real things you fight, not relations-flag flips. Player
builds armies via LLM-mediated production, moves them between adjacent
provinces, and the engine resolves battles deterministically. Province
ownership flips when a country's last defender is destroyed.

## Core design decisions

1. **Production is LLM-mediated.** Player types what they want
   ("recruit 5 armored divisions and 3 infantry"); LLM looks at the nation's
   industry / resources / treasury and returns the actual buildable subset
   plus a narrative. Engine spawns the units in the player's capital province
   (or specified province).

2. **Movement = adjacency hops.** Each `MoveUnit` action moves one province
   if the destination is adjacent (or same province for re-anchoring).
   No path-finding yet — one hop per turn keeps combat tractable.

3. **Adjacency graph baked into the build pipeline.** Mapshaper has
   topology-aware neighbour detection. Pre-compute once, ship as
   `province-adjacency.json` keyed by `shape_id`. Frontend + engine both
   read it.

4. **Combat is deterministic.**
   ```
   power = strength × (org/100) × doctrine_mod × tech_mod × terrain_mod
   ratio = attacker_power / defender_power
   ```
   - `ratio ≥ 1.5` → decisive attacker win; defender loses 80% strength,
     attacker loses 10%. If no defenders remain, attacker occupies and
     province flips owner.
   - `1 ≤ ratio < 1.5` → attacker win; defender -50%, attacker -20%.
   - `0.7 ≤ ratio < 1` → stalemate; both -25% strength, attacker stays at
     origin (push repulsed).
   - `ratio < 0.7` → attacker repulsed; attacker -50%, defender -10%.

5. **Conquest stamps an Event** so it shows up in TurnSummaryModal's world
   events. Captures attacker, defender, province, residual unit strengths.

6. **Unit visualization** — a new PIXI layer (`unitContainer`) draws one
   small circle per unit at its province's centroid, colored by owner's
   mapcolor13. Count badge if multiple units stacked.

## Data model changes

- `Province` adjacency lives in a SEPARATE bundled JSON (`province-adjacency.json`),
  not in `World`. World stays compact; adjacency is content data, not state.
- `Unit` already has the fields we need. No schema changes.
- `Nation.build_queue` stays unused for this plan — production is immediate.
  Future plan will turn it into a multi-turn queue.

## New engine functions

```rust
// engine/combat.rs
pub fn resolve_movement(
    world: &mut World,
    unit_id: UnitId,
    target_province: ProvinceId,
    adjacency: &AdjacencyGraph,
) -> MovementOutcome
```

`MovementOutcome` enum: `Moved`, `BattleWonConquered`, `BattleWon`,
`Stalemate`, `BattleLost`, `Invalid(reason)`.

```rust
// engine/production.rs
pub struct ProductionRequest { unit_type, count, location: Option<ProvinceId> }
pub struct ProductionOutcome { spawned: Vec<UnitId>, narrative: String, capacity_used: u32 }
pub fn apply_production(world: &mut World, nation: NationId, plan: Vec<ProductionRequest>) -> ProductionOutcome
```

## New Tauri commands

- `request_production_cmd(provider, model, world, player_text) -> ProductionResult`
- `move_unit_cmd(world, unit, target) -> MoveResult` (deterministic; engine-only,
  no LLM)

Movement also flows through the existing validator if the player types
"march my armies from Berlin to Warsaw" — the validator emits MoveUnit
actions, the engine resolves them.

## Frontend

- New **ProductionPanel** sibling of ActionPanel, bottom-right. Tabbed UI:
  "Diplomacy" (existing ActionPanel) | "Production" (new). Player types
  what they want to build; LLM produces narrative + actual builds; engine
  applies.
- Map: unit dots shown on map. Click a unit dot → select. Click a
  destination province → move command (validated via engine, not LLM).
- TurnSummaryModal already has "world events" — battles show up there as
  Event entries.

## Verification

- Adjacency: random sample of 20 known-adjacent province pairs (e.g.
  Poland-Germany, Texas-Oklahoma) confirm they're in each other's
  adjacency list.
- Movement: spawn unit, move, assert position changed.
- Combat: spawn attacker > defender, assert decisive-win outcome
  + conquest.
- Combat: spawn attacker < defender, assert repulse + defender retains
  province.
- Smoke: full build + 50/50 tests, manual play.

## Out of scope (deferred to Plan 07+)

- Multi-turn build queues, production templates
- Air + naval
- Supply system, supply lines, ports
- Combat width, divisions vs brigades
- Frontline visualization (drawn arcs on map)
- Tech research progression
