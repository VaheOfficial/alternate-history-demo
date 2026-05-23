# Plan 10 — Battle Plans (HOI4-style group select + arrows)

**Status:** In progress
**Builds on:** Plan 06 (Combat MVP), Plan 09 (Fog of War), the shift+click
move primitive added post-Plan-08.

## Why

The user has been asking for this since the first round of unit-control
testing:

> "I want a control like in hoi4 where i can select troops assign them to
> border/s and draw a capture style arrow so they can begin planning."

The current shift+click flow moves one selected province's units to ONE
adjacent province in a single click. That's the minimum viable control;
HOI4's battle-plan UX is much richer:

- Select multiple unit stacks at once.
- Draw an arrow from selected sources to a single target province.
- The arrow persists on the map as your strategic intent.
- Execute the plan and the engine moves the units toward the target
  (multi-hop, in v1 of HOI4 this happens over multiple in-game days).

We're scoping the v1 to the smallest version of that loop that feels like
the right thing.

## What "battle plan" means in this MVP

A **BattlePlan** is a server-side object with:

- `id` — uuid.
- `owner` — `NationId` of the player who issued it (only the player creates
  plans in v1; NPC nations don't use this surface).
- `target` — `ProvinceId` of the destination province.
- `sources: Vec<ProvinceId>` — provinces whose units participate.
- `status` — `Planned` | `Executed` | `Cancelled`.
- `created_on` — `NaiveDate`.

Plans are stored in `world.battle_plans: Vec<BattlePlan>` with
`#[serde(default)]` so old save files still load.

## Player flow

1. **Multi-select sources.** Shift-click on a friendly province with units
   adds it to the selection. Repeated shift-clicks add more provinces.
   Plain click (no shift) clears the selection.
2. **Set target.** While the selection is non-empty, right-click any other
   province on the map → that creates a `BattlePlan { owner, target,
   sources, status: Planned }` and clears the in-progress selection.
3. **Visual feedback.** Each planned arrow renders on the map as a yellow
   polyline from the source centroid(s) to the target centroid. The arrow
   stays on the map until the plan is executed or cancelled.
4. **Manage plans.** A new "Plans" tab in the command dock lists every
   active `BattlePlan` with:
   - Source province names + count of divisions in them.
   - Target province name.
   - Execute button — calls `execute_battle_plan_cmd` which moves every
     unit from every source toward the target, hop-by-hop along the
     adjacency graph. Same engine rules apply (peacetime guard, etc).
   - Cancel button — sets status to Cancelled and drops it from the
     active list.
5. **End-turn integration.** End turn does NOT auto-execute plans in v1.
   The player explicitly executes. (HOI4 auto-executes; doing that here
   needs a careful pacing model and the user keeps asking for player
   agency — so explicit-only.)

## Server-side execution

`execute_battle_plan_cmd(plan_id, adjacency)`:

1. Look up the plan, ensure status == Planned.
2. For each source province in the plan, gather every unit owned by the
   player (the plan's owner) currently stationed there.
3. For each such unit, compute one hop toward the target using a BFS over
   the adjacency graph. Move via `resolve_movement` (which already enforces
   peacetime + same-owner transit + combat).
4. Set status to Executed and stamp a timestamp.

The plan does NOT auto-repeat hops over multiple turns in v1 — one
execute = one hop closer. The player can re-execute the plan each turn
to march further. (Multi-turn auto-advance is its own iteration.)

## Visual layer

A new `planArrowsLayer` container in the PIXI scene, sitting on the
**stage** (not inside mapContainer) so the lines stay at constant screen
width as the player zooms, same pattern as the highlight outline.

Per arrow:
- Color: a warm yellow (`#f5d76e`) — matches the selected-country
  highlight palette so the UI feels coherent.
- Width: 2.5 screen-px at zoom 1, scales down 1/zoom.
- Path: straight polyline from each source centroid to the target
  centroid (one polyline per source).
- Arrowhead: small filled triangle at the target end.

## What's out of scope

- **Multi-turn auto-march.** Plans don't tick toward the target on
  end_turn. Each execute = one hop.
- **Rubber-band drag selection.** Multi-select is shift-click only.
- **Right-click-and-drag arrow preview.** Setting the target is a single
  right-click; we don't draw a live arrow during a drag.
- **NPC battle plans.** Only the player creates plans. The NPC AI still
  uses immediate `MoveUnit` actions via apply_actions.
- **Plan templates / army groups / generals.** All future.
- **Fog of war applied to enemy battle plans.** Plans are the player's
  own, so they're always visible.

## Files

New:
- `src-tauri/src/world/battle_plan.rs`
- `src/components/Game/BattlePlansPanel.tsx`

Modified:
- `src-tauri/src/world/world.rs` — battle_plans field.
- `src-tauri/src/world/mod.rs` — register module.
- `src-tauri/src/commands/game.rs` — new commands.
- `src-tauri/src/lib.rs` — register commands.
- `src/lib/game/types.ts` — `BattlePlan` interface.
- `src/lib/game/tauri.ts` — `createBattlePlan`, `executeBattlePlan`,
  `cancelBattlePlan` bindings.
- `src/components/Map/WorldMap.tsx` — right-click handler, plan arrows
  prop.
- `src/components/Game/GameSession.tsx` — multi-source selection state,
  plan creation flow, wire the plans panel.
- `src/components/Game/CommandDock.tsx` — add "Plans" tab.
- `src/lib/map/pixi-renderer.ts` — `PlanArrowsLayer` + `buildPlanArrows`
  + `updatePlanArrows`.

## Done criteria

1. Shift-click multiple friendly provinces → all selected, banner shows
   total selected divisions.
2. Right-click on a target → battle plan appears on the map as a yellow
   arrow, selection clears.
3. Plans tab lists the plan with Execute + Cancel.
4. Execute moves the units one hop toward the target (peacetime guard
   still applies — same as the shift+click path).
5. Cancel drops the arrow + the plan.
6. Plans survive a save/load round-trip (no schema break for old saves).
7. `cargo test --lib` + `pnpm tsc --noEmit` + `pnpm build` all clean.
