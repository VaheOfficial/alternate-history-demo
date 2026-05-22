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
    let save_id = world.save_id;
    let branch_id = world.branch_id;
    let round = world.clock.round as i64;
    let date = world.clock.current_date.to_string();
    let json = serde_json::to_string(&world)?;

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
        let mut world = serde_json::from_str::<World>(&json)?;
        // Auto-refresh stale Nation stats from canonical countries.json if
        // they look like the old prov_count*2M placeholder. Province
        // ownership, goals, events, treaties are preserved.
        crate::world::migration::migrate_stale_stats(&mut world);
        Ok(world)
    })
    .await
    .map_err(|e| AppError::InvalidArgument(format!("join: {}", e)))?
}

pub async fn list_snapshots(save: SaveId, branch: BranchId) -> Result<Vec<SnapshotMeta>> {
    tokio::task::spawn_blocking(move || -> Result<Vec<SnapshotMeta>> {
        let conn = open_save_db(save.0)?;
        let mut stmt = conn
            .prepare(
                "SELECT round, game_date FROM snapshots
                 WHERE save_id = ?1 AND branch_id = ?2 ORDER BY round ASC",
            )
            .map_err(rusqlite_err)?;
        let rows = stmt
            .query_map(
                params![save.to_string(), branch.to_string()],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(rusqlite_err)?;
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
