//! Spy mission resolution (Plan 12 Phase 5).
//!
//! At end_turn, resolve every mission whose `resolves_on` is in the
//! past. Deterministic seeded RNG based on the world clock + mission
//! id so outcomes are reproducible across save/load and survive
//! re-running the same turn.

use crate::world::spy::{SpyMission, SpyMissionKind, SpyOutcome};
use crate::world::tech::TechId;
use crate::world::world::World;

/// Tick missions: resolve any whose deadline has passed.
pub fn tick_spy(world: &mut World) {
    let today = world.clock.current_date;
    let len = world.spy_missions.len();
    let mut to_apply: Vec<usize> = Vec::new();
    for i in 0..len {
        let m = &world.spy_missions[i];
        if m.resolved {
            continue;
        }
        if today < m.resolves_on {
            continue;
        }
        to_apply.push(i);
    }
    for i in to_apply {
        resolve_mission(world, i);
    }
}

fn resolve_mission(world: &mut World, idx: usize) {
    let snapshot = world.spy_missions[idx].clone();
    let success = roll_success(&snapshot);

    let outcome = if success {
        apply_success(world, &snapshot)
    } else {
        apply_failure(&snapshot)
    };

    let m = &mut world.spy_missions[idx];
    m.resolved = true;
    m.outcome = Some(outcome);
}

fn roll_success(m: &SpyMission) -> bool {
    // Deterministic hash of mission id + resolves_on to pick a 0..99
    // value, compared to success_pct. Same input always yields same
    // result.
    let mut seed: u64 = 0xCBF29CE484222325;
    for b in m.id.as_bytes() {
        seed ^= *b as u64;
        seed = seed.wrapping_mul(0x100000001B3);
    }
    seed ^= m.resolves_on.format("%Y-%m-%d").to_string().as_bytes().iter().fold(
        0u64,
        |acc, b| {
            let mut a = acc ^ *b as u64;
            a = a.wrapping_mul(0x100000001B3);
            a
        },
    );
    let roll = (seed % 100) as u8;
    roll < m.success_pct
}

fn apply_success(world: &mut World, mission: &SpyMission) -> SpyOutcome {
    let target_name = world
        .nations
        .iter()
        .find(|n| n.id == mission.target)
        .map(|n| n.name.clone())
        .unwrap_or_else(|| "the target".into());
    match mission.kind {
        SpyMissionKind::StealTech => {
            let Some(player) = world.player_nation else {
                return SpyOutcome::Failure {
                    narrative: "Player nation missing; mission lost.".into(),
                };
            };
            let tech = mission.tech_target.unwrap_or(TechId::Encryption);
            if let Some(n) = world.nations.iter_mut().find(|n| n.id == player) {
                let bonus = tech.cost() / 2;
                let cur = n.research.progress.get(&tech).copied().unwrap_or(0);
                let next = (cur + bonus).min(tech.cost());
                n.research.progress.insert(tech, next);
            }
            SpyOutcome::Success {
                narrative: format!(
                    "Our agents successfully extracted {} research data from {}. +{} research points applied.",
                    tech.label(),
                    target_name,
                    tech.cost() / 2,
                ),
            }
        }
        SpyMissionKind::SabotageIndustry => {
            if let Some(n) = world.nations.iter_mut().find(|n| n.id == mission.target) {
                n.industry_capacity = n.industry_capacity.saturating_sub(5);
            }
            SpyOutcome::Success {
                narrative: format!(
                    "Industrial sabotage in {}: production lines damaged, -5 IC. The press attributes the explosion to a 'gas leak'.",
                    target_name,
                ),
            }
        }
        SpyMissionKind::GatherIntel => SpyOutcome::Success {
            narrative: format!(
                "Comprehensive intelligence report on {} delivered. Force composition, doctrine, and political tensions all detailed.",
                target_name,
            ),
        },
    }
}

fn apply_failure(mission: &SpyMission) -> SpyOutcome {
    SpyOutcome::Failure {
        narrative: format!(
            "Mission ({}) was uncovered before completion. No assets recovered; counter-intelligence in the target is now elevated.",
            mission.kind.label(),
        ),
    }
}
