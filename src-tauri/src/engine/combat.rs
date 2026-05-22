//! Deterministic combat resolution.
//!
//! When a `MoveUnit` lands in a province with enemy units, this module runs.
//! Formula: `power = strength × (org / 100) × doctrine_mod × tech_mod`.
//! Bucketed outcomes (decisive/win/stalemate/lose). Conquest happens when
//! the attacker wins AND no defenders remain.

use serde::{Deserialize, Serialize};

use crate::world::ids::{NationId, ProvinceId, UnitId};
use crate::world::nation::DoctrineId;
use crate::world::unit::Unit;
use crate::world::world::World;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum MovementOutcome {
    /// Moved peacefully into an empty/friendly province.
    Moved,
    /// Attacked, won, defending units destroyed, province ownership flipped.
    BattleWonConquered {
        defender_losses_pct: u8,
        attacker_losses_pct: u8,
        new_owner: NationId,
        previous_owner: NationId,
    },
    /// Attacked, won, but defenders survive in residual form (province still
    /// theirs). Happens when defenders had partial strength left after taking
    /// hits but no flip.
    BattleWon {
        defender_losses_pct: u8,
        attacker_losses_pct: u8,
    },
    /// Push repulsed; attacker remains at origin.
    Stalemate { both_losses_pct: u8 },
    /// Attacker repulsed and limps home with heavy losses.
    BattleLost {
        attacker_losses_pct: u8,
        defender_losses_pct: u8,
    },
    /// Validation failure — adjacency or ownership issue.
    Invalid { reason: String },
}

