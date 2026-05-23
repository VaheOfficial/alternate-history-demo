# Plan 12 — Gameplay Depth & HOI4-Style Screen System

**Status:** In progress — meta-plan, executed in phases.

## Why

Plans 09–11 added important infra (fog, battle plans, diplomacy), but the
game loop is still thin: wars drift forever with no goal or peace deal,
nothing reactive happens between your turns, every nation's internal state
is a stat block with no factions or pressures, production is single-turn
spam, espionage doesn't exist, and there are no win conditions.

The user's explicit direction:

> "Plan to implement everything from the list and also figure out a way to
> properly convey all of these without being pushy and being like in the
> orders panel writing. So you gotta do x then gotta do y. Just natural
> through visuals not directly through text."

> "There is no win condition, pretty much either taking over the world or
> whatever user decides when they are done with the game."

So this plan has TWO halves:

1. **Game systems** — six mechanics that turn the world into something
   reactive and end-conditioned: war goals + peace, crises + frontlines,
   factions, production + tech, espionage, win conditions.
2. **Discovery surface** — a HOI4-style top ribbon of dedicated screens
   that surface each system. Notification badges, illustrated empty
   states, and on-map cues do the teaching — never an "instructions
   panel" telling the player what to do next.

## Discovery surface — the visual layer

HOI4's solution: a top ribbon (or side strip — we already have one) with
one icon per system. Click → dedicated full-screen-ish overlay panel.
The current map remains the canvas; everything else is a screen.

### Rules for surfacing capabilities

These rules make the system teach itself without writing tutorials.

1. **One screen per system.** Politics, Research, Production, War,
   Crises, Intelligence, Diplomacy (existing). The left dock strip
   gains these icons in addition to Orders/Advisor/Saves/History.
2. **Notification badges.** A screen icon shows a colored dot + count
   when something there needs attention: a pending decision (Crises),
   a free build slot (Production), a finished research project, an
   intel report. Red = required; amber = optional payoff; blue =
   informational.
3. **Empty states that explain themselves.** Each screen has a clear
   empty-state illustration + one-sentence purpose line. Example for
   Politics when no factions exist yet: a silhouette icon + "Your
   nation's internal coalitions. Decisions here affect stability."
   No "click here next" prose.
4. **On-map cues for live events.** Crises pulse over the affected
   nation's capital. Active wars show frontline strength bars.
   Espionage missions in flight show a small spy icon over the
   target capital.
5. **Soft onboarding via badges, not modals.** A new game opens to the
   map with the screen ribbon visible. The Politics, Research, and
   Production icons each carry an amber "?" dot for the first turn,
   inviting exploration without a tutorial popup.
6. **Tooltips on hover.** Hovering any screen icon shows a single-line
   tooltip. Hovering any value (e.g. faction power bar) shows what
   moves it.
