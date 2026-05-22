# Plan 04 — Game-loop foundations

**Goal:** Move from "tech demo with a pretty map" to "you can boot a modern-day
scenario, see the world, click around, advance time, and issue actions vetted by
the LLM." This is the gate to "is this actually a game?"

## Scope

In order of execution:

### Phase A — Map & UI shell (no LLM, immediate user value)

1. **Country data extraction**: extend the map build pipeline to grab Natural
   Earth `ne_10m_admin_0_countries`. Emit `public/countries.json` with one
   entry per country: ISO3 code, common name, label-anchor lon/lat,
   bbox, mapcolor13. This gives us names + a stable label position per
   country.

2. **Modern-day scenario seeder** (Rust, in `world::scenario` module):
   `build_modern_world(date)` constructs a `World` whose provinces are
   keyed by Natural Earth `shape_id`, owned by the `Nation` whose `iso_a3`
   matches `iso_country`. Default tech 5, GovernmentType picked from a
   small ISO3 → government table (~30 entries; everything else defaults
   to Democracy). One nation per Natural Earth ISO3 code that has at
   least one province.

3. **Tauri commands** to bootstrap a "Modern Day" save:
   `create_modern_day_save(name)` — calls the seeder, persists save +
   initial snapshot. Returns `(SaveId, BranchId, World)`.

4. **Country name labels on the map**: layer above provinces, below
   cities. Visible at zoom ≥ 2.2, fade in over 2.2 → 3. Uppercase
   tracked text, centered on the country's label anchor; larger
   countries get larger text. Hidden when a city label would collide.

5. **Map overlay from scenario ownership**: drop the random `mapcolor13`
   demo color and drive fills from the `World.provinces[].owner` →
   `Nation.id` → `Nation.mapcolor` chain.

6. **Province hover (HOI4-style)**: thin floating panel that follows the
   cursor while hovering a province. Shows: province name, owner flag-ish
   color swatch + name, terrain, population, base industry, resources.

7. **Province click → country drawer**: clicking any province opens a
   side drawer showing the **country** that owns it (NOT the province).
   Country panel shows: name, government, treasury, GDP, population,
   manpower, stability/war-support, industry split, doctrine, top
   provinces by population.

8. **Landing page**: replace the direct-into-Settings entry with a home
   screen. Card layout: "New Modern Day Game" (primary), "Continue"
   (lists saves), "Settings", "About". Tab bar moves to a sidebar /
   appears only inside a session.

### Phase B — Turn ticker (engine-only)

9. **Clock UI**: top bar with date, round number, time-increment
   selector (1w / 1m / 3m / 6m / 1y), and an "End turn" primary button.
   Pressing it advances `World.clock` and saves a snapshot.

10. **Auto-advance pacing hook** (preparation for Phase C): the turn-end
    callback consults a `pace_hint: Option<TimeIncrement>` field. If set,
    use it; otherwise fall back to the user-selected increment. LLM
    fills this in Phase C.

### Phase C — Action validator (LLM-backed)

11. **Action input UI**: free-text input "What would you like to do?"
    inside the country drawer. Submit goes to LLM.

12. **LLM validator**: prompt produces a JSON envelope:
    `{ accepted: bool, narrative: string, actions: TypedAction[], next_tick_days?: u32 }`.
    Accepted actions are applied through a `engine::apply_actions(world, actions)`
    function. Rejected → narrative shown to user, no state change.

### Phase D — Save / load UI

13. **Save management drawer**: list saves, switch branches, load
    snapshots, delete. Hooks into the existing Tauri save commands.

## Out of scope (deferred to Plan 05+)

- Combat resolution
- Frontline movement
- Economy ticks (production, supply, treasury changes per turn)
- AI subsystems beyond the action validator
- Multi-language support
- Performance profiling on giant world states

## Verification (per phase)

- **A**: `pnpm build` clean, `cargo build` clean, manual smoke test on
  landing → new modern-day game → see colored map with country names →
  hover/click works.
- **B**: clock advances, snapshots write, reload restores state.
- **C**: at least one accepted action mutates the world and an
  obviously-bad one is rejected with reasoning.
- **D**: round-trip save → reload of a non-trivial state.
