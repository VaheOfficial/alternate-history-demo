use chrono::NaiveDate;

use alternate_history_demo_lib::saves::manager::{
    create_branch, create_save, delete_save, list_branches, list_saves, CreateBranchRequest,
    CreateSaveRequest,
};
use alternate_history_demo_lib::saves::snapshot::{list_snapshots, load_snapshot, save_snapshot};
use alternate_history_demo_lib::world::World;

#[tokio::test]
async fn full_save_branch_snapshot_round_trip() {
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

    let snaps = list_snapshots(save_id, main_branch)
        .await
        .expect("list_snapshots");
    assert_eq!(snaps.len(), 3);

    // Load round 1.
    let loaded = load_snapshot(save_id, main_branch, 1)
        .await
        .expect("load_snapshot");
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
    let new_snaps = list_snapshots(save_id, new_branch)
        .await
        .expect("list_snapshots branch");
    assert_eq!(new_snaps.len(), 1);
    assert_eq!(new_snaps[0].round, 1);

    // Load from new branch — verify branch_id rewritten inside JSON.
    let forked = load_snapshot(save_id, new_branch, 1)
        .await
        .expect("load forked");
    assert_eq!(forked.branch_id, new_branch);
    assert_eq!(forked.save_id, save_id);

    // Add a snapshot on the new branch.
    let mut world = forked.clone();
    world.clock.round = 2;
    save_snapshot(world).await.expect("save on new branch");

    // Main branch still has 3 snapshots — branches are isolated.
    let main_again = list_snapshots(save_id, main_branch)
        .await
        .expect("re-list main");
    assert_eq!(main_again.len(), 3);
    let new_again = list_snapshots(save_id, new_branch)
        .await
        .expect("re-list new");
    assert_eq!(new_again.len(), 2);

    // list_branches surfaces both.
    let branches = list_branches(save_id).await.expect("list_branches");
    assert_eq!(branches.len(), 2);
    assert!(branches
        .iter()
        .any(|b| b.id == main_branch && b.parent_branch_id.is_none()));
    assert!(branches
        .iter()
        .any(|b| b.id == new_branch && b.parent_round == Some(1)));

    // Cleanup.
    delete_save(save_id).await.expect("delete_save");
    let after = list_saves().await.expect("list");
    assert!(after.iter().all(|s| s.id != save_id));
}

#[tokio::test]
async fn load_missing_round_returns_not_found() {
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