/// Move a unit. If the target province has hostile units, resolve combat.
/// `adjacency_of(province)` returns the list of geometry_refs adjacent to the
/// given province (looked up by `geometry_ref`); attempts to move >1 hop
/// return `Invalid`.
pub fn resolve_movement(
    world: &mut World,
    unit_id: UnitId,
    target_province_id: ProvinceId,
    adjacency_of: &dyn Fn(&str) -> Vec<String>,
) -> MovementOutcome {
    let Some(unit_idx) = world.units.iter().position(|u| u.id == unit_id) else {
        return MovementOutcome::Invalid {
            reason: format!("unit {} not found", unit_id),
        };
    };
    let unit_owner = world.units[unit_idx].owner;
    let from_pid = world.units[unit_idx].location;

    if from_pid == target_province_id {
        return MovementOutcome::Moved; // already there
    }

    // Adjacency check.
    let from_ref = match world.provinces.iter().find(|p| p.id == from_pid) {
        Some(p) => p.geometry_ref.clone(),
        None => {
            return MovementOutcome::Invalid {
                reason: "unit's origin province missing".into(),
            }
        }
    };
    let to_ref = match world.provinces.iter().find(|p| p.id == target_province_id) {
        Some(p) => p.geometry_ref.clone(),
        None => {
            return MovementOutcome::Invalid {
                reason: "target province missing".into(),
            }
        }
    };
    let neighbours = adjacency_of(&from_ref);
    if !neighbours.iter().any(|n| n == &to_ref) {
        return MovementOutcome::Invalid {
            reason: format!("{} not adjacent to {}", to_ref, from_ref),
        };
    }

    // Are there hostile defenders at target?
    let target_owner = world
        .provinces
        .iter()
        .find(|p| p.id == target_province_id)
        .map(|p| p.owner)
        .unwrap_or(unit_owner);

    let defender_idxs: Vec<usize> = world
        .units
        .iter()
        .enumerate()
        .filter(|(_, u)| u.location == target_province_id && u.owner != unit_owner)
        .map(|(i, _)| i)
        .collect();

    if defender_idxs.is_empty() {
        // Peaceful entry. Move the unit. If destination is enemy-owned and
        // unguarded, the province flips immediately.
        world.units[unit_idx].location = target_province_id;
        if target_owner != unit_owner {
            if let Some(p) = world
                .provinces
                .iter_mut()
                .find(|p| p.id == target_province_id)
            {
                p.owner = unit_owner;
            }
            return MovementOutcome::BattleWonConquered {
                defender_losses_pct: 0,
                attacker_losses_pct: 0,
                new_owner: unit_owner,
                previous_owner: target_owner,
            };
        }
        return MovementOutcome::Moved;
    }

    // Resolve battle.
    let attacker_nation = world
        .nations
        .iter()
        .find(|n| n.id == unit_owner)
        .cloned();
    let defender_nation_id = world.units[defender_idxs[0]].owner;
    let defender_nation = world
        .nations
        .iter()
        .find(|n| n.id == defender_nation_id)
        .cloned();

    let attacker_power = unit_power(&world.units[unit_idx], &attacker_nation);
    let defender_power: f64 = defender_idxs
        .iter()
        .map(|&i| unit_power(&world.units[i], &defender_nation))
        .sum();

    let ratio = if defender_power <= 0.0 {
        f64::INFINITY
    } else {
        attacker_power / defender_power
    };

    if ratio >= 1.5 {
        // Decisive — defenders crushed, attacker mild losses.
        let def_pct = 80;
        let atk_pct = 10;
        apply_losses(world, unit_idx, atk_pct);
        for &i in &defender_idxs {
            apply_losses(world, i, def_pct);
        }
        // Remove zero-strength units.
        cull_dead_units(world);

        // If no defenders remain, occupy + flip province.
        let any_defenders_left = world
            .units
            .iter()
            .any(|u| u.location == target_province_id && u.owner != unit_owner);
        if !any_defenders_left {
            // Move the attacker in.
            let atk_pos = world
                .units
                .iter()
                .position(|u| u.id == unit_id)
                .expect("attacker still alive after decisive win");
            world.units[atk_pos].location = target_province_id;
            if let Some(p) = world
                .provinces
                .iter_mut()
                .find(|p| p.id == target_province_id)
            {
                p.owner = unit_owner;
            }
            return MovementOutcome::BattleWonConquered {
                defender_losses_pct: def_pct,
                attacker_losses_pct: atk_pct,
                new_owner: unit_owner,
                previous_owner: target_owner,
            };
        }
        return MovementOutcome::BattleWon {
            defender_losses_pct: def_pct,
            attacker_losses_pct: atk_pct,
        };
    }

    if ratio >= 1.0 {
        let def_pct = 50;
        let atk_pct = 20;
        apply_losses(world, unit_idx, atk_pct);
        for &i in &defender_idxs {
            apply_losses(world, i, def_pct);
        }
        cull_dead_units(world);
        let any_defenders_left = world
            .units
            .iter()
            .any(|u| u.location == target_province_id && u.owner != unit_owner);
        if !any_defenders_left {
            if let Some(atk_pos) = world.units.iter().position(|u| u.id == unit_id) {
                world.units[atk_pos].location = target_province_id;
                if let Some(p) = world
                    .provinces
                    .iter_mut()
                    .find(|p| p.id == target_province_id)
                {
                    p.owner = unit_owner;
                }
                return MovementOutcome::BattleWonConquered {
                    defender_losses_pct: def_pct,
                    attacker_losses_pct: atk_pct,
                    new_owner: unit_owner,
                    previous_owner: target_owner,
                };
            }
        }
        return MovementOutcome::BattleWon {
            defender_losses_pct: def_pct,
            attacker_losses_pct: atk_pct,
        };
    }

    if ratio >= 0.7 {
        let both_pct = 25;
        apply_losses(world, unit_idx, both_pct);
        for &i in &defender_idxs {
            apply_losses(world, i, both_pct);
        }
        cull_dead_units(world);
        return MovementOutcome::Stalemate {
            both_losses_pct: both_pct,
        };
    }

    // Repulsed.
    let atk_pct = 50;
    let def_pct = 10;
    apply_losses(world, unit_idx, atk_pct);
    for &i in &defender_idxs {
        apply_losses(world, i, def_pct);
    }
    cull_dead_units(world);
    MovementOutcome::BattleLost {
        attacker_losses_pct: atk_pct,
        defender_losses_pct: def_pct,
    }
}

fn unit_power(unit: &Unit, owner: &Option<crate::world::nation::Nation>) -> f64 {
    let base = unit.strength as f64;
    let org_mod = (unit.organization as f64 / 100.0).max(0.1);
    let doctrine_mod = match owner.as_ref().map(|n| n.doctrine) {
        Some(DoctrineId::MobileWarfare) => 1.15,
        Some(DoctrineId::DefenseInDepth) => 1.05,
        Some(DoctrineId::MassAssault) => 1.10,
        Some(DoctrineId::SuperiorFirepower) => 1.08,
        None => 1.0,
    };
    let tech_mod = owner
        .as_ref()
        .map(|n| 0.9 + (n.tech.0 as f64 * 0.04))
        .unwrap_or(1.0);
    base * org_mod * doctrine_mod * tech_mod
}

fn apply_losses(world: &mut World, idx: usize, pct: u8) {
    let u = &mut world.units[idx];
    let retain = (100u32.saturating_sub(pct as u32)) as f64 / 100.0;
    u.strength = (u.strength as f64 * retain) as u32;
    // Organization takes a beating too; reduce by twice the strength %.
    let org_retain = (1.0 - (pct as f64 * 2.0 / 100.0)).max(0.0);
    u.organization = (u.organization as f64 * org_retain) as u32;
}

