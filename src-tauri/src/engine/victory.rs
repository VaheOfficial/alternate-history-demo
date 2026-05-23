//! Victory condition checker (Plan 12 Phase 6).
//!
//! Runs after every `end_turn_cmd`. Computes the player's current
//! progress and, if any end-condition has fired, sets
//! `world.victory = Some(...)`. The UI then renders a victory modal
//! and replaces the End Turn button with "Show Chronicle"
//! (placeholder for Plan 15).

use chrono::NaiveDate;
use serde::Serialize;

use crate::world::treaty::TreatyKind;
use crate::world::victory::{Victory, VictoryKind};
use crate::world::world::World;

/// Threshold (percent of world total) for the Hegemon path. Both
/// population AND industry must meet this.
const HEGEMON_PCT: f64 = 60.0;

/// Universal Empire only counts "real" nations as opposition — sub-10M
/// micro-states / dependencies don't need to be vassalized.
const UNIVERSAL_EMPIRE_MIN_POP: i64 = 10_000_000;

/// Save-civ-as-survivor cutoff. Reaching this date with the player
/// alive is itself an ending.
fn survivor_cutoff() -> NaiveDate {
    NaiveDate::from_ymd_opt(2050, 1, 1).expect("2050-01-01 valid")
}

#[derive(Debug, Clone, Serialize)]
pub struct VictoryProgress {
    /// Player share of total world population, 0.0..=100.0.
    pub pop_pct: f64,
    /// Player share of total world industry, 0.0..=100.0.
    pub ind_pct: f64,
    /// Count of independent rival nations (pop >= UNIVERSAL_EMPIRE_MIN_POP,
    /// not the player, not vassalized to the player).
    pub remaining_rivals: u32,
    /// Days until the Survivor cutoff. 0 means today/past.
    pub days_to_2050: i64,
}

/// Compute the player's progress toward each ending, regardless of
/// whether a victory has already fired. Used by the HudTopBar chip so
/// the player can see how close they are.
pub fn compute_progress(world: &World) -> VictoryProgress {
    let player_id = match world.player_nation {
        Some(id) => id,
        None => {
            return VictoryProgress {
                pop_pct: 0.0,
                ind_pct: 0.0,
                remaining_rivals: 0,
                days_to_2050: (survivor_cutoff() - world.clock.current_date).num_days().max(0),
            }
        }
    };

    let mut player_pop: i64 = 0;
    let mut player_ind: u64 = 0;
    let mut total_pop: i64 = 0;
    let mut total_ind: u64 = 0;
    let mut remaining_rivals: u32 = 0;

    let vassal_of_player: std::collections::HashSet<crate::world::ids::NationId> =
        world
            .treaties
            .iter()
            .filter(|t| matches!(t.kind, TreatyKind::Vassalage))
            .filter(|t| t.parties.first() == Some(&player_id))
            .flat_map(|t| t.parties.iter().skip(1).copied())
            .collect();

    for n in &world.nations {
        total_pop = total_pop.saturating_add(n.population);
        total_ind = total_ind.saturating_add(n.industry_capacity as u64);
        if n.id == player_id {
            player_pop = n.population;
            player_ind = n.industry_capacity as u64;
        } else if n.population >= UNIVERSAL_EMPIRE_MIN_POP
            && !vassal_of_player.contains(&n.id)
        {
            remaining_rivals += 1;
        }
    }

    let pop_pct = if total_pop > 0 {
        (player_pop as f64) * 100.0 / (total_pop as f64)
    } else {
        0.0
    };
    let ind_pct = if total_ind > 0 {
        (player_ind as f64) * 100.0 / (total_ind as f64)
    } else {
        0.0
    };

    VictoryProgress {
        pop_pct,
        ind_pct,
        remaining_rivals,
        days_to_2050: (survivor_cutoff() - world.clock.current_date).num_days().max(0),
    }
}

