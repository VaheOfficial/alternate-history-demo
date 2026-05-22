# Plan 05 — Living World (AI Nations + Per-Country Turn Summaries)

**Goal:** Turn the world from a static map (only the player acts) into a
living simulation where nations pursue their own goals and react to each
other. Each End Turn now produces a turn summary spanning every nation that
acted, not just the player.

## Core design decisions

1. **The LLM picks who acts.** No static rotation, no hardcoded "key nations".
   A single orchestrator call asks the model which nations would plausibly act
   in the time window, given world state + recent events. Returns 3–6 ISOs.

2. **Each nation has its own goals.** `Nation.goals: Vec<String>` — short
   text directives ("regain Crimea", "modernize the navy", "stabilize the
   south"). Seeded with static defaults for ~40 major nations at scenario
   start; generic "preserve stability and trade" for the long tail. Goals
   evolve organically when a nation acts and updates them.

3. **Per-nation actor calls are independent.** Each picked nation gets its
   own LLM call, given ONLY its own context: own goals, own relations,
   recent events visible to it. The LLM is never told "the player is X" —
   NPC nations act in their own self-interest, not in reaction to the
   player by design.

4. **Cap LLM cost.** 3–6 acting nations per turn × 1 call each + 1 orchestrator
   = 4–7 LLM calls per End Turn. With Ollama this is seconds; with cloud
   providers it's tolerable.

5. **Player vs NPC turn parity.** Player still uses ActionPanel for their
   moves during a turn. End Turn then runs the NPC turn. Turn summary shows
   *every* nation that did something — player included if they took
   actions.

## Data model

```rust
// world/nation.rs
pub struct Nation {
    // ... existing fields ...
    #[serde(default)]
    pub goals: Vec<String>,
}
```

```rust
// engine/npc_turn.rs (new)
pub struct NpcTurnResult {
    pub orchestrator_picks: Vec<OrchestratorPick>,
    pub nation_turns: Vec<NationTurn>,
    pub world: World,
}

pub struct OrchestratorPick {
    pub iso: String,
    pub reason: String,
}

pub struct NationTurn {
    pub iso: String,
    pub narrative: String,
    pub applied: Vec<TypedAction>,
    pub failures: Vec<String>,
    pub goal_update: Option<Vec<String>>,
}
```

## Tauri command

```rust
#[tauri::command]
pub async fn run_npc_turn_cmd(
    state: State<'_, AppState>,
    provider_id: Uuid,
    model: String,
    world: World,
    days: i64,
) -> Result<NpcTurnResult>
```

Note: `end_turn_cmd` keeps doing clock + economy. NPC turn is a separate
command the UI calls right after — that way the user sees economy advance
even if their LLM is unavailable or slow.

## Frontend

- After End Turn:
  1. Call `endTurn(world, days)` → get new world (clock + economy moved).
  2. Compute economy delta (treasury, manpower, stability) for player nation.
  3. Call `runNpcTurn(provider, model, newWorld, days)` → get NpcTurnResult.
  4. Open a TurnSummaryModal with:
     - "Your turn" section: economy delta + any actions the PLAYER took this
       turn (from events emitted by validator calls).
     - "World events" section: one card per acting nation. Flag swatch,
       name, narrative, bullet list of applied actions, optional goal-update
       chip.
     - Dismiss button.
- If NPC turn fails (provider down), still show economy delta + a warning,
  don't block the player.

## Verification

- Goal-seed test: scenario seeder produces ≥30 nations with non-empty goals.
- Goal-mutation test: applying a NationTurn with `goal_update` overwrites
  goals on that nation.
- Smoke test (manual, with LLM): End Turn produces a summary with at least
  one NPC action; the same nation appears in two consecutive turns iff its
  goals describe ongoing tension.

## Out of scope (deferred to Plan 06+)

- Combat (Tier 2)
- UX polish (Tier 3)
- Group diplomacy / multi-nation chats
- World event generator (random crises)
