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
        let mut stmt = conn
            .prepare(
                "SELECT id, save_id, parent_branch_id, parent_round, name, created_at
                 FROM branches WHERE save_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(rusqlite_err)?;
        let rows = stmt
            .query_map(params![save.to_string()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(rusqlite_err)?;
        let mut out = Vec::new();
        for r in rows {
            let (id_s, save_s, parent_id, parent_round, name, created) =
                r.map_err(rusqlite_err)?;
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
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM snapshots WHERE save_id = ?1 AND branch_id = ?2 AND round = ?3",
                params![save.to_string(), parent.to_string(), parent_round as i64],
                |row| row.get(0),
            )
            .map_err(rusqlite_err)?;
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
        let json: String = {
            let mut stmt = tx
                .prepare(
                    "SELECT world_json FROM snapshots
                     WHERE save_id = ?1 AND branch_id = ?2 AND round = ?3",
                )
                .map_err(rusqlite_err)?;
            stmt.query_row(
                params![save.to_string(), new_branch.to_string(), parent_round as i64],
                |row| row.get(0),
            )
            .map_err(rusqlite_err)?
        };
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

fn read_summary(conn: &rusqlite::Connection, id: SaveId) -> Result<Option<SaveSummary>> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.name, s.scenario_id, s.created_at, s.last_played_at,
                    (SELECT id FROM branches WHERE save_id = s.id AND parent_branch_id IS NULL LIMIT 1)
             FROM saves s WHERE s.id = ?1",
        )
        .map_err(rusqlite_err)?;
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
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.name, s.scenario_id, s.created_at, s.last_played_at,
                    (SELECT id FROM branches WHERE save_id = s.id AND parent_branch_id IS NULL LIMIT 1)
             FROM saves s",
        )
        .map_err(rusqlite_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(rusqlite_err)?;

    let mut out = Vec::new();
    for r in rows {
        let (id_s, name, scenario_id, created, last, initial) = r.map_err(rusqlite_err)?;
        let initial = match initial {
            Some(b) => b,
            None => continue,
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