/// Check whether an end-condition has fired and, if so, stamp
/// `world.victory`. Idempotent — does nothing if `world.victory` is
/// already set. Called from `end_turn_cmd`.
pub fn check_victory(world: &mut World) {
    if world.victory.is_some() {
        return;
    }
    let progress = compute_progress(world);

    // 1. Universal Empire — strongest condition, check first.
    if world.player_nation.is_some() && progress.remaining_rivals == 0 {
        // Make sure the player actually exists (we can have an empty
        // world during tests with player_nation set).
        if world.nations.iter().any(|n| Some(n.id) == world.player_nation) {
            let player_name = world
                .nations
                .iter()
                .find(|n| Some(n.id) == world.player_nation)
                .map(|n| n.name.clone())
                .unwrap_or_else(|| "The player".into());
            world.victory = Some(Victory {
                kind: VictoryKind::UniversalEmpire,
                triggered_on: world.clock.current_date,
                headline: format!("{} — Universal Empire", player_name),
                summary: format!(
                    "Every other major power has either been annexed or sworn vassalage to {}. \
                     History will remember this as the moment a single state encompassed the world.",
                    player_name,
                ),
            });
            return;
        }
    }

    // 2. Hegemon — > 60% of pop AND industry.
    if progress.pop_pct >= HEGEMON_PCT && progress.ind_pct >= HEGEMON_PCT {
        let player_name = world
            .nations
            .iter()
            .find(|n| Some(n.id) == world.player_nation)
            .map(|n| n.name.clone())
            .unwrap_or_else(|| "The player".into());
        world.victory = Some(Victory {
            kind: VictoryKind::Hegemon,
            triggered_on: world.clock.current_date,
            headline: format!("{} — Global Hegemon", player_name),
            summary: format!(
                "{} now controls {:.0}% of the world's population and {:.0}% of its industry. \
                 The unipolar moment belongs to one capital.",
                player_name, progress.pop_pct, progress.ind_pct,
            ),
        });
        return;
    }

    // 3. Survivor — reached 2050.
    if world.clock.current_date >= survivor_cutoff() {
        let player_name = world
            .nations
            .iter()
            .find(|n| Some(n.id) == world.player_nation)
            .map(|n| n.name.clone())
            .unwrap_or_else(|| "The player".into());
        world.victory = Some(Victory {
            kind: VictoryKind::Survivor,
            triggered_on: world.clock.current_date,
            headline: format!("{} — Endured", player_name),
            summary: format!(
                "The world reached 2050 with {} still standing as a sovereign power. \
                 Whether by force, diplomacy, or stubborn luck, the run endured to the era's close.",
                player_name,
            ),
        });
    }
}

/// Mark the run concluded by player choice. Public so the Tauri
/// command can call it directly without going through the auto-check.
pub fn mark_concluded(world: &mut World) {
    if world.victory.is_some() {
        return;
    }
    let player_name = world
        .nations
        .iter()
        .find(|n| Some(n.id) == world.player_nation)
        .map(|n| n.name.clone())
        .unwrap_or_else(|| "The player".into());
    world.victory = Some(Victory {
        kind: VictoryKind::Concluded,
        triggered_on: world.clock.current_date,
        headline: format!("{} — Run Concluded", player_name),
        summary:
            "The player chose to wrap up the run. The world continues as it stood at this date."
                .into(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::{BranchId, SaveId};
    use crate::world::scenario::build_modern_world;

    fn world_with_usa_as_player() -> World {
        let mut w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let usa_id = w.nations.iter().find(|n| n.iso_a3 == "USA").unwrap().id;
        w.player_nation = Some(usa_id);
        w
    }

    #[test]
    fn fresh_world_has_no_victory() {
        let mut w = world_with_usa_as_player();
        check_victory(&mut w);
        assert!(w.victory.is_none());
    }

    #[test]
    fn hegemon_fires_when_pop_and_industry_dominant() {
        let mut w = world_with_usa_as_player();
        // Crank the player's stats high enough to cross 60% by zeroing
        // every other nation's pop/industry.
        let player = w.player_nation.unwrap();
        for n in &mut w.nations {
            if n.id != player {
                n.population = 0;
                n.industry_capacity = 0;
            }
        }
        check_victory(&mut w);
        assert!(matches!(
            w.victory.as_ref().map(|v| v.kind),
            Some(VictoryKind::Hegemon | VictoryKind::UniversalEmpire)
        ));
    }

    #[test]
    fn mark_concluded_stamps_the_world() {
        let mut w = world_with_usa_as_player();
        mark_concluded(&mut w);
        assert!(matches!(
            w.victory.as_ref().map(|v| v.kind),
            Some(VictoryKind::Concluded)
        ));
    }

    #[test]
    fn already_set_victory_is_not_overwritten() {
        let mut w = world_with_usa_as_player();
        mark_concluded(&mut w);
        let before = w.victory.clone();
        check_victory(&mut w);
        assert_eq!(
            w.victory.as_ref().map(|v| v.kind),
            before.as_ref().map(|v| v.kind)
        );
    }

    #[test]
    fn survivor_fires_at_2050() {
        let mut w = world_with_usa_as_player();
        w.clock.current_date = NaiveDate::from_ymd_opt(2050, 1, 1).unwrap();
        check_victory(&mut w);
        assert!(matches!(
            w.victory.as_ref().map(|v| v.kind),
            Some(VictoryKind::Survivor | VictoryKind::Hegemon | VictoryKind::UniversalEmpire)
        ));
    }
}
