use chrono::NaiveDate;
use serde::Serialize;

use crate::error::{AppError, Result};
use crate::saves::manager::{
    create_branch, create_save, delete_save, list_branches, list_saves, BranchSummary,
    CreateBranchRequest, CreateSaveRequest, SaveSummary,
};
use crate::saves::snapshot::{list_snapshots, load_snapshot, save_snapshot, SnapshotMeta};
use crate::world::ids::{BranchId, SaveId};
use crate::world::scenario::build_modern_world;
use crate::world::world::World;

#[derive(Debug, Serialize)]
pub struct ModernSaveBootstrap {
    pub save: SaveSummary,
    pub world: World,
}

#[tauri::command]
pub async fn create_save_cmd(
    name: String,
    scenario_id: Option<String>,
    start_date: String,
) -> Result<SaveSummary> {
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| AppError::InvalidArgument(format!("bad start_date: {}", e)))?;
    create_save(CreateSaveRequest {
        name,
        scenario_id,
        start_date: start,
    })
    .await
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
pub async fn load_snapshot_cmd(save: SaveId, branch: BranchId, round: u32) -> Result<World> {
    load_snapshot(save, branch, round).await
}

#[tauri::command]
pub async fn list_snapshots_cmd(
    save: SaveId,
    branch: BranchId,
) -> Result<Vec<SnapshotMeta>> {
    list_snapshots(save, branch).await
}

/// Bootstrap a "Modern Day" game in one call: create the save row, build the
/// initial World from Natural Earth data, and persist the round-0 snapshot.
/// Returns both the SaveSummary (with the canonical initial branch_id) and
/// the constructed World so the frontend can render immediately.
#[tauri::command]
pub async fn create_modern_day_save_cmd(name: String) -> Result<ModernSaveBootstrap> {
    let start = chrono::Local::now().date_naive();
    let summary = create_save(CreateSaveRequest {
        name,
        scenario_id: Some("modern_day".into()),
        start_date: start,
    })
    .await?;

    let mut world = build_modern_world(summary.id, summary.initial_branch_id, start);
    world.save_id = summary.id;
    world.branch_id = summary.initial_branch_id;
    save_snapshot(world.clone()).await?;

    Ok(ModernSaveBootstrap {
        save: summary,
        world,
    })
}
