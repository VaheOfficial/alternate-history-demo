# Plan 02 — Persistence Layer + World-State Scaffold

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the durable, branch-aware persistence layer plus the Rust struct definitions that all later game systems consume. After this plan, the Rust backend can create a save file, materialize a hand-crafted `World`, write per-round snapshots, rewind by loading any prior snapshot, fork a new branch from any snapshot, and list/delete saves — all behind Tauri commands. **No UI** for save management yet; that comes later when the game loop exists to call it.

**Architecture:** SQLite via `rusqlite` (sync) wrapped in `tokio::task::spawn_blocking` so it plays nice with Tauri's async-command runtime. One DB file per save under the OS app-data dir. Schema is migration-driven (hand-rolled, since we own all migrations and have no other contributors). The `World` aggregate (and all sub-entities — `Nation`, `Province`, `Unit`, etc.) is a Rust struct tree that serializes to JSON for snapshot storage; per-round JSON blobs are small (estimated 50–500 KB) so we store full snapshots, not deltas — simpler, atomic, and resilient.

**Tech Stack:** Rust (rusqlite + bundled SQLite, tokio's `spawn_blocking`, serde, serde_json, uuid, chrono for dates), no new frontend code in this plan.

**Spec reference:** [2026-05-21-alternate-history-game-design.md](../specs/2026-05-21-alternate-history-game-design.md) §5 (World state model), §12 (Persistence and rewind).

**Scope notes:**

- World struct sketches in this plan match the spec verbatim where feasible.
- Province `geometry_ref: GadmId` field exists but is opaque (a `String`) in Plan 02 — actual GADM data + lookup lives in Plan 03.
- Embedding / RAG store deferred to Plan 09. `Event.embedding` field is present (`Option<Vec<f32>>`) but not persisted in this plan's schema (added by a later migration).
- `sqlite-vec` extension not loaded yet — that's Plan 09.
- No UI in this plan. Tauri commands exist so a later plan can wire UI to them.

---

## File structure

### Rust (`src-tauri/`)

```
src-tauri/
├── Cargo.toml                       # Add: rusqlite, chrono
└── src/
    ├── lib.rs                       # register new modules + commands
    ├── commands/
    │   └── saves.rs                 # Tauri commands for save/branch/snapshot ops
    ├── db/
    │   ├── mod.rs
    │   ├── connection.rs            # open/close + per-save connection helpers
    │   ├── migrations.rs            # apply pending migrations
    │   └── migrations/
    │       └── m_001_initial.sql    # initial schema
    ├── world/
    │   ├── mod.rs                   # re-exports
    │   ├── ids.rs                   # strongly-typed wrapper IDs (NationId, ProvinceId, ...)
    │   ├── clock.rs                 # GameClock + GameDate helpers
    │   ├── nation.rs                # Nation + supporting enums (GovernmentType, IndustrySplit, TechLevel, DoctrineId, ResourceStockpile)
    │   ├── province.rs              # Province + Terrain + ResourceYield
    │   ├── unit.rs                  # Unit + UnitType + SupplyState
    │   ├── npc.rs                   # Npc + NpcRole + NpcPersona + Grudge
    │   ├── treaty.rs                # Treaty + TreatyKind + TreatyTerms
    │   ├── crisis.rs                # Crisis
    │   ├── event.rs                 # Event + EventCategory + Visibility
    │   ├── frontline.rs             # Frontline + Offensive + FrontPosture
    │   ├── action.rs                # TypedAction enum (LLM ↔ engine contract)
    │   └── world.rs                 # World aggregate + factory helpers for tests
    └── saves/
        ├── mod.rs
        ├── manager.rs               # SaveManager (high-level CRUD)
        └── snapshot.rs              # serialize/deserialize World to/from a snapshot row
```

### Tests

Rust unit tests alongside source via `#[cfg(test)] mod tests`. One integration test in `src-tauri/tests/snapshot_round_trip.rs` exercises full save → snapshot → reload → branch.

---

## Cargo dependencies (add in Task 1)

Add to `src-tauri/Cargo.toml` `[dependencies]`:

```toml
rusqlite = { version = "0.32", features = ["bundled", "uuid", "chrono"] }
chrono = { version = "0.4", features = ["serde"] }
```

(`uuid` is already a dep from Plan 01. `serde_json` already there.)

---

## Task 1 — Cargo deps

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Append the new deps**

In the `[dependencies]` block, append:

```toml
rusqlite = { version = "0.32", features = ["bundled", "uuid", "chrono"] }
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 2: Build**

```
cd src-tauri && cargo check
```

Expected: clean build (downloads + compiles sqlite-sys's bundled SQLite; can take 30–90s first time).

- [ ] **Step 3: Commit**

```
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Plan 02 deps: rusqlite (bundled) + chrono"
```

---

## Task 2 — Database connection module

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/connection.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod db;`)

The DB module owns SQLite connection lifecycle. Each save is its own file. We open on demand, return `Connection` handles wrapped in `Arc<Mutex<Connection>>` for cheap shared access. All DB work runs through `tokio::task::spawn_blocking`.

- [ ] **Step 1: Wire module in lib.rs**

In `src-tauri/src/lib.rs`, add alongside the other `mod` declarations:

```rust
mod db;
```

- [ ] **Step 2: Create db/mod.rs**

```rust
pub mod connection;
pub mod migrations;
```

(Create both files in this task — see Step 3 + Task 3.)

- [ ] **Step 3: Create db/connection.rs**

```rust
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::error::{AppError, Result};

const APP_DIR: &str = "AlternateHistoryDemo";
const SAVES_SUBDIR: &str = "saves";

/// Returns the directory that holds save DBs.
pub fn saves_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_DIR)
        .join(SAVES_SUBDIR)
}

/// Returns the path to a specific save's SQLite file.
pub fn save_db_path(save_id: Uuid) -> PathBuf {
    saves_dir().join(format!("{}.sqlite", save_id))
}

/// Open (or create) a SQLite connection for a given save id.
/// Caller is responsible for running migrations afterward.
pub fn open_save_db(save_id: Uuid) -> Result<Connection> {
    let dir = saves_dir();
    std::fs::create_dir_all(&dir)?;
    let path = save_db_path(save_id);
    open_db_at(&path)
}

pub fn open_db_at(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).map_err(rusqlite_err)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
        .map_err(rusqlite_err)?;
    Ok(conn)
}

pub(crate) fn rusqlite_err(e: rusqlite::Error) -> AppError {
    AppError::Db(e.to_string())
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory().map_err(rusqlite_err)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(rusqlite_err)?;
    Ok(conn)
}
```

- [ ] **Step 4: Extend AppError**

Add a `Db` variant to `src-tauri/src/error.rs`:

```rust
#[error("db: {0}")]
Db(String),
```

(Place it alongside the existing variants.)

- [ ] **Step 5: Build to verify**

```
cd src-tauri && cargo check
```

Expected: clean.

- [ ] **Step 6: Add a smoke test for open_in_memory**

Add a `#[cfg(test)] mod tests { ... }` at the bottom of `db/connection.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_in_memory_succeeds() {
        let _conn = open_in_memory().expect("open in-memory");
    }

    #[test]
    fn save_db_path_includes_save_id() {
        let id = Uuid::new_v4();
        let p = save_db_path(id);
        assert!(p.to_string_lossy().contains(&id.to_string()));
        assert!(p.to_string_lossy().ends_with(".sqlite"));
    }
}
```

