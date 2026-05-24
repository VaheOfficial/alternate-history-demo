# Plan 13 — War System Rework, Battle Plan Queuing, AI Tool-Use, and Polish

**Status:** Not started — backlog from Plan 12 test-pass feedback.

## Why

Plan 12 shipped the gameplay surface (war goals, crises, factions,
production, tech, espionage, win conditions) but real testing surfaced
a class of issues that need a focused follow-up plan rather than
incremental patches:

1. **War system feels thin.** No visual frontline, no DummyNation-style
   expanding tint as troops sweep through, peace proposals don't show
   the actual terms in human language, occupation% updates one turn
   late on big pushes.
2. **AI doesn't know what it CAN do.** NPCs don't pre-emptively move
   troops when threatened because nothing in their prompt tells them
   that "move troops to border" is even an action they have. Player's
   natural-language battle plans don't translate into real movement
   either.
3. **Battle plans execute immediately.** Defender has no chance to
   react before the player marches across the border in real time —
   the engine processes the entire plan in one click, then the NPC
   turn fires AFTER.
4. **Map labels are static.** Canada's name floats over US territory
   after annexation; capital labels don't follow conquest.
5. **Custom unit naming.** Player wants to create corporate / militia
   forces with player-chosen names ("Blackwater Brigade") and have
   them respect normal unit rules.
6. **More granular control.** Split divisions, combine stacks, set
   waypoint paths instead of one-hop-at-a-time.
7. **AI tool-passing.** Instead of a giant system-prompt JSON schema,
   the LLM should get a real tool-call surface (functions it can call
   each turn) so it knows declaratively what's possible.
8. **Advisor → Orders linkage.** When the player Enacts an advisor
   suggestion, the response should land in the Orders tab thread for
   visibility.
9. **Scrolling missing on long panels** (History, Saves drawer,
   sometimes Politics).

## Scope (phases)

### Phase A — Map labels follow ownership
- Country label position is currently from `countries.json` (built at
  pipeline time). Rewrite to compute the visual center each render
  from the current set of owned provinces (centroid of the largest
  contiguous owned island).
- Capital marker should likewise follow the largest-pop owned
  province after the original capital is lost.

### Phase B — Battle plans queue with end-turn
- `execute_battle_plan_cmd` becomes `queue_battle_plan_execution_cmd`
  → flag the plan as "execute_on_next_turn" instead of running
  movement immediately.
- `tick_battle_plans` inside `end_turn_cmd` runs the one-hop march
  for every queued plan. NPC turn now happens IN PARALLEL with the
  player's plan execution, so the defender's reactions land in the
  same turn summary.
- Repeat-execute: setting "auto-repeat" on a plan means it ticks one
  hop per turn until it reaches the target.

### Phase C — Live frontlines + DummyNation-style expansion overlay
- New PIXI layer `frontline_layer` rendered between fills and units.
- For each active war, build the contact-line between aggressor and
  defender provinces (already have the data via adjacency + ownership).
- Render the line as a thick gradient stroke colored by relative
  strength (red = defender holding, blue = attacker pushing).
- DummyNation-style expansion: when a province flips, animate a brief
  color-sweep from the aggressor's nearest controlled province across
  the newly-acquired province. A 600ms tween, no permanent overlay.

### Phase D — Peace proposal terms surfaced
- Peace proposal cards in WarScreen already exist but the narrative
  is generic ("casus belli satisfied"). Expand the narrative builder
  in `engine::war::build_peace_proposal` to list each typed action
  in plain English ("Canada cedes Yukon and British Columbia",
  "Relations restored to 0", "60-year non-aggression clause").

### Phase E — AI tool-calling
- Replace the current system-prompt-with-action-schema with a real
  tool-call surface. Each typed action becomes a tool; the LLM emits
  tool_calls and the engine wraps them as ToolResult messages so the
  LLM can see outcomes and refine.
- This unlocks NPCs declaring war preemptively, moving troops to
  borders when threatened, etc. — they can SEE the moves available.
- Per-provider implementation: OpenAI / Anthropic have native tool
  use; Ollama gets a JSON-schema fallback (existing path).
- Significant lift — touches `providers::*`, `engine::npc_turn`,
  validator, all four LLM call sites.

### Phase F — Custom-named unit groups
- New `world::unit_group.rs` with `UnitGroup { id, owner, name, color,
  units: Vec<UnitId> }`. Player creates groups via a new "Forces"
  screen.
- Renderer tints group circles by `group.color` so "Blackwater
  Brigade" looks visually distinct.
- Validator-emitted unit actions can target a group by name.

### Phase G — Granular unit control
- "Split stack" and "Combine stacks" actions on the unit popover.
- Waypoint paths via shift-click chain: each shift-click on a
  province after the source adds a stop; right-click finalizes the
  path. Execute on end-turn (Phase B).

### Phase H — UI polish
- Advisor "Enact" pipes the result into the Orders thread for
  visibility (lift threads into a shared context).
- Scroll on History, Saves drawer, Politics overflow.
- Truncation: advisor cards currently cut off mid-sentence. Make the
  card height auto + show a "Read more" toggle for long narratives.
- Spy success report on map: small pulsing marker over the target
  capital when a recent successful op is < 7 days old.

## Out of scope (deferred again)

- Civil wars / coups as a real consequence loop (factions exist;
  triggering a full civil war is Plan 14+).
- Air units, naval combat (still cut in v1 design).
- Multi-language LLM support.

## Execution order

A → B → D → C → E → F → G → H. A/B/D first because they hit the
worst test-pass complaints in the smallest changes.
