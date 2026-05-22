# Alternate History Demo — v1 Design

- **Date:** 2026-05-21
- **Status:** Draft (pre-implementation-plan)
- **Author:** Th3Spy (with Claude as design collaborator)
- **Repo:** [VaheOfficial/alternate-history-demo](https://github.com/VaheOfficial/alternate-history-demo)

## 1. Overview

A turn-based, LLM-narrated grand-strategy game with HOI4-flavored military depth and Dummynation-grade map simplicity. Player picks a nation + historical (or contemporary) starting year, then reshapes the world through diplomacy, economic policy, and military action. A deterministic engine owns all mechanics (combat math, resource flow, supply, territory ownership); LLMs own everything narrative (event descriptions, NPC personalities, advisor reasoning, diplomatic dialogue, end-of-game chronicle).

The differentiator vs. the genre reference (Pax Historia): the LLM backend is **fully bring-your-own**. Local-first via Ollama / LM Studio / llama.cpp / others, optional cloud via OpenAI / Anthropic / OpenRouter / etc. There is no token-billing layer between the user and their model.

### Identity (the elevator pitch)

> Pax Historia × HOI4-lite × Dummynation: LLM grand strategy with frontline-based military, doctrines, tech, resources, and a 3,600-province map — but no combat width, no equipment composition, no factories-with-research-trees. The LLM never invents numbers; the engine never invents narrative.

## 2. Goals and non-goals

### Goals (v1)

- A complete, playable game from launch to endgame, single-player only
- Bring-your-own LLM, with auto-detection of local providers on first run
- Deterministic, testable game mechanics: combat, supply, production, resources
- LLM-driven narrative, diplomacy, and emergent events that **react to** mechanical state rather than inventing it
- 4 starting scenarios shipped (1914, 1939, 1962, 2025) plus a "custom year" sandbox bootstrapped by the LLM from a template
- Native desktop installers (Windows MSI, macOS DMG, Linux AppImage) with auto-update
- Save / rewind / branch — full game state snapshots per round, visualized as a tree

### Non-goals (v1)

- Multiplayer (single-player only)
- Mobile platforms
- Custom map / scenario editor (deferred to v1.1)
- Air / naval combat (land only in v1; sea is "transit lanes," air is a future system)
- Combat width, equipment composition, research trees per unit type (single rolled-up tech score per nation in v1)
- Difficulty tiers (one balanced default)
- In-game prompt editor (defaults only; power-user feature deferred)
- Modding system (file-format hooks designed in, but no SDK)

## 3. Architecture overview

```
┌────────────────────────────────────────────────────────────────┐
│                    Tauri 2 desktop app                         │
│                                                                │
│  ┌─────────────────────────┐  ┌──────────────────────────────┐ │
│  │  Frontend (React + Vite)│  │  Backend (Rust)              │ │
│  │                         │◄►│                              │ │
│  │  - Map (canvas/WebGL)   │  │  - Game state (in-mem + SQLite│ │
│  │  - Action box           │  │  - Combat / supply / resource│ │
│  │  - Advisor sidebar      │  │  - LLM provider abstraction  │ │
│  │  - Diplomacy panel      │  │  - Subsystem orchestration   │ │
│  │  - Timeline / branch    │  │  - Persistence + snapshots   │ │
│  │  - Settings / cheats    │  │  - Embedding store (RAG)     │ │
│  └─────────────────────────┘  └──────────────────────────────┘ │
│                                          │                     │
└──────────────────────────────────────────┼─────────────────────┘
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  │                        │                        │
              Local LLM                Cloud LLM             Local embedding
            (Ollama,              (OpenAI, Anthropic,            (sentence-
             LM Studio,            OpenRouter, Groq,             transformers
             llama.cpp,            Mistral, DeepSeek,            via Ollama or
             KoboldCpp, …)         xAI, …)                       cached model)
```

- **Frontend ↔ Backend:** Tauri `invoke` for commands, `Event` channels for streams (LLM token streaming, time-jump progress).
- **Backend ↔ LLMs:** A `Provider` trait in Rust. Concrete impls per provider type. All chat-style providers normalize to an OpenAI-compatible interface internally; non-chat providers (Ollama native API) get bespoke adapters.
- **Persistence:** SQLite (via `sqlx` or `rusqlite`) in the OS-appropriate app data directory. One file per save, plus a global config DB.
- **Map rendering:** GADM-derived topojson, rendered on `<canvas>` via a lightweight 2D pipeline (D3-geo for projection, custom draw loop). WebGL upgrade is a v1.x consideration if perf demands.

## 4. Core game loop

The Decisional Pause model. Time is frozen during the player's turn. On time-jump, the engine + LLMs simulate forward.

```
            ┌──────────────────────────────────┐
            │  Round N: time frozen            │
            │                                  │
            │  Player reads narrated events    │
            │  from prior jump (if any)        │
            │            │                     │
            │            ▼                     │
            │  Player consults Advisor         │ ◄─── any time
            │  (chat sidebar)                  │
            │            │                     │
            │            ▼                     │
            │  Player issues free-text actions │
            │  (Action Box)                    │
            │            │                     │
            │            ▼                     │
            │  Player conducts diplomacy       │
            │  (1-on-1 + group chats)          │
            │            │                     │
            │            ▼                     │
            │  Player draws/edits frontlines   │
            │  and offensives                  │
            │            │                     │
            │            ▼                     │
            │  Player picks time increment     │
            │  (1 week → 1 year)               │
            └────────────┬─────────────────────┘
                         │
                         ▼
                ┌─────────────────────────┐
                │  Time-Jump processing   │
                │  (see §6)               │
                └────────────┬────────────┘
                             │
                             ▼
                       Round N+1
```

### Time-Jump processing pipeline

1. **Action Validation** — for each free-text player action, the *Action Validator* subsystem classifies it (legal, requires elaboration, illegal) and converts to typed action(s).
2. **Player action application** — typed actions applied to world state by the engine (transfer territory only if controlled, declare war if conditions met, etc.).
3. **Combat resolution** — all active frontlines resolve combat per the deterministic resolver (§7), respecting supply, tech, doctrine, terrain, org/strength.
4. **Production tick** — industry produces units per build queue; resources update; manpower replenishes.
5. **Diplomatic AI tick** — *Diplomacy NPCs* (per-nation personas) decide whether to initiate actions toward the player or other nations (treaties, declarations, requests). These also become typed actions.
6. **Commander AI tick** — for any nation with AI-driven military (including all non-player nations), the *Commander AI* subsystem updates frontlines and offensives.
7. **Event generation (multi-pass)** — the *World Event Generator* runs:
   - Pass 1 — propose candidate events from delta of world state
   - Pass 2 — self-critique against state consistency
   - Pass 3 — commit accepted events to log + emit any final typed actions
8. **Event consolidation** — the *Event Consolidator* updates the RAG index, summarizing for retrieval later.
9. **Snapshot** — full world state snapshotted to SQLite, branchable.
10. **Round increment** — game time advances, round counter ++, control returns to player.

Each step has a clear input and output. Each step is testable in isolation. The LLM subsystems run as discrete prompts with typed schemas, not free-form text-in / text-out.

## 5. World state model

The single source of truth, owned by the Rust backend. Serializable to JSON for snapshots and to SQLite for persistence.

### Top-level entities

```rust
struct World {
    clock: GameClock,              // current date, tick rate
    nations: Vec<Nation>,
    provinces: Vec<Province>,
    units: Vec<Unit>,
    npcs: Vec<Npc>,                // named leaders + advisors
    treaties: Vec<Treaty>,
    crises: Vec<Crisis>,
    events: Vec<Event>,            // append-only history log
    frontlines: Vec<Frontline>,
    player_nation: NationId,
}
```

### Nation

```rust
struct Nation {
    id: NationId,
    name: String,
    government: GovernmentType,    // democracy, monarchy, communist, fascist, ...
    leader: NpcId,
    treasury: i64,                 // currency unit (abstract)
    gdp: i64,
    population: i64,
    manpower_pool: i64,
    stability: i32,                // 0-100
    war_support: i32,              // 0-100
    industry_capacity: u32,
    industry_split: IndustrySplit, // (civ, mil) percentage
    resources: ResourceStockpile,  // steel, oil, rubber, tungsten
    tech: TechLevel,               // single rolled-up land tech 1-5
    doctrine: DoctrineId,
    relations: HashMap<NationId, i32>, // -100 to +100
    build_queue: Vec<BuildOrder>,
}
```

### Province

```rust
struct Province {
    id: ProvinceId,
    name: String,
    geometry_ref: GadmId,          // links to topojson polygon
    owner: NationId,
    core_of: Vec<NationId>,        // nations that consider this "core" territory
    terrain: Terrain,              // plains | forest | mountain | urban | desert | river | coastal
    population: i64,
    base_industry: u32,
    base_resources: ResourceYield, // what this province produces
    supply_value: u32,             // contributes to supply network
    is_capital: bool,
    is_supply_hub: bool,
}
```

### Unit

```rust
struct Unit {
    id: UnitId,
    owner: NationId,
    unit_type: UnitType,           // infantry | armor | mechanized | artillery
    location: ProvinceId,
    strength: u32,                 // 0..max_strength, takes permanent damage
    organization: u32,             // 0..max_org, recovers when not in combat
    experience: u32,
    supply_state: SupplyState,
}
```

### NPC

```rust
struct Npc {
    id: NpcId,
    name: String,
    nation: NationId,
    role: NpcRole,                 // leader | advisor | general | foreign_minister
    persona: NpcPersona,           // traits, speech patterns, ideology
    opinion_of_player: i32,        // -100 to +100
    grudges: Vec<Grudge>,          // remembered slights, with date + intensity
    relationships: HashMap<NpcId, i32>,
}
```

### Frontline

```rust
struct Frontline {
    id: FrontlineId,
    owner: NationId,
    enemy: NationId,
    provinces: Vec<ProvinceId>,    // ordered, forming a contiguous border
    assigned_units: Vec<UnitId>,
    offensives: Vec<Offensive>,    // arrows to target provinces
    posture: FrontPosture,         // hold | active | retreat
}
```

### Event

```rust
struct Event {
    id: EventId,
    round: u32,
    timestamp: GameDate,
    category: EventCategory,       // military | diplomatic | economic | political | social
    headline: String,              // <120 chars, for log scrolling
    narrative: String,             // full text, LLM-authored
    typed_actions: Vec<TypedAction>, // mechanical consequences
    visibility: Visibility,        // who sees this event (global, nation-only, hidden)
    embedding: Option<Vec<f32>>,   // for RAG retrieval
}
```

### Typed actions (the LLM ↔ engine contract)

The LLM never edits world state directly. It emits validated typed actions. Engine applies them.

```rust
enum TypedAction {
    DeclareWar { aggressor: NationId, target: NationId, justification: String },
    SignTreaty { parties: Vec<NationId>, kind: TreatyKind, terms: TreatyTerms },
    TransferTerritory { from: NationId, to: NationId, provinces: Vec<ProvinceId>, mechanism: TransferReason },
    ModifyRelation { from: NationId, to: NationId, delta: i32, reason: String },
    SpawnUnit { owner: NationId, unit_type: UnitType, location: ProvinceId, strength: u32 },
    MoveUnit { unit: UnitId, target: ProvinceId },
    ChangeGovernment { nation: NationId, new_form: GovernmentType, mechanism: ChangeReason },
    AssassinateNpc { target: NpcId },
    ModifyResource { nation: NationId, resource: Resource, delta: i64 },
    ModifyStability { nation: NationId, delta: i32 },
    NarrateEvent { headline: String, body: String, category: EventCategory, attached: Vec<Box<TypedAction>> },
    // ... extension point: new action types added without breaking old saves
}
```

Every typed action passes through validation before application: does the actor have the authority, does the precondition hold, does the math make sense?

## 6. AI subsystems

Each subsystem is a distinct prompt with a typed input and a typed output schema. Each can be assigned to a different model in the user's provider settings.

| Subsystem | Input | Output | Notes |
|-----------|-------|--------|-------|
| Action Validator | Free-text player action + relevant world-state slice | `Vec<TypedAction>` OR rejection with reason | Fast; uses cheap/local model by default. |
| World Event Generator | Delta from prior round + active crises + active wars | `Vec<Event>` with typed actions | Multi-pass: propose → critique → commit. The most expensive subsystem. |
| Strategic Advisor | Player query + compact world summary + RAG hits | Free-text response | Chat sidebar. Uses RAG to surface relevant past events. |
| Diplomacy NPC | Player message + NPC persona + relation history | Free-text response + optional `TypedAction` (e.g., offer treaty) | One per nation; persona prompt seeded from NPC roster. |
| Commander AI | Nation's military state + war goals + opponent posture | Updated frontlines + offensives (typed) | Runs every jump for AI nations; on demand for player nation if delegated. |
| Event Consolidator | New events from this round | Embedding vector + short summary string | Indexes events into RAG store. |
| Description→Action | Narrative "what happened" string | `Vec<TypedAction>` | Used during scenario bootstrap and rare narrative→mechanical bridging. |
| Next Speaker | Active group chat state | NpcId of who speaks next | Only for group diplomacy; decides turn order naturally. |

### Multi-pass jump (canonical example)

```
                        ┌───────────────────────────┐
Time-jump triggered  ──►│  Pass 1: Propose candidate│
(state delta + crises)  │  events from world state  │
                        └───────────┬───────────────┘
                                    │
                                    ▼
                        ┌───────────────────────────┐
                        │  Pass 2: Self-critique    │ ◄── if rejected,
                        │  against state validity   │     loop with reason
                        └───────────┬───────────────┘     (max 2 retries)
                                    │
                                    ▼
                        ┌───────────────────────────┐
                        │  Pass 3: Commit accepted  │
                        │  events as typed actions  │
                        └───────────┬───────────────┘
                                    │
                                    ▼
                              World state updated
```

Pass 1 and Pass 3 can use the same model. Pass 2 (critique) is the cheap-model slot — a smaller model checking "does this contradict anything in state."

### RAG event memory

- On every committed event, the *Event Consolidator* generates an embedding + a 1-sentence summary.
- Embeddings stored in an in-process vector store (`sqlite-vec` extension to SQLite — simple, no external service).
- On any subsystem call that benefits from history (Advisor, World Event Generator, Diplomacy NPC), we retrieve the top-K relevant events by embedding similarity to the current context.
- This replaces the original game's "summarize every 5 rounds" approach. Older relevant events stay accessible regardless of recency.

### Model-tier-aware prompting

The user's chosen model is classified (or self-declared):

- **frontier** — Claude Opus, GPT-5, Gemini Ultra-tier
- **large** — 70B-class local, GPT-4o-mini, Claude Sonnet
- **medium** — 30B-class local, Mistral medium
- **small** — 7-13B-class local
- **tiny** — sub-7B, smol-style

Each prompt category has 2–3 variants tuned for tier:

- **small/tiny:** strict JSON schemas, single-task prompts, no chain-of-thought, narrow context
- **medium/large:** richer reasoning room, multi-task possible, larger context
- **frontier:** can be given full world state + asked for nuanced narrative

The provider abstraction includes a `Model::tier()` function with a maintained lookup table; unknown models default to "small" for safety.

## 7. Combat system

Deterministic, seeded, reproducible. No LLM influence on outcomes.

### Per-tick combat resolution

Per province under attack along an active offensive:

```
base_atk    = sum(attacker_units.strength * unit_type_atk * tech_multiplier * doctrine_multiplier)
base_def    = sum(defender_units.strength * unit_type_def * tech_multiplier * doctrine_multiplier)
terrain_def_bonus = terrain_modifier(province.terrain)
supply_atk  = supply_efficiency(attacker, province)   // 0.0 — 1.0
supply_def  = supply_efficiency(defender, province)

effective_atk = base_atk * supply_atk
effective_def = base_def * (1 + terrain_def_bonus) * supply_def

advantage = effective_atk / (effective_atk + effective_def)

// Org damage: both sides lose org proportional to enemy effective power
attacker_org_loss = effective_def * combat_factor
defender_org_loss = effective_atk * combat_factor

// Strength damage: small fraction of org loss
attacker_str_loss = attacker_org_loss * 0.1
defender_str_loss = defender_org_loss * 0.1

if defender_org < threshold:
    province ownership transfers, units retreat to adjacent friendly province
```

Constants and curves chosen for tractable balance, tunable in a `balance.toml`.

### Doctrines (v1 — pick one per nation)

| Doctrine | Effect |
|----------|--------|
| Mobile Warfare | +20% org, +30% encirclement damage, armor/mech cost -15% |
| Defense in Depth | +25% def on own soil, +30% supply efficiency, -10% atk |
| Mass Assault | -25% unit cost, +15% attrition damage, -15% org |
| Superior Firepower | +20% atk, units cost +30%, no org change |

Doctrines are mutable but swapping incurs a stability hit + 30-day "rebase" period during which the new doctrine doesn't fully apply.

### Tech (v1 — single rolled-up score)

- Land tech 1–5 (start ranges from 1 in 1914 to ~3-4 in 2025 scenarios)
- Each level: +10% attack, +10% defense, +5% org cap
- Advances via R&D spending: industry capacity allocated to research instead of production
- No per-unit-type tech in v1 (deferred to v1.x)

### Terrain modifiers (defender %)

| Terrain | Def bonus |
|---------|-----------|
| Plains | 0% |
| Forest | +20% |
| Hills/Rough | +30% |
| Mountains | +50% |
| Urban | +40% |
| Desert | -10% (no cover, supply hard) |
| River crossing | +30% to defender |
| Coastal (defender) | +10% |

### Org vs strength

- **Strength** — permanent damage; replenished by reinforcement (uses manpower + resources)
- **Organization** — temporary damage; recovers when not engaged, at rate scaled by supply, doctrine, terrain
- A unit at 0 org *can't fight*; it retreats or surrenders. This creates HOI4's distinctive "shatter the army, take territory" gameplay.

### Encirclement

When a province is cut off from its national supply network:

- Supply efficiency drops to 0.2 per tick, then 0 if isolated 30+ days
- Out-of-supply units lose org at 2x normal combat loss rate
- Defeating out-of-supply units yields 2x strength damage and morale shock to enemy

The supply network: provinces are "supplied" if a connected friendly-controlled path exists to a supply hub (capital or designated hub province). Path-finding via Dijkstra over province graph, run on time-jump.

## 8. Resources and production

### Manpower

- Each nation's `manpower_pool` is a fraction of population, growing slowly per tick
- Recruiting a unit consumes manpower
- Total losses (strength damage) consume manpower as reinforcements arrive
- Out-of-manpower nations can't replace losses → quality of army degrades

### Industry capacity

- Total industrial capacity = sum of base_industry across owned provinces
- Player allocates via a slider: `civilian | military | research`
  - Civilian — builds infrastructure (new factories, +base_industry to a province), supply hubs
  - Military — produces units from build queue
  - Research — advances tech score (multi-month process per level)

### Strategic resources

| Resource | Used by |
|----------|---------|
| Steel | Armor, mechanized, artillery |
| Oil | Armor, mechanized (per-tick consumption to operate) |
| Rubber | Mechanized, artillery |
| Tungsten | High-end armor (post-tech-3) |

- Provinces produce specific resources per their `base_resources`
- Stockpile + per-tick production + per-tick consumption
- Shortage → cannot queue new builds requiring resource; existing units suffer org penalty (oil-starved tanks idle)
- Trade — diplomatic action; nations can offer/request resource trades, brokered by their NPCs

### Build queue

- Per-nation FIFO queue
- Each build order: unit type, target province (must be owned + connected), cost (industry-ticks + resources + manpower)
- A build slot processes one order at a time per X industry available
- Higher industry → more parallel slots

## 9. Frontline system

The HOI4-style command interface, simplified.

### Defining a frontline

- Player selects a sequence of own-controlled provinces forming a continuous border with one enemy nation
- This becomes a `Frontline` entity
- Player assigns units to that frontline (drag from "unassigned" pool, or via "auto-distribute" button)
- The engine spreads assigned units along the frontline based on:
  - Frontline length
  - Per-province terrain difficulty
  - Supply efficiency at each province

### Drawing offensives

- Player draws arrows from frontline provinces to target enemy provinces (clickable target picker)
- Each offensive specifies: source province, target province, posture (full attack | probe | hold)
- An offensive is *executed* on time-jump

### Posture

Each frontline has a posture: `hold` (no offensives execute), `active` (offensives execute), `retreat` (pull back to nearest defensible line).

### AI execution

During the time-jump:

- For each active frontline with offensives:
  - Combat resolved per offensive (§7)
  - Successful breakthroughs advance units, redraw frontline at new front
  - Failed attacks: units lose org, no advance
  - Encirclements detected and resolved
- For AI nations: their *Commander AI* drew the frontlines and offensives at the end of the prior round; same engine resolves them

### Multiple fronts

A nation can have multiple frontlines simultaneously (e.g., Soviet Union 1941: Eastern, Caucasus, Karelian). Each frontline is independent in posture and offensives but shares the nation's unit pool, supply, manpower, etc.

### Delegating to Commander AI

The player can flag any frontline as `ai_managed: true`. The Commander AI subsystem then draws the frontline boundaries and offensives for that front on the player's behalf, based on the player's stated war goals (a free-text field on the frontline: "push the Germans out of France"). Engine resolves identically.

## 10. Map

### Data source

- **GADM** ([gadm.org](https://gadm.org/)) Level 1 admin divisions for most countries, mixed with Level 2 for very small countries and Level 0 for tiny states
- License: GADM data is free for academic and non-commercial use. **Open question: confirm GADM licensing fits a distributable commercial game (see §17).** Fallback: [geoBoundaries](https://www.geoboundaries.org/) (open license, similar coverage).
- Target province count: ~1,500–2,500 provinces globally (subset of full GADM Level 1's ~3,600, pruning extreme tiny divisions)

### Build-time pipeline

```
GADM source (shapefile, ~1GB)
        │
        ▼
Subdivision script (Rust or Node, run once per data update):
  - Parse shapefile to GeoJSON
  - Filter to chosen admin levels
  - Simplify geometry (mapshaper / topojson-simplify) to ~5% of original points
  - Pack into topojson with our province metadata schema
  - Output: assets/world.topojson (~5-15MB target)
        │
        ▼
Ships with the app, loaded on game start
```

### Runtime rendering

- Tauri webview loads the topojson once
- Projection: equirectangular or Robinson, switchable
- Render: `<canvas>` 2D, redrawn on view change (pan/zoom) or state change
- Per-frame draw budget: ~16ms for 2.5K polygons → tested early; if perf is tight, WebGL fallback (PixiJS) is the path
- Color coding: nation owner color (with hue shift for "cores"), overlay layers for terrain, supply, frontline status

### Geographic polygons vs political borders

The polygon set is *geographic units* — they don't change. Political borders are an **ownership table** layered on top:

```rust
// At any point in time:
let nation_of_province: HashMap<ProvinceId, NationId> = ...;
// To render a nation: union of all provinces it owns
// To render a border: edge between two provinces with different owners
```

This means historical scenarios are *data*: a per-scenario ownership table. Not redrawn maps.

### Historical scenarios

Each shipped scenario (1914, 1939, 1962, 2025) is a JSON+TOML pair:

- `scenario.toml` — metadata, starting date, recommended models
- `world.json` — full initial `World` state including ownership, nations, NPCs, starting units, treaties, resources

These are hand-curated to be accurate-enough for the time period. Editorial line: 90th-percentile historical fidelity, not exhaustive.

### Custom-year sandbox

For a year not shipped as a scenario:

- Player picks year + (optional) starting nation
- Engine bootstraps a baseline world from the nearest-shipped scenario, then prompts the LLM via *Description→Action* with a few seed paragraphs about the era to mutate the world state forward/backward
- Player reviews + edits the resulting state before starting the run
- This is a "best effort" v1; expect rough edges that the player corrects

## 11. UI surfaces

### Main view (in-game)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [≡] Settings/Cheats    [⏱ Jan 1, 1939]  [Round 3]    [Save] [Pause] ⏵ │
├──────────────────┬─────────────────────────────────────┬───────────────┤
│ Advisor sidebar  │                                     │  Date/Jump    │
│ (collapsible)    │                                     │  control      │
│                  │                                     │  [1w][1mo][6mo│
│ ┌──────────────┐ │                                     │   [1y][custom]│
│ │ Advisor chat │ │                                     │               │
│ │ "What should │ │            World map                │  Build queue  │
│ │  I do about  │ │       (canvas, pan/zoom)            │  3 in queue   │
│ │  Czech?"     │ │                                     │               │
│ │              │ │                                     │  Resources    │
│ │ Stalin: ...  │ │                                     │  Steel: 1200  │
│ └──────────────┘ │                                     │  Oil:    340  │
│                  │                                     │  Rubber:  20  │
├──────────────────┤                                     │  Tungsten:  5 │
│ 💬 Diplomacy     │                                     │               │
│ (3 active)       │                                     │  Industry     │
│                  │                                     │  ▰▰▰▰▱▱▱▱ civ │
│ Britain (cordial)│                                     │  ▰▰▰▱▱▱▱▱ mil │
│ France (allied)  │                                     │  ▰▱▱▱▱▱▱▱ res │
│ USSR (hostile)   ◄─── click to open chat              │               │
├──────────────────┴─────────────────────────────────────┴───────────────┤
│  Action box (free-text):                          [Brainstorm] [Enhance]│
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ Mobilize reserves in Bavaria; offer Sudetenland talks to Britain│  │
│  └─────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Surfaces and what they do

| Surface | Purpose | Where |
|---------|---------|-------|
| Map | Primary spatial UI — territory, units, frontlines, terrain overlays | Center |
| Action Box | Free-text directives with `Brainstorm`/`Enhance` LLM helpers | Bottom center |
| Advisor sidebar | Strategic chat; uses RAG | Left, collapsible |
| Diplomacy panel | List of nations, click to open per-nation chat (or group) | Left, below Advisor |
| Timeline / Jump control | Pick increment (1w/1mo/6mo/1y/custom), execute jump | Top-right |
| Build queue | Active production orders, drag to reorder | Right |
| Resource panel | Stockpiles, per-tick deltas | Right |
| Industry split | Slider, three-way: civ/mil/research | Right |
| Settings / Cheats | Provider config, NPC roster, cheats menu | Top-left ≡ icon |
| Branch timeline | Tree view of save branches (rewind exists) | Settings panel + dedicated overlay |
| Endgame chronicle | Wikipedia-style summary at run end | Modal overlay |

### Frontline editing overlay

When the player enters "frontline mode":

- Map dims non-frontline territory
- Player clicks provinces to add to a new frontline (must be contiguous own-controlled adjacent to enemy)
- Or clicks an existing frontline to edit
- Side panel shows: assigned units, posture toggle, offensive list, `ai_managed` toggle, war-goals text input

### Group chat (kept per user)

- Player can invite 2–4 nations to a single chat thread
- The *Next Speaker* subsystem decides which NPC responds next based on context relevance + conversational dynamics
- Same typed-action outputs as 1-on-1 diplomacy

### Cheats menu (kept per user — debug + casual gameplay)

- Spawn units in any owned province
- Modify treasury / resources / manpower
- Modify any province ownership
- Trigger a specific event
- Pause/resume AI nations
- Inspect any nation's full state (debug view)
- Force-roll a different combat outcome (debug)

## 12. Persistence and rewind

### Save format

- SQLite, one file per save
- Schema: tables for `world_state` (one row per round, full JSON snapshot), `events`, `embeddings`, `branches`, `metadata`
- Stored in OS app-data:
  - Windows: `%APPDATA%\AlternateHistoryDemo\saves\`
  - macOS: `~/Library/Application Support/AlternateHistoryDemo/saves/`
  - Linux: `~/.local/share/AlternateHistoryDemo/saves/`

### Snapshots

- After every time-jump, the new world state is JSON-encoded and stored in a row keyed by `(save_id, branch_id, round)`
- Storage is full snapshot (not delta) for simplicity and resilience — each round ~50KB–500KB depending on game size; even a 500-round game is well under 250MB
- Snapshots are atomic — partial writes during a jump don't corrupt prior state

### Rewind and branching

```
   Round 1  ──►  Round 2  ──►  Round 3  ──►  Round 4
                                    │
                                    ▼
                                  rewind to Round 2
                                    │
                                    ▼
                              new branch:  Round 2'  ──►  Round 3'  ──►  ...
```

- Rewinding to round N creates a new `branch_id` from that snapshot
- The old branch isn't destroyed — visible in the branch tree view
- Branches are isolated; events and decisions in one don't affect another
- The branch tree view shows: nodes for each round, with hover-tooltip summary; player can jump to any node

### Mid-jump intervention

- During a time-jump, if a "significant event" is generated (e.g., another nation declares war on you), the engine pauses and presents an "Intervene?" prompt
- Player can `Save` (preserve the mid-jump state) or `Intervene` (halt the jump and respond)
- "Significant event" classification is part of the World Event Generator's output schema (an `interrupts_player: bool` field per event)

## 13. NPCs and personalities

### Roster

Each nation has at minimum:

- **Leader** — head of state, sets ideological tone, mostly visible via narrative
- **Foreign Minister / Diplomatic Lead** — primary diplomacy chat partner for the player
- **General / Military Lead** — relevant when discussing military matters, may issue counsel via Advisor

For shipped scenarios, the NPC roster is hand-curated with historical figures (Stalin, Chamberlain, Daladier, ...) and bespoke persona prompts. For custom-year sandbox, the LLM generates personas at start from era + role; player can edit before run begins.

### Persona schema

```rust
struct NpcPersona {
    archetype: PersonaArchetype,   // hawkish | dovish | pragmatist | ideologue | ...
    traits: Vec<String>,           // free-form descriptive: "paranoid", "loves ballet", "fluent in 4 languages"
    speech_style: SpeechStyle,     // terse | verbose | formal | folksy | ...
    ideology: Ideology,            // marxist | liberal | conservative | fascist | ...
    historical_quirks: Vec<String>,// specific things to riff on
}
```

The persona is injected into every prompt where this NPC speaks. Output stays consistent within and across sessions.

### Memory and grudges

```rust
struct Grudge {
    against: NationId | NpcId,
    date: GameDate,
    intensity: i32,           // 1-100
    description: String,
    decay_rate: f32,          // some grudges fade, some don't
}
```

- Significant negative actions toward an NPC (or their nation) create grudges
- Grudges modify `opinion_of_player` and surface in dialogue ("You said the same thing in '38, and I believed you then. I won't again.")
- Implemented as a list on each NPC; queried + injected into diplomacy prompts

### Persistent across the game

Even after rewinds (within the same branch line), the NPC's accumulated personality, grudges, and dialogue history persist. Across branches, NPCs reset — different branches are different timelines.

## 14. Provider system

### Auto-detection (first run + on demand)

On first launch (and via "Re-scan" button in Settings), the backend probes localhost ports:

| Provider | Default port | Detection |
|----------|--------------|-----------|
| Ollama | 11434 | GET `/api/tags` returns 200 with `models` |
| LM Studio | 1234 | GET `/v1/models` returns OpenAI-format model list |
| llama.cpp server | 8080 | GET `/health` or `/v1/models` |
| KoboldCpp | 5001 | GET `/api/v1/info/version` |
| Text-Gen-WebUI | 5000 | GET `/v1/models` |
| LocalAI | 8080 | GET `/v1/models` |
| vLLM | 8000 | GET `/v1/models` |
| Jan | 1337 | GET `/v1/models` |

Each detection runs in parallel with 500ms timeout. Findings surfaced in a "Detected providers" panel with one-click connect.

### Provider abstraction (Rust)

```rust
#[async_trait]
trait Provider: Send + Sync {
    fn name(&self) -> &str;
    fn kind(&self) -> ProviderKind;
    async fn list_models(&self) -> Result<Vec<ModelInfo>>;
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse>;
    async fn chat_stream(&self, request: ChatRequest) -> Result<BoxStream<ChatChunk>>;
    async fn embed(&self, text: &str) -> Result<Vec<f32>>;          // optional
    async fn health(&self) -> Result<HealthStatus>;
}
```

### Supported providers (v1)

**Local:**

- Ollama (native API, richest — also supports `embed`)
- LM Studio
- llama.cpp server (OpenAI-compat)
- KoboldCpp
- Text-Gen-WebUI
- LocalAI
- vLLM
- Jan
- Generic OpenAI-compatible endpoint (catch-all)

**Cloud:**

- OpenAI
- Anthropic
- OpenRouter
- Groq
- Mistral
- DeepSeek
- xAI (Grok)
- Together
- Fireworks
- Generic OpenAI-compatible (catch-all)

### Per-subsystem model assignment

```toml
# user settings
[providers.default]
provider = "ollama"
model = "qwen2.5:32b"

[providers.subsystem.event_generator]
provider = "ollama"
model = "qwen2.5:72b"

[providers.subsystem.action_validator]
provider = "ollama"
model = "qwen2.5:7b"     # cheap and fast

[providers.subsystem.embeddings]
provider = "ollama"
model = "nomic-embed-text"
```

Defaults: "use the default model for everything." Power users get granular control via Settings.

### Warm pools

- For Ollama specifically, the backend pings `/api/generate` with `keep_alive: -1` on session start to keep the active models loaded
- Configurable: user can set per-model TTL
- Multiple models can be warm simultaneously (e.g., one for generator, one for validator) — capped by user-specified VRAM budget

### Cost / latency display

- For each subsystem call, we record:
  - Provider + model
  - Tokens in/out (when reported by provider)
  - Wall time
- Surfaced subtly: small footer line per round summarizing total spend + total time
- "Free — local" badge prominently when 100% local provider used

## 15. Endgame chronicle

When a run ends (player loses, achieves a victory condition, or chooses "conclude run"):

- The full event log is summarized into a Wikipedia-style article
- Generated in 3-5 sections: Background, Major Events, Turning Points, Aftermath, Notable Figures
- LLM (frontier-tier preferred but works with any) uses RAG over the entire event history
- Output: Markdown + optional PNG (rendered with a styled HTML template)
- Player can download, copy, share

Victory conditions are configurable per scenario but always include: "Survive to 2050," "Achieve global hegemony," "Survive a major war with X allies remaining."

## 16. Confirmed cuts (per user during brainstorming)

| Feature | Status | Why |
|---------|--------|-----|
| In-game prompt editor | Cut | Power-user; defaults only in v1 |
| Custom map / scenario editor | Cut (v1.1) | Big editor surface; ship strong default scenarios first |
| Difficulty tiers | Cut | One balanced default; revisit if community asks |
| Group diplomacy chats | **Kept** | User explicitly requested |
| Cheat menu | **Kept** | Doubles as debug tooling |
| Air combat | Cut | Land + supply lanes only in v1 |
| Naval combat | Cut | Sea = transit between coasts only |
| Combat width | Cut | Single-frontage attacker/defender model |
| Per-unit-type tech | Cut | Single rolled-up Land Tech score |
| Equipment composition | Cut | Unit types are atomic in v1 |
| Multiplayer | Cut | Single-player only in v1 |
| Mobile platforms | Cut | Desktop only in v1 |

## 17. Open questions (resolve in implementation plan, not blocking design)

- **GADM licensing.** GADM is free for academic/non-commercial use. A distributable indie game *might* fall under acceptable use, or we may need to switch to **geoBoundaries** (open license) or **Natural Earth + custom subdivision** for the highest-detail divisions. Decision: confirm licensing fit during data-pipeline implementation; if blocked, geoBoundaries is the immediate fallback.
- **Embedding model choice.** Default to `nomic-embed-text` via Ollama (small, free, ubiquitous). If user has no embedding-capable provider configured, fall back to a bundled tiny model or skip RAG and use simple recency-based context. To be decided in the embedding-store implementation.
- **Map rendering perf at 2,500 polygons.** Canvas 2D might be too slow for smooth pan/zoom. PixiJS / WebGL fallback path is the plan if perf testing fails. Decision deferred to a perf spike in implementation.
- **SQLite + sqlite-vec packaging on Windows.** sqlite-vec is a C extension; need to confirm clean static-link or bundled-DLL story for Tauri Windows builds.
- **Game balance.** Initial combat / production / tech constants are placeholder. Real balance happens after v1 mechanical scaffolding is in place; balance is a separate iteration cycle, not part of v1 design.

## 18. Deferred to v1.1 and beyond

- Custom map / scenario / actor editor
- Air combat (squadrons, air superiority, strategic bombing)
- Naval combat (fleets, invasions, naval doctrines)
- Per-unit-type tech trees
- Equipment composition (division templates)
- Combat width and tactics
- Difficulty tiers
- In-game prompt editor with safe-mode + presets
- Multiplayer
- Mobile platforms
- Modding SDK and Steam Workshop integration

## 19. Glossary

- **Frontline** — A contiguous border between two nations at war, with assigned units and offensives.
- **Offensive** — An attack arrow from a frontline province to an enemy target province.
- **Province** — A geographic unit, a polygon from GADM. The atomic unit of territory.
- **Doctrine** — A nation-wide military strategy choice that modifies combat math.
- **Supply hub** — A province designated as a logistical center; the supply network radiates from here.
- **Branch** — A line of game history from a rewind point. Branches form a tree.
- **NPC** — A named character with a persistent persona and memory: leaders, advisors, generals, foreign ministers.
- **Typed action** — A structured mutation to world state emitted by the LLM and validated/applied by the engine.
- **Subsystem** — One of the eight AI roles (Validator, Generator, Advisor, Diplomacy, Commander, Consolidator, Description→Action, Next Speaker) with its own prompt and assignable model.
- **Decisional Pause** — The game's core loop where time freezes during player actions and simulates forward on time-jumps.