- [ ] **Step 7: Run + commit**

```
cd src-tauri && cargo test --lib db::connection
git add src-tauri/src/db src-tauri/src/error.rs src-tauri/src/lib.rs
git commit -m "Plan 02: DB connection module + AppError::Db variant"
```

Expected: 2 passed.

---

## Task 3 — Migrations module + initial schema

**Files:**
- Create: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/db/migrations/m_001_initial.sql`

Migrations are static `&str` literals in the binary. A `_migrations` table tracks applied versions. `apply_pending(&Connection)` runs anything not yet applied in order.

- [ ] **Step 1: Write the initial schema SQL**

Create `src-tauri/src/db/migrations/m_001_initial.sql`:

```sql
-- Tracks which migration versions have been applied to this database.
CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per save. The save_id is also the DB file name.
CREATE TABLE IF NOT EXISTS saves (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scenario_id TEXT,
    player_nation TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_played_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Branches form a tree rooted at the initial branch of each save.
CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    parent_branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    parent_round INTEGER, -- the round in parent_branch where this branch forked
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_branches_save ON branches(save_id);

-- One snapshot row per (branch, round). Full World JSON, not a delta.
CREATE TABLE IF NOT EXISTS snapshots (
    save_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    round INTEGER NOT NULL,
    game_date TEXT NOT NULL,
    world_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (save_id, branch_id, round),
    FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_snapshots_branch_round ON snapshots(branch_id, round);

-- Events stored separately for indexed querying; also embedded in snapshots for atomicity.
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    save_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    round INTEGER NOT NULL,
    game_date TEXT NOT NULL,
    category TEXT NOT NULL,
    headline TEXT NOT NULL,
    narrative TEXT NOT NULL,
    visibility TEXT NOT NULL,
    typed_actions_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_save_branch ON events(save_id, branch_id, round);
```

- [ ] **Step 2: Create migrations.rs**

```rust
use rusqlite::{params, Connection};

use crate::error::Result;

use super::connection::rusqlite_err;

const M_001_INITIAL: &str = include_str!("./migrations/m_001_initial.sql");

const MIGRATIONS: &[(i64, &str)] = &[(1, M_001_INITIAL)];

pub fn apply_pending(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(rusqlite_err)?;

    let mut applied: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT version FROM _migrations ORDER BY version ASC")
            .map_err(rusqlite_err)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(rusqlite_err)?;
        rows.filter_map(|r| r.ok()).collect()
    };
    applied.sort();

    for (version, sql) in MIGRATIONS {
        if applied.binary_search(version).is_ok() {
            continue;
        }
        let tx = conn.unchecked_transaction().map_err(rusqlite_err)?;
        tx.execute_batch(sql).map_err(rusqlite_err)?;
        tx.execute(
            "INSERT INTO _migrations (version) VALUES (?1)",
            params![version],
        )
        .map_err(rusqlite_err)?;
        tx.commit().map_err(rusqlite_err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_in_memory;

    #[test]
    fn apply_pending_creates_all_tables() {
        let conn = open_in_memory().unwrap();
        apply_pending(&conn).expect("apply");

        for table in ["saves", "branches", "snapshots", "events", "_migrations"] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing table: {}", table);
        }
    }

    #[test]
    fn apply_pending_is_idempotent() {
        let conn = open_in_memory().unwrap();
        apply_pending(&conn).expect("first apply");
        apply_pending(&conn).expect("second apply (should be a no-op)");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
```

- [ ] **Step 3: Run + commit**

```
cd src-tauri && cargo test --lib db::migrations
git add src-tauri/src/db
git commit -m "Plan 02: migration runner + initial schema (saves/branches/snapshots/events)"
```

Expected: 2 passed.

---

## Task 4 — Strongly-typed IDs

**Files:**
- Create: `src-tauri/src/world/mod.rs`
- Create: `src-tauri/src/world/ids.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod world;`)

Wrapping bare `Uuid`s in newtypes prevents mixing up "this is a NationId" with "this is a ProvinceId" at the type level. Each newtype derives `Serialize`/`Deserialize` transparently so the JSON shape stays a UUID string.

- [ ] **Step 1: Wire module in lib.rs**

Add to `src-tauri/src/lib.rs`:

```rust
mod world;
```

- [ ] **Step 2: Create world/mod.rs**

```rust
pub mod action;
pub mod clock;
pub mod crisis;
pub mod event;
pub mod frontline;
pub mod ids;
pub mod nation;
pub mod npc;
pub mod province;
pub mod treaty;
pub mod unit;
pub mod world;

pub use ids::*;
pub use world::World;
```

(All sub-files exist by end of Task 9; cargo will fail to compile after this commit until those exist. To avoid a broken intermediate state, only commit Task 4's changes at end of Task 9. Run `cargo check` after each sub-task without committing.)

- [ ] **Step 3: Create world/ids.rs**

```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

id_type!(SaveId);
id_type!(BranchId);
id_type!(NationId);
id_type!(ProvinceId);
id_type!(UnitId);
id_type!(NpcId);
id_type!(TreatyId);
id_type!(CrisisId);
id_type!(EventId);
id_type!(FrontlineId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn different_id_types_are_distinct_at_type_level() {
        // This is a compile-time guarantee; the test just ensures `new()` works.
        let _n: NationId = NationId::new();
        let _p: ProvinceId = ProvinceId::new();
    }

    #[test]
    fn ids_serialize_as_uuid_strings() {
        let nid = NationId::new();
        let json = serde_json::to_string(&nid).unwrap();
        assert!(json.starts_with("\""));
        let back: NationId = serde_json::from_str(&json).unwrap();
        assert_eq!(nid, back);
    }
}
```

- [ ] **Step 4: cargo check (no commit yet)**

```
cd src-tauri && cargo check
```

Expected: errors about missing `world::action`, `world::clock`, etc. — fine for now. Continue without committing.

---

## Task 5 — GameClock

**Files:**
- Create: `src-tauri/src/world/clock.rs`

- [ ] **Step 1: Write clock.rs**

```rust
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameClock {
    pub current_date: NaiveDate,
    pub round: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeIncrement {
    OneWeek,
    OneMonth,
    ThreeMonths,
    SixMonths,
    OneYear,
}

impl TimeIncrement {
    pub fn days(self) -> i64 {
        match self {
            TimeIncrement::OneWeek => 7,
            TimeIncrement::OneMonth => 30,
            TimeIncrement::ThreeMonths => 91,
            TimeIncrement::SixMonths => 183,
            TimeIncrement::OneYear => 365,
        }
    }
}

impl GameClock {
    pub fn new(start: NaiveDate) -> Self {
        Self { current_date: start, round: 0 }
    }

    pub fn advance(&self, increment: TimeIncrement) -> GameClock {
        GameClock {
            current_date: self
                .current_date
                .checked_add_signed(chrono::Duration::days(increment.days()))
                .unwrap_or(self.current_date),
            round: self.round + 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advance_increments_round_and_date() {
        let c = GameClock::new(NaiveDate::from_ymd_opt(1939, 9, 1).unwrap());
        let c2 = c.advance(TimeIncrement::OneMonth);
        assert_eq!(c2.round, 1);
        assert!(c2.current_date > c.current_date);
    }

    #[test]
    fn one_year_advances_about_365_days() {
        let c = GameClock::new(NaiveDate::from_ymd_opt(1939, 1, 1).unwrap());
        let c2 = c.advance(TimeIncrement::OneYear);
        assert_eq!(c2.current_date.year(), 1940);
    }
}
```

Note: `chrono::NaiveDate::year()` needs `use chrono::Datelike;` in the test. Add it inside the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;
    // ...
}
```

- [ ] **Step 2: cargo check (no commit yet)**

```
cd src-tauri && cargo check
```

Expected: still errors about missing world sub-modules.

---

## Task 6 — Core entity types: Nation, Province, Unit

**Files:**
- Create: `src-tauri/src/world/nation.rs`
- Create: `src-tauri/src/world/province.rs`
- Create: `src-tauri/src/world/unit.rs`

- [ ] **Step 1: Write nation.rs**

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::ids::{NationId, NpcId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GovernmentType {
    Democracy,
    Monarchy,
    Republic,
    Communist,
    Fascist,
    MilitaryJunta,
    Theocracy,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DoctrineId {
    MobileWarfare,
    DefenseInDepth,
    MassAssault,
    SuperiorFirepower,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Resource {
    Steel,
    Oil,
    Rubber,
    Tungsten,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ResourceStockpile {
    #[serde(default)]
    pub steel: i64,
    #[serde(default)]
    pub oil: i64,
    #[serde(default)]
    pub rubber: i64,
    #[serde(default)]
    pub tungsten: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndustrySplit {
    /// civilian percentage (0-100)
    pub civilian: u8,
    /// military percentage (0-100)
    pub military: u8,
    /// research percentage (0-100)
    pub research: u8,
}

impl Default for IndustrySplit {
    fn default() -> Self {
        Self { civilian: 60, military: 30, research: 10 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TechLevel(pub u8);

impl Default for TechLevel {
    fn default() -> Self {
        Self(1)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitType {
    Infantry,
    Armor,
    Mechanized,
    Artillery,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BuildOrder {
    pub unit_type: UnitType,
    /// industry-ticks already invested; complete when >= unit_type cost
    pub progress: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nation {
    pub id: NationId,
    pub name: String,
    pub government: GovernmentType,
    pub leader: NpcId,

    pub treasury: i64,
    pub gdp: i64,
    pub population: i64,
    pub manpower_pool: i64,
    pub stability: i32,    // 0-100
    pub war_support: i32,  // 0-100

    pub industry_capacity: u32,
    #[serde(default)]
    pub industry_split: IndustrySplit,
    #[serde(default)]
    pub resources: ResourceStockpile,
    #[serde(default)]
    pub tech: TechLevel,
    pub doctrine: DoctrineId,

    /// Relation score per other nation. -100..=100.
    #[serde(default)]
    pub relations: HashMap<NationId, i32>,

    #[serde(default)]
    pub build_queue: Vec<BuildOrder>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::NpcId;

    #[test]
    fn nation_serializes_round_trip() {
        let n = Nation {
            id: NationId::new(),
            name: "Test".into(),
            government: GovernmentType::Democracy,
            leader: NpcId::new(),
            treasury: 100,
            gdp: 1000,
            population: 50_000_000,
            manpower_pool: 5_000_000,
            stability: 60,
            war_support: 40,
            industry_capacity: 20,
            industry_split: IndustrySplit::default(),
            resources: ResourceStockpile::default(),
            tech: TechLevel::default(),
            doctrine: DoctrineId::DefenseInDepth,
            relations: HashMap::new(),
            build_queue: Vec::new(),
        };
        let json = serde_json::to_string(&n).unwrap();
        let back: Nation = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, n.name);
        assert_eq!(back.doctrine, DoctrineId::DefenseInDepth);
    }
}
```

- [ ] **Step 2: Write province.rs**

```rust
use serde::{Deserialize, Serialize};

use super::ids::{NationId, ProvinceId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Terrain {
    Plains,
    Forest,
    HillsRough,
    Mountains,
    Urban,
    Desert,
    River,
    Coastal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ResourceYield {
    #[serde(default)]
    pub steel: u32,
    #[serde(default)]
    pub oil: u32,
    #[serde(default)]
    pub rubber: u32,
    #[serde(default)]
    pub tungsten: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Province {
    pub id: ProvinceId,
    pub name: String,
    /// GADM polygon reference. Opaque string in Plan 02; real lookup in Plan 03.
    pub geometry_ref: String,
    pub owner: NationId,
    #[serde(default)]
    pub core_of: Vec<NationId>,
    pub terrain: Terrain,
    pub population: i64,
    pub base_industry: u32,
    #[serde(default)]
    pub base_resources: ResourceYield,
    pub supply_value: u32,
    pub is_capital: bool,
    pub is_supply_hub: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn province_serializes_round_trip() {
        let p = Province {
            id: ProvinceId::new(),
            name: "Bavaria".into(),
            geometry_ref: "DEU.2_1".into(),
            owner: NationId::new(),
            core_of: Vec::new(),
            terrain: Terrain::Forest,
            population: 12_000_000,
            base_industry: 5,
            base_resources: ResourceYield::default(),
            supply_value: 3,
            is_capital: false,
            is_supply_hub: false,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: Province = serde_json::from_str(&json).unwrap();
        assert_eq!(back.terrain, Terrain::Forest);
        assert_eq!(back.geometry_ref, "DEU.2_1");
    }
}
```

- [ ] **Step 3: Write unit.rs**

```rust
use serde::{Deserialize, Serialize};

use super::ids::{NationId, ProvinceId, UnitId};
use super::nation::UnitType;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupplyState {
    Supplied,
    Reduced,
    OutOfSupply,
}

impl Default for SupplyState {
    fn default() -> Self {
        SupplyState::Supplied
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Unit {
    pub id: UnitId,
    pub owner: NationId,
    pub unit_type: UnitType,
    pub location: ProvinceId,
    /// 0..=max_strength; permanent damage
    pub strength: u32,
    /// 0..=max_org; recovers when not engaged
    pub organization: u32,
    pub experience: u32,
    #[serde(default)]
    pub supply_state: SupplyState,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::nation::UnitType;

    #[test]
    fn unit_serializes_round_trip() {
        let u = Unit {
            id: UnitId::new(),
            owner: NationId::new(),
            unit_type: UnitType::Armor,
            location: ProvinceId::new(),
            strength: 100,
            organization: 80,
            experience: 0,
            supply_state: SupplyState::Supplied,
        };
        let json = serde_json::to_string(&u).unwrap();
        let back: Unit = serde_json::from_str(&json).unwrap();
        assert_eq!(back.unit_type, UnitType::Armor);
        assert_eq!(back.organization, 80);
    }
}
```

- [ ] **Step 4: cargo check (no commit yet)**

```
cd src-tauri && cargo check
```

Errors about npc/treaty/crisis/event/frontline/action/world expected — fine.

---

## Task 7 — NPC, Treaty, Crisis types

**Files:**
- Create: `src-tauri/src/world/npc.rs`
- Create: `src-tauri/src/world/treaty.rs`
- Create: `src-tauri/src/world/crisis.rs`

- [ ] **Step 1: Write npc.rs**

```rust
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::ids::{NationId, NpcId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NpcRole {
    Leader,
    Advisor,
    General,
    ForeignMinister,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PersonaArchetype {
    Hawkish,
    Dovish,
    Pragmatist,
    Ideologue,
    Opportunist,
    Bureaucrat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeechStyle {
    Terse,
    Verbose,
    Formal,
    Folksy,
    Sarcastic,
    Cold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ideology {
    Marxist,
    Liberal,
    Conservative,
    Fascist,
    Nationalist,
    Pacifist,
    Centrist,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpcPersona {
    pub archetype: PersonaArchetype,
    #[serde(default)]
    pub traits: Vec<String>,
    pub speech_style: SpeechStyle,
    pub ideology: Ideology,
    #[serde(default)]
    pub historical_quirks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grudge {
    pub against_nation: Option<NationId>,
    pub against_npc: Option<NpcId>,
    pub date: NaiveDate,
    pub intensity: i32, // 1..=100
    pub description: String,
    /// 0.0..=1.0 — fraction subtracted per year
    pub decay_rate: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Npc {
    pub id: NpcId,
    pub name: String,
    pub nation: NationId,
    pub role: NpcRole,
    pub persona: NpcPersona,
    pub opinion_of_player: i32, // -100..=100
    #[serde(default)]
    pub grudges: Vec<Grudge>,
    #[serde(default)]
    pub relationships: HashMap<NpcId, i32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npc_round_trips_with_grudge() {
        let n = Npc {
            id: NpcId::new(),
            name: "Test".into(),
            nation: NationId::new(),
            role: NpcRole::Leader,
            persona: NpcPersona {
                archetype: PersonaArchetype::Hawkish,
                traits: vec!["paranoid".into()],
                speech_style: SpeechStyle::Terse,
                ideology: Ideology::Nationalist,
                historical_quirks: vec![],
            },
            opinion_of_player: -20,
            grudges: vec![Grudge {
                against_nation: Some(NationId::new()),
                against_npc: None,
                date: NaiveDate::from_ymd_opt(1939, 9, 1).unwrap(),
                intensity: 75,
                description: "betrayed in Munich".into(),
                decay_rate: 0.05,
            }],
            relationships: HashMap::new(),
        };
        let json = serde_json::to_string(&n).unwrap();
        let back: Npc = serde_json::from_str(&json).unwrap();
        assert_eq!(back.grudges.len(), 1);
        assert_eq!(back.grudges[0].intensity, 75);
    }
}
```

- [ ] **Step 2: Write treaty.rs**

```rust
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::ids::{NationId, TreatyId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TreatyKind {
    NonAggression,
    DefensivePact,
    Alliance,
    TradeAgreement,
    Ceasefire,
    PeaceTreaty,
    Vassalage,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TreatyTerms {
    #[serde(default)]
    pub territory_transfers: Vec<TerritoryTransfer>,
    #[serde(default)]
    pub tribute_per_year: i64,
    /// Free-text clauses for the LLM/narrative layer.
    #[serde(default)]
    pub extra_clauses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerritoryTransfer {
    pub from: NationId,
    pub to: NationId,
    pub province_geometry_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Treaty {
    pub id: TreatyId,
    pub kind: TreatyKind,
    pub parties: Vec<NationId>,
    pub signed_on: NaiveDate,
    pub expires_on: Option<NaiveDate>,
    #[serde(default)]
    pub terms: TreatyTerms,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treaty_round_trip() {
        let t = Treaty {
            id: TreatyId::new(),
            kind: TreatyKind::NonAggression,
            parties: vec![NationId::new(), NationId::new()],
            signed_on: NaiveDate::from_ymd_opt(1939, 8, 23).unwrap(),
            expires_on: None,
            terms: TreatyTerms::default(),
        };
        let json = serde_json::to_string(&t).unwrap();
        let back: Treaty = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, TreatyKind::NonAggression);
        assert_eq!(back.parties.len(), 2);
    }
}
```

- [ ] **Step 3: Write crisis.rs**

```rust
use serde::{Deserialize, Serialize};

use super::ids::{CrisisId, NationId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrisisCategory {
    Diplomatic,
    Military,
    Economic,
    Political,
    Humanitarian,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EscalationLevel(pub u8); // 0..=10

impl Default for EscalationLevel {
    fn default() -> Self {
        Self(0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Crisis {
    pub id: CrisisId,
    pub headline: String,
    pub category: CrisisCategory,
    pub parties: Vec<NationId>,
    pub stakes: String,
    #[serde(default)]
    pub escalation: EscalationLevel,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crisis_round_trip() {
        let c = Crisis {
            id: CrisisId::new(),
            headline: "Sudetenland tensions".into(),
            category: CrisisCategory::Diplomatic,
            parties: vec![NationId::new(), NationId::new()],
            stakes: "Border territory and ethnic German minority".into(),
            escalation: EscalationLevel(5),
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: Crisis = serde_json::from_str(&json).unwrap();
        assert_eq!(back.escalation, EscalationLevel(5));
    }
}
```

- [ ] **Step 4: cargo check (still no commit)**

```
cd src-tauri && cargo check
```

Expected: still errors for event/frontline/action/world.

---

## Task 8 — Event, Frontline, TypedAction

**Files:**
- Create: `src-tauri/src/world/event.rs`
- Create: `src-tauri/src/world/frontline.rs`
- Create: `src-tauri/src/world/action.rs`

- [ ] **Step 1: Write event.rs**

```rust
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::action::TypedAction;
use super::ids::{EventId, NationId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventCategory {
    Military,
    Diplomatic,
    Economic,
    Political,
    Social,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Visibility {
    Global,
    NationOnly { nation: NationId },
    Hidden,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: EventId,
    pub round: u32,
    pub timestamp: NaiveDate,
    pub category: EventCategory,
    pub headline: String,
    pub narrative: String,
    #[serde(default)]
    pub typed_actions: Vec<TypedAction>,
    pub visibility: Visibility,
    /// Filled later by the Event Consolidator (Plan 09). Not persisted in Plan 02.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    /// True when this event must pause a time-jump for player input.
    #[serde(default)]
    pub interrupts_player: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_round_trip() {
        let e = Event {
            id: EventId::new(),
            round: 3,
            timestamp: NaiveDate::from_ymd_opt(1939, 9, 1).unwrap(),
            category: EventCategory::Military,
            headline: "German invasion of Poland".into(),
            narrative: "At dawn on 1 September 1939...".into(),
            typed_actions: vec![],
            visibility: Visibility::Global,
            embedding: None,
            interrupts_player: true,
        };
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert!(back.interrupts_player);
    }
}
```

- [ ] **Step 2: Write frontline.rs**

```rust
use serde::{Deserialize, Serialize};

use super::ids::{FrontlineId, NationId, ProvinceId, UnitId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrontPosture {
    Hold,
    Active,
    Retreat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OffensiveKind {
    FullAttack,
    Probe,
    Hold,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Offensive {
    pub source: ProvinceId,
    pub target: ProvinceId,
    pub kind: OffensiveKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frontline {
    pub id: FrontlineId,
    pub owner: NationId,
    pub enemy: NationId,
    pub provinces: Vec<ProvinceId>,
    #[serde(default)]
    pub assigned_units: Vec<UnitId>,
    #[serde(default)]
    pub offensives: Vec<Offensive>,
    pub posture: FrontPosture,
    #[serde(default)]
    pub ai_managed: bool,
    #[serde(default)]
    pub war_goals: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontline_round_trip() {
        let f = Frontline {
            id: FrontlineId::new(),
            owner: NationId::new(),
            enemy: NationId::new(),
            provinces: vec![ProvinceId::new()],
            assigned_units: vec![UnitId::new(), UnitId::new()],
            offensives: vec![Offensive {
                source: ProvinceId::new(),
                target: ProvinceId::new(),
                kind: OffensiveKind::FullAttack,
            }],
            posture: FrontPosture::Active,
            ai_managed: false,
            war_goals: "push to Berlin".into(),
        };
        let json = serde_json::to_string(&f).unwrap();
        let back: Frontline = serde_json::from_str(&json).unwrap();
        assert_eq!(back.posture, FrontPosture::Active);
        assert_eq!(back.assigned_units.len(), 2);
    }
}
```

- [ ] **Step 3: Write action.rs**

```rust
use serde::{Deserialize, Serialize};

use super::ids::{NationId, NpcId, ProvinceId, UnitId};
use super::nation::{GovernmentType, Resource, UnitType};
use super::treaty::{TreatyKind, TreatyTerms};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferReason {
    Conquest,
    Treaty,
    Secession,
    Decolonization,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeReason {
    Election,
    Coup,
    Revolution,
    Abdication,
    ForeignImposition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TypedAction {
    DeclareWar {
        aggressor: NationId,
        target: NationId,
        justification: String,
    },
    SignTreaty {
        parties: Vec<NationId>,
        kind: TreatyKind,
        terms: TreatyTerms,
    },
    TransferTerritory {
        from: NationId,
        to: NationId,
        provinces: Vec<ProvinceId>,
        mechanism: TransferReason,
    },
    ModifyRelation {
        from: NationId,
        to: NationId,
        delta: i32,
        reason: String,
    },
    SpawnUnit {
        owner: NationId,
        unit_type: UnitType,
        location: ProvinceId,
        strength: u32,
    },
    MoveUnit {
        unit: UnitId,
        target: ProvinceId,
    },
    ChangeGovernment {
        nation: NationId,
        new_form: GovernmentType,
        mechanism: ChangeReason,
    },
    AssassinateNpc {
        target: NpcId,
    },
    ModifyResource {
        nation: NationId,
        resource: Resource,
        delta: i64,
    },
    ModifyStability {
        nation: NationId,
        delta: i32,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declare_war_round_trip() {
        let a = TypedAction::DeclareWar {
            aggressor: NationId::new(),
            target: NationId::new(),
            justification: "Casus belli over Sudetenland".into(),
        };
        let json = serde_json::to_string(&a).unwrap();
        let back: TypedAction = serde_json::from_str(&json).unwrap();
        match back {
            TypedAction::DeclareWar { justification, .. } => {
                assert!(justification.contains("Sudetenland"));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn typed_action_uses_kind_tag() {
        let a = TypedAction::ModifyStability {
            nation: NationId::new(),
            delta: -5,
        };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("\"kind\":\"modify_stability\""));
    }
}
```

- [ ] **Step 4: cargo check**

```
cd src-tauri && cargo check
```

Expected: only `world::world` missing now.

---

## Task 9 — World aggregate + commit accumulated world/ changes

**Files:**
- Create: `src-tauri/src/world/world.rs`

- [ ] **Step 1: Write world.rs**

```rust
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::clock::GameClock;
use super::crisis::Crisis;
use super::event::Event;
use super::frontline::Frontline;
use super::ids::{BranchId, NationId, SaveId};
use super::nation::Nation;
use super::npc::Npc;
use super::province::Province;
use super::treaty::Treaty;
use super::unit::Unit;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct World {
    pub save_id: SaveId,
    pub branch_id: BranchId,
    pub clock: GameClock,
    pub player_nation: Option<NationId>,
    pub nations: Vec<Nation>,
    pub provinces: Vec<Province>,
    pub units: Vec<Unit>,
    pub npcs: Vec<Npc>,
    pub treaties: Vec<Treaty>,
    pub crises: Vec<Crisis>,
    pub frontlines: Vec<Frontline>,
    /// Append-only event log for this branch up to and including the current round.
    pub events: Vec<Event>,
}

impl World {
    /// Construct a minimal empty world. Used by tests + scenario bootstrap (later plans).
    /// Not behind `#[cfg(test)]` because integration tests live in a separate crate
    /// and can only see public, non-test-gated items.
    pub fn empty(save: SaveId, branch: BranchId, start: NaiveDate) -> Self {
        Self {
            save_id: save,
            branch_id: branch,
            clock: GameClock::new(start),
            player_nation: None,
            nations: vec![],
            provinces: vec![],
            units: vec![],
            npcs: vec![],
            treaties: vec![],
            crises: vec![],
            frontlines: vec![],
            events: vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_world_serializes_round_trip() {
        let w = World::empty(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(1939, 9, 1).unwrap(),
        );
        let json = serde_json::to_string(&w).unwrap();
        let back: World = serde_json::from_str(&json).unwrap();
        assert_eq!(back.clock.round, 0);
        assert_eq!(back.nations.len(), 0);
    }
}
```

- [ ] **Step 2: Build + run all world tests**

```
cd src-tauri && cargo test --lib world
```

Expected: all world tests pass (clock 2, nation 1, province 1, unit 1, npc 1, treaty 1, crisis 1, event 1, frontline 1, action 2, world 1, ids 2 → ~15 tests).

- [ ] **Step 3: Commit all of Tasks 4–9 together**

```
git add src-tauri/src/world src-tauri/src/lib.rs
git commit -m "Plan 02: World aggregate + all entity types (Nation/Province/Unit/NPC/Treaty/Crisis/Event/Frontline/TypedAction)"
```

---

## Task 10 — Saves module + manager (save CRUD)

**Files:**
- Create: `src-tauri/src/saves/mod.rs`
- Create: `src-tauri/src/saves/manager.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod saves;`)

The save manager is the high-level API for save/branch/snapshot operations. Each method internally `spawn_blocking`s the rusqlite work.

- [ ] **Step 1: Wire in lib.rs**

```rust
mod saves;
```

- [ ] **Step 2: Create saves/mod.rs**

```rust
pub mod manager;
pub mod snapshot;
```

- [ ] **Step 3: Write saves/manager.rs (save CRUD only — branch/snapshot in Task 11)**

```rust
use chrono::NaiveDate;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::connection::{open_save_db, rusqlite_err};
use crate::db::migrations::apply_pending;
use crate::error::{AppError, Result};
use crate::world::ids::{BranchId, SaveId};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveSummary {
    pub id: SaveId,
    pub name: String,
    pub scenario_id: Option<String>,
    pub created_at: String,
    pub last_played_at: String,
    /// Initial branch id, for convenience when loading.
    pub initial_branch_id: BranchId,
}

#[derive(Debug, Clone)]
pub struct CreateSaveRequest {
    pub name: String,
    pub scenario_id: Option<String>,
    pub start_date: NaiveDate,
}

pub async fn create_save(req: CreateSaveRequest) -> Result<SaveSummary> {
    let save_id = SaveId::new();
    let branch_id = BranchId::new();
    let name = req.name.clone();
    let scenario_id = req.scenario_id.clone();

    tokio::task::spawn_blocking(move || -> Result<SaveSummary> {
        let conn = open_save_db(save_id.0)?;
        apply_pending(&conn)?;

        let tx = conn.unchecked_transaction().map_err(rusqlite_err)?;
        tx.execute(
            "INSERT INTO saves (id, name, scenario_id) VALUES (?1, ?2, ?3)",
            params![save_id.to_string(), name, scenario_id],
        )
        .map_err(rusqlite_err)?;
        tx.execute(
            "INSERT INTO branches (id, save_id, parent_branch_id, parent_round, name)
             VALUES (?1, ?2, NULL, NULL, 'main')",
            params![branch_id.to_string(), save_id.to_string()],
        )
        .map_err(rusqlite_err)?;
        tx.commit().map_err(rusqlite_err)?;

        read_summary(&conn, save_id)?
            .ok_or_else(|| AppError::NotFound("save just created not found".into()))
    })
    .await
    .map_err(|e| AppError::InvalidArgument(format!("join: {}", e)))?
}

pub async fn list_saves() -> Result<Vec<SaveSummary>> {
    tokio::task::spawn_blocking(|| -> Result<Vec<SaveSummary>> {
        let dir = crate::db::connection::saves_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("sqlite") {
                continue;
            }
            let conn = crate::db::connection::open_db_at(&path)?;
            // Tolerate not-yet-migrated files (skip).
            if apply_pending(&conn).is_err() {
                continue;
            }
            let summaries = read_all_summaries(&conn)?;
            out.extend(summaries);
        }
        out.sort_by(|a, b| b.last_played_at.cmp(&a.last_played_at));
        Ok(out)
    })
    .await
    .map_err(|e| AppError::InvalidArgument(format!("join: {}", e)))?
}

pub async fn delete_save(id: SaveId) -> Result<()> {
    tokio::task::spawn_blocking(move || -> Result<()> {
        let path = crate::db::connection::save_db_path(id.0);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::InvalidArgument(format!("join: {}", e)))?
}

fn read_summary(conn: &rusqlite::Connection, id: SaveId) -> Result<Option<SaveSummary>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.scenario_id, s.created_at, s.last_played_at,
                (SELECT id FROM branches WHERE save_id = s.id AND parent_branch_id IS NULL LIMIT 1)
         FROM saves s WHERE s.id = ?1",
    ).map_err(rusqlite_err)?;
    let res = stmt.query_row(params![id.to_string()], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
        ))
    });
    match res {
        Ok((id_s, name, scenario_id, created, last, initial_branch)) => Ok(Some(SaveSummary {
            id: parse_save_id(&id_s)?,
            name,
            scenario_id,
            created_at: created,
            last_played_at: last,
            initial_branch_id: parse_branch_id(&initial_branch)?,
        })),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(rusqlite_err(e)),
    }
}

fn read_all_summaries(conn: &rusqlite::Connection) -> Result<Vec<SaveSummary>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.scenario_id, s.created_at, s.last_played_at,
                (SELECT id FROM branches WHERE save_id = s.id AND parent_branch_id IS NULL LIMIT 1)
         FROM saves s",
    ).map_err(rusqlite_err)?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    }).map_err(rusqlite_err)?;

    let mut out = Vec::new();
    for r in rows {
        let (id_s, name, scenario_id, created, last, initial) = r.map_err(rusqlite_err)?;
        let initial = match initial {
            Some(b) => b,
            None => continue, // malformed save with no initial branch — skip
        };
        out.push(SaveSummary {
            id: parse_save_id(&id_s)?,
            name,
            scenario_id,
            created_at: created,
            last_played_at: last,
            initial_branch_id: parse_branch_id(&initial)?,
        });
    }
    Ok(out)
}

fn parse_save_id(s: &str) -> Result<SaveId> {
    uuid::Uuid::parse_str(s)
        .map(SaveId)
        .map_err(|e| AppError::InvalidArgument(format!("bad save_id: {}", e)))
}

fn parse_branch_id(s: &str) -> Result<BranchId> {
    uuid::Uuid::parse_str(s)
        .map(BranchId)
        .map_err(|e| AppError::InvalidArgument(format!("bad branch_id: {}", e)))
}
```

- [ ] **Step 4: Build**

```
cd src-tauri && cargo check
```

Expected: clean (no tests yet for manager — they come in Task 11 + integration test).

- [ ] **Step 5: Commit (no tests yet; integration test in Task 13 will cover this)**

```
git add src-tauri/src/saves src-tauri/src/lib.rs
git commit -m "Plan 02: Save CRUD (create/list/delete)"
```

---

## Task 11 — Snapshot save/load + branch CRUD

**Files:**
- Create: `src-tauri/src/saves/snapshot.rs`
- Modify: `src-tauri/src/saves/manager.rs` (add branch ops)

- [ ] **Step 1: Write saves/snapshot.rs**

```rust
use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::connection::{open_save_db, rusqlite_err};
use crate::error::{AppError, Result};
use crate::world::ids::{BranchId, SaveId};
use crate::world::world::World;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotMeta {
    pub save_id: SaveId,
    pub branch_id: BranchId,
    pub round: u32,
    pub game_date: String,
}

pub async fn save_snapshot(world: World) -> Result<()> {
    let world_clone = world.clone();
    let save_id = world.save_id;
    let branch_id = world.branch_id;
    let round = world.clock.round as i64;
    let date = world.clock.current_date.to_string();
    let json = serde_json::to_string(&world_clone)?;

    tokio::task::spawn_blocking(move || -> Result<()> {
        let conn = open_save_db(save_id.0)?;
        conn.execute(
            "INSERT OR REPLACE INTO snapshots
             (save_id, branch_id, round, game_date, world_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                save_id.to_string(),
                branch_id.to_string(),
                round,
                date,
                json
            ],
        )
        .map_err(rusqlite_err)?;
        conn.execute(
            "UPDATE saves SET last_played_at = datetime('now') WHERE id = ?1",
            params![save_id.to_string()],
        )
        .map_err(rusqlite_err)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::InvalidArgument(format!("join: {}", e)))??;
    Ok(())
}

pub async fn load_snapshot(save: SaveId, branch: BranchId, round: u32) -> Result<World> {
    tokio::task::spawn_blocking(move || -> Result<World> {
        let conn = open_save_db(save.0)?;
        let json: String = conn
            .query_row(
                "SELECT world_json FROM snapshots
                 WHERE save_id = ?1 AND branch_id = ?2 AND round = ?3",
                params![save.to_string(), branch.to_string(), round as i64],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("snapshot round={}", round))
                }
                other => rusqlite_err(other),
            })?;
        Ok(serde_json::from_str::<World>(&json)?)
    })
    .await
    .map_err(|e| AppError::InvalidArgument(format!("join: {}", e)))?
}

pub async fn list_snapshots(save: SaveId, branch: BranchId) -> Result<Vec<SnapshotMeta>> {
    tokio::task::spawn_blocking(move || -> Result<Vec<SnapshotMeta>> {
        let conn = open_save_db(save.0)?;
        let mut stmt = conn.prepare(
            "SELECT round, game_date FROM snapshots
             WHERE save_id = ?1 AND branch_id = ?2 ORDER BY round ASC",
        ).map_err(rusqlite_err)?;
        let rows = stmt.query_map(
            params![save.to_string(), branch.to_string()],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        ).map_err(rusqlite_err)?;
        let mut out = Vec::new();
        for r in rows {
            let (round, date) = r.map_err(rusqlite_err)?;
            out.push(SnapshotMeta {
                save_id: save,
                branch_id: branch,
                round: round as u32,
                game_date: date,
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| AppError::InvalidArgument(format!("join: {}", e)))?
}
```

- [ ] **Step 2: Append branch ops to saves/manager.rs**

Append to `saves/manager.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchSummary {
    pub id: BranchId,
    pub save_id: SaveId,
    pub parent_branch_id: Option<BranchId>,
    pub parent_round: Option<u32>,
    pub name: String,
    pub created_at: String,
}

pub async fn list_branches(save: SaveId) -> Result<Vec<BranchSummary>> {
    tokio::task::spawn_blocking(move || -> Result<Vec<BranchSummary>> {
        let conn = open_save_db(save.0)?;
        let mut stmt = conn.prepare(
            "SELECT id, save_id, parent_branch_id, parent_round, name, created_at
             FROM branches WHERE save_id = ?1 ORDER BY created_at ASC",
        ).map_err(rusqlite_err)?;
        let rows = stmt.query_map(params![save.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        }).map_err(rusqlite_err)?;
        let mut out = Vec::new();
        for r in rows {
            let (id_s, save_s, parent_id, parent_round, name, created) = r.map_err(rusqlite_err)?;
            out.push(BranchSummary {
                id: parse_branch_id(&id_s)?,
                save_id: parse_save_id(&save_s)?,
                parent_branch_id: match parent_id {
                    Some(s) => Some(parse_branch_id(&s)?),
                    None => None,
                },
                parent_round: parent_round.map(|x| x as u32),
                name,
                created_at: created,
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| AppError::InvalidArgument(format!("join: {}", e)))?
}

#[derive(Debug, Clone)]
pub struct CreateBranchRequest {
    pub save: SaveId,
    pub parent_branch: BranchId,
    pub parent_round: u32,
    pub name: String,
}

pub async fn create_branch(req: CreateBranchRequest) -> Result<BranchId> {
    let new_branch = BranchId::new();
    let save = req.save;
    let parent = req.parent_branch;
    let parent_round = req.parent_round;
    let name = req.name.clone();

    tokio::task::spawn_blocking(move || -> Result<BranchId> {
        let conn = open_save_db(save.0)?;
        // Verify parent snapshot exists.
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM snapshots WHERE save_id = ?1 AND branch_id = ?2 AND round = ?3",
            params![save.to_string(), parent.to_string(), parent_round as i64],
            |row| row.get(0),
        ).map_err(rusqlite_err)?;
        if exists == 0 {
            return Err(AppError::NotFound(format!(
                "snapshot for branch={} round={}",
                parent, parent_round
            )));
        }

        let tx = conn.unchecked_transaction().map_err(rusqlite_err)?;
        tx.execute(
            "INSERT INTO branches (id, save_id, parent_branch_id, parent_round, name)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                new_branch.to_string(),
                save.to_string(),
                parent.to_string(),
                parent_round as i64,
                name
            ],
        )
        .map_err(rusqlite_err)?;
        // Copy the fork-point snapshot into the new branch so it has a starting state.
        tx.execute(
            "INSERT INTO snapshots (save_id, branch_id, round, game_date, world_json)
             SELECT save_id, ?1, round, game_date, world_json FROM snapshots
             WHERE save_id = ?2 AND branch_id = ?3 AND round = ?4",
            params![
                new_branch.to_string(),
                save.to_string(),
                parent.to_string(),
                parent_round as i64
            ],
        )
        .map_err(rusqlite_err)?;
        // Rewrite branch_id inside the copied World JSON so future load_snapshot matches it.
        let mut stmt = tx.prepare(
            "SELECT world_json FROM snapshots WHERE save_id = ?1 AND branch_id = ?2 AND round = ?3"
        ).map_err(rusqlite_err)?;
        let json: String = stmt.query_row(
            params![save.to_string(), new_branch.to_string(), parent_round as i64],
            |row| row.get(0),
        ).map_err(rusqlite_err)?;
        drop(stmt);
        let mut world: crate::world::world::World = serde_json::from_str(&json)?;
        world.branch_id = new_branch;
        let updated_json = serde_json::to_string(&world)?;
        tx.execute(
            "UPDATE snapshots SET world_json = ?1
             WHERE save_id = ?2 AND branch_id = ?3 AND round = ?4",
            params![
                updated_json,
                save.to_string(),
                new_branch.to_string(),
                parent_round as i64
            ],
        )
        .map_err(rusqlite_err)?;
        tx.commit().map_err(rusqlite_err)?;
        Ok(new_branch)
    })
    .await
    .map_err(|e| AppError::InvalidArgument(format!("join: {}", e)))?
}
```

- [ ] **Step 3: Build**

```
cd src-tauri && cargo check
```

Expected: clean.

- [ ] **Step 4: Commit**

```
git add src-tauri/src/saves
git commit -m "Plan 02: Snapshot save/load + branch CRUD with fork-point copy"
```

---

## Task 12 — Tauri commands for save management

**Files:**
- Create: `src-tauri/src/commands/saves.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Write commands/saves.rs**

```rust
use chrono::NaiveDate;

use crate::error::{AppError, Result};
use crate::saves::manager::{
    create_branch, create_save, delete_save, list_branches, list_saves,
    BranchSummary, CreateBranchRequest, CreateSaveRequest, SaveSummary,
};
use crate::saves::snapshot::{
    list_snapshots, load_snapshot, save_snapshot, SnapshotMeta,
};
use crate::world::ids::{BranchId, SaveId};
use crate::world::world::World;

#[tauri::command]
pub async fn create_save_cmd(
    name: String,
    scenario_id: Option<String>,
    start_date: String,
) -> Result<SaveSummary> {
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| AppError::InvalidArgument(format!("bad start_date: {}", e)))?;
    create_save(CreateSaveRequest { name, scenario_id, start_date: start }).await
}

#[tauri::command]
pub async fn list_saves_cmd() -> Result<Vec<SaveSummary>> {
    list_saves().await
}

#[tauri::command]
pub async fn delete_save_cmd(id: SaveId) -> Result<()> {
    delete_save(id).await
}

#[tauri::command]
pub async fn list_branches_cmd(save: SaveId) -> Result<Vec<BranchSummary>> {
    list_branches(save).await
}

#[tauri::command]
pub async fn create_branch_cmd(
    save: SaveId,
    parent_branch: BranchId,
    parent_round: u32,
    name: String,
) -> Result<BranchId> {
    create_branch(CreateBranchRequest {
        save,
        parent_branch,
        parent_round,
        name,
    })
    .await
}

#[tauri::command]
pub async fn save_snapshot_cmd(world: World) -> Result<()> {
    save_snapshot(world).await
}

#[tauri::command]
pub async fn load_snapshot_cmd(
    save: SaveId,
    branch: BranchId,
    round: u32,
) -> Result<World> {
    load_snapshot(save, branch, round).await
}

#[tauri::command]
pub async fn list_snapshots_cmd(
    save: SaveId,
    branch: BranchId,
) -> Result<Vec<SnapshotMeta>> {
    list_snapshots(save, branch).await
}
```

- [ ] **Step 2: Re-export from commands/mod.rs**

Modify `src-tauri/src/commands/mod.rs`:

```rust
pub mod providers;
pub mod saves;
```

- [ ] **Step 3: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, append to the `invoke_handler` list:

```rust
.invoke_handler(tauri::generate_handler![
    commands::providers::list_provider_configs,
    commands::providers::add_provider,
    commands::providers::remove_provider,
    commands::providers::list_models,
    commands::providers::test_chat,
    commands::providers::detect_local_providers,
    commands::providers::get_default_provider,
    commands::providers::set_default_provider,
    commands::saves::create_save_cmd,
    commands::saves::list_saves_cmd,
    commands::saves::delete_save_cmd,
    commands::saves::list_branches_cmd,
    commands::saves::create_branch_cmd,
    commands::saves::save_snapshot_cmd,
    commands::saves::load_snapshot_cmd,
    commands::saves::list_snapshots_cmd,
])
```

- [ ] **Step 4: Build + commit**

```
cd src-tauri && cargo check
git add src-tauri/src/commands src-tauri/src/lib.rs
git commit -m "Plan 02: Tauri commands for save/branch/snapshot management"
```

---

## Task 13 — Integration test: full snapshot round-trip + branching

**Files:**
- Create: `src-tauri/tests/snapshot_round_trip.rs`

End-to-end test exercising real SQLite on disk: create save → write 3 snapshots → load round 1 → fork branch from round 1 → write a snapshot on the new branch → list snapshots per branch and confirm isolation.

- [ ] **Step 1: Write the integration test**

```rust
use chrono::NaiveDate;

use alternate_history_demo_lib::saves::manager::{
    create_branch, create_save, delete_save, list_branches, list_saves, CreateBranchRequest,
    CreateSaveRequest,
};
use alternate_history_demo_lib::saves::snapshot::{
    list_snapshots, load_snapshot, save_snapshot,
};
use alternate_history_demo_lib::world::World;

#[tokio::test]
async fn full_save_branch_snapshot_round_trip() {
    // Create save.
    let summary = create_save(CreateSaveRequest {
        name: "integration-test".into(),
        scenario_id: Some("test-1939".into()),
        start_date: NaiveDate::from_ymd_opt(1939, 9, 1).unwrap(),
    })
    .await
    .expect("create_save");

    let save_id = summary.id;
    let main_branch = summary.initial_branch_id;

    // Write 3 snapshots on main branch.
    for round in 0..3u32 {
        let mut world = World::empty(
            save_id,
            main_branch,
            NaiveDate::from_ymd_opt(1939, 9, 1).unwrap(),
        );
        world.clock.round = round;
        save_snapshot(world).await.expect("save_snapshot");
    }

    let snaps = list_snapshots(save_id, main_branch).await.expect("list_snapshots");
    assert_eq!(snaps.len(), 3);

    // Load round 1.
    let loaded = load_snapshot(save_id, main_branch, 1).await.expect("load_snapshot");
    assert_eq!(loaded.clock.round, 1);
    assert_eq!(loaded.save_id, save_id);
    assert_eq!(loaded.branch_id, main_branch);

    // Fork a new branch from round 1.
    let new_branch = create_branch(CreateBranchRequest {
        save: save_id,
        parent_branch: main_branch,
        parent_round: 1,
        name: "what-if-no-poland".into(),
    })
    .await
    .expect("create_branch");

    // The new branch should have exactly one snapshot at round 1.
    let new_snaps = list_snapshots(save_id, new_branch).await.expect("list_snapshots branch");
    assert_eq!(new_snaps.len(), 1);
    assert_eq!(new_snaps[0].round, 1);

    // Load from the new branch and verify branch_id was rewritten in the world JSON.
    let forked = load_snapshot(save_id, new_branch, 1).await.expect("load forked");
    assert_eq!(forked.branch_id, new_branch);
    assert_eq!(forked.save_id, save_id);

    // Add a snapshot on the new branch.
    let mut world = forked.clone();
    world.clock.round = 2;
    save_snapshot(world).await.expect("save on new branch");

    // Main branch still has exactly 3 snapshots — branch is isolated.
    let main_again = list_snapshots(save_id, main_branch).await.expect("re-list main");
    assert_eq!(main_again.len(), 3);
    let new_again = list_snapshots(save_id, new_branch).await.expect("re-list new");
    assert_eq!(new_again.len(), 2);

    // list_branches surfaces both.
    let branches = list_branches(save_id).await.expect("list_branches");
    assert_eq!(branches.len(), 2);
    assert!(branches.iter().any(|b| b.id == main_branch && b.parent_branch_id.is_none()));
    assert!(branches.iter().any(|b| b.id == new_branch && b.parent_round == Some(1)));

    // Cleanup.
    delete_save(save_id).await.expect("delete_save");
    let after = list_saves().await.expect("list");
    assert!(after.iter().all(|s| s.id != save_id));
}

#[tokio::test]
async fn load_missing_round_returns_not_found() {
    // Create a real save so its DB has the schema, then try a round that doesn't exist.
    let summary = create_save(CreateSaveRequest {
        name: "missing-round-test".into(),
        scenario_id: None,
        start_date: NaiveDate::from_ymd_opt(2025, 1, 1).unwrap(),
    })
    .await
    .expect("create_save");

    let res = load_snapshot(summary.id, summary.initial_branch_id, 99).await;
    assert!(res.is_err(), "expected NotFound for nonexistent round");

    delete_save(summary.id).await.expect("cleanup");
}
```

- [ ] **Step 2: Make modules public to the integration test**

Integration tests in `src-tauri/tests/*.rs` import the lib via the crate name (`alternate_history_demo_lib`). They can only see `pub` items. Verify these modules + items are `pub`:

- `world` module (already `pub` via `pub mod` in lib.rs — but `mod world;` is currently private). Change `mod world;` to `pub mod world;` in `src-tauri/src/lib.rs`. Same for `saves`, `world::ids`, `world::world`, and `saves::manager`/`snapshot` if needed.

Update `src-tauri/src/lib.rs` to re-export the needed surface:

```rust
#![allow(dead_code)]

mod commands;
mod config;
mod db;
pub mod error; // already may be pub; ensure
mod providers;
pub mod saves;
mod secrets;
pub mod world;
```

- [ ] **Step 3: Run integration test**

```
cd src-tauri && cargo test --test snapshot_round_trip
```

Expected: 2 passed. If any test fails, fix the manager/snapshot code, do NOT relax test assertions.

- [ ] **Step 4: Commit**

```
git add src-tauri/tests src-tauri/src/lib.rs
git commit -m "Plan 02: integration test for save/branch/snapshot round-trip"
```

---

## Task 14 — Final verification

**Files:**
- (none — verification step)

- [ ] **Step 1: Run full Rust test suite**

```
cd src-tauri && cargo test
```

Expected: all unit tests + the 2 new integration tests pass. Roughly: 14 (Plan 01) + ~16 (Plan 02 unit) + 2 (integration) = ~32 tests pass; 1 ignored (keyring).

- [ ] **Step 2: Verify frontend still builds**

```
cd .. && pnpm build
```

Expected: clean (no frontend changes in this plan, so it should be identical to Plan 01's frontend build).

- [ ] **Step 3: Push**

```
git push
```

---

## Plan 02 acceptance criteria

- [ ] All Rust unit tests pass (including all new world entity tests)
- [ ] `snapshot_round_trip` integration test passes
- [ ] `cargo check` is clean with no warnings
- [ ] `pnpm build` is clean
- [ ] No regressions in Plan 01 functionality
- [ ] Save files appear in OS app-data on save creation
- [ ] Snapshots survive process restart (manual smoke or test-implicit)
- [ ] Branch isolation verified by integration test

---

## Next plan

Plan 03 — **Map pipeline + static render**. Uses GADM data, produces a topojson asset, renders the world map on canvas with pan/zoom and ownership coloring. Once Plan 03 lands, we can populate `Province.geometry_ref` with real GADM ids and render a real world.