fn cull_dead_units(world: &mut World) {
    world.units.retain(|u| u.strength >= 5);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::{BranchId, SaveId, UnitId};
    use crate::world::nation::UnitType;
    use crate::world::scenario::build_modern_world;
    use crate::world::unit::SupplyState;
    use chrono::NaiveDate;

    fn world_with_two_nations() -> World {
        build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        )
    }

    fn spawn(world: &mut World, owner: NationId, province: ProvinceId, strength: u32) -> UnitId {
        let id = UnitId::new();
        world.units.push(Unit {
            id,
            owner,
            unit_type: UnitType::Infantry,
            location: province,
            strength,
            organization: 100,
            experience: 0,
            supply_state: SupplyState::Supplied,
        });
        id
    }

    #[test]
    fn moves_into_friendly_empty_adjacent_province() {
        let mut w = world_with_two_nations();
        // Pick a nation guaranteed to have at least 2 provinces (USA = 51).
        let n = w.nations.iter().find(|n| n.iso_a3 == "USA").unwrap().id;
        let p0 = w.provinces.iter().find(|p| p.owner == n).unwrap().id;
        let p1 = w.provinces.iter().find(|p| p.owner == n && p.id != p0).unwrap().id;
        let u = spawn(&mut w, n, p0, 100);
        let p0_ref = w.provinces.iter().find(|p| p.id == p0).unwrap().geometry_ref.clone();
        let p1_ref = w.provinces.iter().find(|p| p.id == p1).unwrap().geometry_ref.clone();
        let adj = |s: &str| -> Vec<String> {
            if s == p0_ref { vec![p1_ref.clone()] } else { vec![p0_ref.clone()] }
        };
        let out = resolve_movement(&mut w, u, p1, &adj);
        match out {
            MovementOutcome::Moved => (),
            other => panic!("expected Moved, got {:?}", other),
        }
        assert_eq!(w.units[0].location, p1);
    }

    #[test]
    fn unguarded_enemy_province_is_conquered() {
        let mut w = world_with_two_nations();
        let attacker = w.nations[0].id;
        let target_owner = w.nations[1].id;
        let p_atk = w.provinces.iter().find(|p| p.owner == attacker).unwrap().id;
        let p_tgt = w.provinces.iter().find(|p| p.owner == target_owner).unwrap().id;
        let u = spawn(&mut w, attacker, p_atk, 100);
        let r_atk = w.provinces.iter().find(|p| p.id == p_atk).unwrap().geometry_ref.clone();
        let r_tgt = w.provinces.iter().find(|p| p.id == p_tgt).unwrap().geometry_ref.clone();
        let adj = |s: &str| -> Vec<String> {
            if s == r_atk { vec![r_tgt.clone()] } else { vec![r_atk.clone()] }
        };
        let out = resolve_movement(&mut w, u, p_tgt, &adj);
        assert!(matches!(out, MovementOutcome::BattleWonConquered { .. }));
        assert_eq!(
            w.provinces.iter().find(|p| p.id == p_tgt).unwrap().owner,
            attacker
        );
    }

    #[test]
    fn rejects_non_adjacent_move() {
        let mut w = world_with_two_nations();
        let n = w.nations.iter().find(|n| n.iso_a3 == "USA").unwrap().id;
        let p0 = w.provinces.iter().find(|p| p.owner == n).unwrap().id;
        let p1 = w.provinces.iter().find(|p| p.owner == n && p.id != p0).unwrap().id;
        let u = spawn(&mut w, n, p0, 100);
        let adj = |_s: &str| -> Vec<String> { Vec::new() };
        let out = resolve_movement(&mut w, u, p1, &adj);
        assert!(matches!(out, MovementOutcome::Invalid { .. }));
    }

    #[test]
    fn overwhelming_force_crushes_defender() {
        let mut w = world_with_two_nations();
        let attacker = w.nations[0].id;
        let defender = w.nations[1].id;
        let p_atk = w.provinces.iter().find(|p| p.owner == attacker).unwrap().id;
        let p_tgt = w.provinces.iter().find(|p| p.owner == defender).unwrap().id;
        // Decisive win = defender -80%. Defender at 20 strength → 4 after
        // the hit, falls below the 5-strength cull threshold → no defenders
        // remain → conquest.
        let _a = spawn(&mut w, attacker, p_atk, 500);
        let _d = spawn(&mut w, defender, p_tgt, 20);
        let r_atk = w.provinces.iter().find(|p| p.id == p_atk).unwrap().geometry_ref.clone();
        let r_tgt = w.provinces.iter().find(|p| p.id == p_tgt).unwrap().geometry_ref.clone();
        let adj = |s: &str| -> Vec<String> {
            if s == r_atk { vec![r_tgt.clone()] } else { vec![r_atk.clone()] }
        };
        let attacker_id = w.units[0].id;
        let out = resolve_movement(&mut w, attacker_id, p_tgt, &adj);
        assert!(matches!(out, MovementOutcome::BattleWonConquered { .. }));
    }
}
