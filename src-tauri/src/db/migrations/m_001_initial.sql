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
    parent_round INTEGER,
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