7. **Diegetic phrasing.** UI text is always in-world ("The Generals are
   restless", "Tech: armored doctrine 60%", "Casus belli accepted"),
   never meta ("you should consider…").

### Left dock strip — final tab list

After this plan lands, the strip ordering is:

1. Orders (existing)
2. Advisor (existing)
3. Diplomacy (existing)
4. Plans (existing — battle plans)
5. **Politics** (NEW — factions, internal pressure, government)
6. **Research** (NEW — tech tree)
7. **Production** (NEW — multi-turn build queue)
8. **War** (NEW — active wars, casus belli, peace proposals)
9. **Crises** (NEW — pending decisions; auto-highlights with red dot)
10. **Intelligence** (NEW — spy ops + intel reports)
11. Saves (existing)
12. History (existing)

That's 12 tabs. The strip becomes scrollable vertically if needed.

## Phases

Each phase is a separately committable chunk that builds on what's there.
The order is chosen so each phase delivers something playable and the
later phases plug into the surface built earlier.

### Phase 0 — Screen shell + badge framework

- Add 6 new dock-strip icons (Politics, Research, Production, War,
  Crises, Intelligence) with empty placeholder panels.
- Build a generic `<NotificationBadge count, level>` component reusable
  by every tab.
- Add a `screen_badges` helper that computes the badge state for each
  screen from the current `World` (e.g. crises.count.unresolved → red).
- Add per-screen empty-state component that takes an icon, title,
  one-line description.
- Files: `src/components/Game/screens/` directory with one component
  per screen, all stubbed. CommandDock gains the new tabs. New
  `src/lib/game/badges.ts`.
- Done when: clicking any new icon opens an empty state with a clear
  description and the badge framework is wired to render dots even if
  no real producer exists yet.

### Phase 1 — War goals + peace + War screen

Game:
- `world::war.rs` (NEW) — `War { id, aggressor, defender(s),
  declared_on, casus_belli, war_goals[], occupation_pct, status }`
- `CasusBelli` enum: AnnexProvinces, InstallPuppet, ForceConcession,
  Demilitarize, HumiliateRival, FreeNation.
- `engine::war.rs` — at every `tick_pending` plus after every battle
  resolution, recompute occupation_pct (provinces controlled by
  aggressor / total target provinces) and check if peace is plausible:
  once occupation crosses 30%, the LOSER may auto-propose a partial
  deal; at 60% the LOSER is forced to consider an annexation deal;
  100% = forced surrender.
- `declare_war` validator action gains an optional `casus_belli` field
  (LLM may include it; UI form lets player pick). Missing CB defaults
  to HumiliateRival.
- Peace deals route through a NEW DiplomaticChannel automatically
  spawned between the warring nations — proposals are real
  `proposed_actions[]` the player can Enact (sign_treaty +
  transfer_territory + modify_relation).

UI:
- War screen lists active wars as cards: flags of participants,
  casus_belli badge, occupation % bar, war_goal progress chips,
  "Open peace channel" button.
- Badge: red if a peace proposal is waiting for the player to enact;
  amber if a war is at >50% occupation (decision moment).

Done when: a player who declares war picks a CB; combat changes the
occupation %; at threshold a peace proposal appears in Diplomacy with
ready-to-enact actions; the War screen shows live state.

### Phase 2 — Crises + frontlines + Crises screen

Game:
- `world::crisis.rs` already has `Crisis` struct — wire it up.
- New `engine::crises.rs` produces Crises from triggers:
  - Pending-op completion that affects the player ("Mobilization
    finished") → low-urgency crisis card with optional follow-up
    actions.
  - NPC turn output: when an NPC's modify_relation toward the
    player drops below -50, spawn a "Diplomatic incident with X"
    crisis.
  - Random event sampler: low-frequency global events
    ("Earthquake in Indonesia", "Oil price shock") chosen with a
    seeded RNG once per end-turn.
- Each crisis has `decision_options: Vec<{label, narrative,
  actions[]}>` and a `deadline_round`. Past the deadline the default
  option (option 0) auto-applies and an Event is stamped.
- Frontlines: existing `Frontline` struct gets populated by
  `engine::war.rs` for active wars (provinces on the border between
  aggressor and defender, marked with combined unit strength on each
  side).

UI:
- Crises screen as a stack of decision cards with option buttons.
- Map: each crisis pulses a yellow ring over its origin nation's
  capital province; clicking jumps to the Crises screen.
- Frontline polylines drawn on the map using the new PIXI layer
  pattern (same as PlanArrows). Color by occupation pressure: red
  for the side losing ground, blue for holding.

Done when: at least one crisis appears within the first 3 end-turns;
each has 2-3 options that mutate the world; frontlines render on
active wars; badge counter on the Crises icon equals the number of
undecided crises.

### Phase 3 — Internal politics + factions + Politics screen

Game:
- `world::faction.rs` (NEW) — `Faction { id, name, archetype, power,
  satisfaction }`.
- Archetypes: Military, Business, Religious, Populist, Intellectual.
  Each nation seeded with 3-5 archetypes at scenario seed time based
  on government type (e.g. a Theocracy gets Religious + Military + 1
  other; a Democracy gets Business + Intellectual + Populist +
  Military).
- `Nation` gains `factions: Vec<Faction>`.
- Faction satisfaction is moved by actions: declaring war pleases
  Military, raises Business unrest; signing trade agreement pleases
  Business; ChangeGovernment heavily moves Religious/Populist.
- `engine::economy::run_economy_tick` adds a faction-pressure pass:
  if any faction's satisfaction < 20 for 3 consecutive ticks, it
  produces a Crisis ("Generals demand a war with X", "Business
  demands tax cut"). Decline ignored, the faction's power swings
  toward a coup attempt — at satisfaction 0 + power > 50 the
  faction triggers a `crisis::Coup` decision.

UI:
- Politics screen: 3-5 faction cards per the player's nation. Each
  card has an archetype icon, satisfaction bar (0-100, color-coded),
  power bar, and a 1-line "what makes them happier" hint.
- Government type swatch at the top.
- Badge: amber when any faction satisfaction < 30, red when < 10.

Done when: every nation's factions are visible on the Politics
screen; declaring war moves Military satisfaction up; signing a
treaty moves Business up; at low satisfaction a Crisis spawns.

### Phase 4 — Production queue + tech research + screens

Game:
- `world::production.rs` (NEW) — `BuildOrder { id, kind, location,
  total_cost (ic+treasury+manpower), accrued, completes_on }`. Each
  nation gets a `build_queue: Vec<BuildOrder>`. End-turn ticks accrue
  industry-points toward each active order proportional to remaining
  IC after maintenance. Completed orders spawn the unit / building.
- Build slots per nation = `industry_capacity / 5` (cap 10). Once
  slots are full, additional orders queue but don't accrue until a
  slot frees.
- `world::tech.rs` (NEW) — `Tech { id, name, prereqs, effects[],
  research_cost }` and `Nation.tech_progress: HashMap<TechId, u32>`.
- Six v1 techs: ImprovedInfantry, MechanizedDoctrine, ArmoredWarfare,
  AirSuperiorityBasics (no real combat impact yet, future-proofing),
  Encryption (intel bonus), AdvancedLogistics (supply bonus).
- Research speed = nation.industry_capacity / 10 per tick; once a
  tech reaches research_cost it becomes an effect on the nation.

UI:
- Production screen: build queue list with progress bars; "Add build"
  opens a small form (unit type, location, target count). Pending
  rows show ETA.
- Research screen: small tech tree of 6 nodes connected by prereq
  arrows; clicking a node sets it as the current research project;
  progress bar at the bottom.
- Badge: amber on Production when a build slot is free; amber on
  Research when no project is selected.

Done when: queueing 10 infantry takes 3-5 turns to complete; setting
ArmoredWarfare → ImprovedInfantry chain takes ~10 turns; built units
appear at the requested location.

### Phase 5 — Espionage + Intelligence screen

Game:
- `world::spy.rs` (NEW) — `SpyAgency { nation_id,
  active_missions: Vec<SpyMission>, network_strength_by_nation:
  HashMap<NationId, u32> }`.
- `SpyMission { id, target_nation, kind, days_remaining, success_pct
  }`. Kinds: StealTech, SabotageIndustry, FundCoup, Assassinate,
  GatherIntel.
- Resolution at end-turn: dice vs success_pct, outcomes mutate the
  target nation (StealTech → +50 tech progress; SabotageIndustry →
  -5 IC for 30 days via pending op; FundCoup → spawn Coup crisis
  in target; Assassinate → AssassinateNpc action; GatherIntel →
  widens fog of war over target for 30 days).
- Counter-intel: target_nation's network_strength reduces incoming
  success_pct.

UI:
- Intelligence screen: 3 sections — Active missions, Recent reports
  (intel gathered or sabotage outcomes), Network strength per
  foreign power. "New mission" form picks kind + target.
- Map: small spy-glass icon over capitals where a mission is in
  flight (player's missions in blue, suspected hostile missions in
  red — based on counter-intel detection).
- Badge: red when a hostile mission targeting the player resolves
  successfully (intel breach); amber when a player mission completes.

Done when: player can run a StealTech mission against China and it
either succeeds (tech progress jumps) or fails (network strength
hit) within ~5 turns; intel reports show up; the Intelligence screen
lists everything cleanly.

### Phase 6 — Win conditions + Conclude run

Per the user's spec: world conquest OR player-declares-done.

Game:
- `engine::victory.rs` (NEW) — after each end-turn, check:
  - **World conquest:** player's nation controls > 60% of world
    population AND > 60% of world industry → "Hegemon" victory.
  - **Last empire standing:** all other nations with population
    > 10M either vassalized (treaty kind=Vassalage with player
    as senior) or annexed → "Universal Empire" victory.
  - **Survival:** game date >= 2050-01-01 → "Survivor" outcome
    (not a victory per se, but ends cleanly).
- When any condition fires, `world.victory: Option<Victory>` is
  set with kind + headline.
- Player can press "Conclude run" at any time → manual exit (no
  victory kind, just `Concluded`).
- Once `world.victory.is_some()`, the End Turn button is replaced
  with "Show Chronicle" (placeholder for Plan 15) — and a banner
  appears explaining the outcome.

UI:
- HudTopBar shows a small victory-progress chip:
  `pop X% / ind Y% — toward Hegemon`.
- When a victory triggers, a full-screen modal (TurnSummaryModal
  pattern) appears with the headline + outcome summary.
- "Conclude run" lives in the Menu (top-left dropdown) under
  "Concede this run".

Done when: a player whose USA owns 65% of population + industry sees
the victory modal at end-turn; concede from the menu sets
`world.victory = Concluded` and ends the run.

## File map (delta to land all 6 phases)

New Rust modules:
- `src-tauri/src/world/war.rs`
- `src-tauri/src/world/faction.rs`
- `src-tauri/src/world/production.rs`
- `src-tauri/src/world/tech.rs`
- `src-tauri/src/world/spy.rs`
- `src-tauri/src/world/victory.rs`
- `src-tauri/src/engine/war.rs`
- `src-tauri/src/engine/crises.rs`
- `src-tauri/src/engine/victory.rs`

Modified Rust:
- `src-tauri/src/world/world.rs` — new fields per phase.
- `src-tauri/src/world/scenario.rs` — seed factions per nation.
- `src-tauri/src/world/action.rs` — `casus_belli` on DeclareWar,
  new actions for queue add / research / spy mission.
- `src-tauri/src/engine/economy.rs` — faction pressure pass,
  production tick.
- `src-tauri/src/engine/pending.rs` — spawn crises on completion.
- `src-tauri/src/commands/game.rs` — Tauri commands per phase.
- `src-tauri/src/lib.rs` — register new commands.

New frontend screens (`src/components/Game/screens/`):
- `PoliticsScreen.tsx`
- `ResearchScreen.tsx`
- `ProductionScreen.tsx`
- `WarScreen.tsx`
- `CrisesScreen.tsx`
- `IntelligenceScreen.tsx`

Shared components:
- `src/components/ui/NotificationBadge.tsx`
- `src/components/ui/EmptyState.tsx`
- `src/components/ui/ProgressBar.tsx`

Map cues:
- `src/lib/map/pixi-renderer.ts` — new layers for crisis pulses,
  frontline polylines, spy icons.

Engine + UI hook:
- `src/lib/game/badges.ts` — derives per-screen badge state from
  the World.
- `src/components/Game/CommandDock.tsx` — accept badge spec per tab.

## Verification

After each phase:
- `cargo test --lib` passes.
- `pnpm tsc --noEmit` clean.
- `pnpm build` clean.
- Playable smoke test: load a save, exercise the phase's new
  capability via the new screen, see visible effects on map / HUD.

After Phase 6: full new game runs to a victory condition.

## Out of scope for this plan

- Endgame chronicle generation (Plan 15 — generates the wiki article
  *after* a victory triggers).
- Event Consolidator + RAG (Plan 14 in the new numbering — long-term
  memory for the LLM).
- Cost/latency footer (Plan 16).
- Air units, naval combat (cut in v1 design).

## Execution order

I'll land each phase as its own commit:

1. Phase 0 — screen shell + badges (lays the surface).
2. Phase 6 — win conditions (small, gives the game a goal immediately).
3. Phase 1 — war goals + peace.
4. Phase 2 — crises + frontlines.
5. Phase 3 — factions.
6. Phase 4 — production + tech.
7. Phase 5 — espionage.

(Phase 6 is small and reorder-able; landing it after 0 means every
subsequent phase already has a "go toward winning" frame.)
