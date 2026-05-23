//! Apply typed actions to the world.
//!
//! Each `TypedAction` is independently applied; failures are collected per
//! action so the caller can show which ones the validator accepted but the
//! engine couldn't apply (e.g. unit not found).
//!
//! Plan 04 Phase C handles the most common diplomatic / governance actions
//! deterministically. Combat application lands in Plan 05.

use serde::Serialize;

use crate::engine::combat::resolve_movement;
use crate::world::action::TypedAction;
use crate::world::event::{Event, EventCategory, Visibility};
use crate::world::ids::EventId;
use crate::world::treaty::{Treaty, TreatyTerms};
use crate::world::unit::{SupplyState, Unit};
use crate::world::world::World;

#[derive(Debug, Clone, Serialize)]
pub struct ApplyOutcome {
    pub world: World,
    pub applied: Vec<TypedAction>,
    pub failures: Vec<ApplyFailure>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyFailure {
    pub action: TypedAction,
    pub reason: String,
}

/// Apply a sequence of typed actions to a world, returning the new world plus
/// per-action acceptance. A failure on action N does NOT prevent N+1 from
/// being attempted — the validator is responsible for narrative consistency,
/// the engine just enforces invariants.
///
/// `adjacency` is an optional lookup `geometry_ref -> list of neighbours`.
/// Required for MoveUnit; without it, movement actions are rejected.
pub fn apply_actions(
    mut world: World,
    actions: Vec<TypedAction>,
    narrative: Option<String>,
    adjacency: Option<&std::collections::HashMap<String, Vec<String>>>,
) -> ApplyOutcome {
    let mut applied = Vec::new();
    let mut failures = Vec::new();

    for action in actions {
        match apply_one(&mut world, &action, adjacency) {
            Ok(()) => applied.push(action),
            Err(reason) => failures.push(ApplyFailure { action, reason }),
        }
    }

    // Stamp a single Event capturing this turn's narrative + the typed
    // actions that succeeded. Events are the persistent record of "what
    // happened" — the action log UI reads these.
    if !applied.is_empty() || narrative.is_some() {
        world.events.push(Event {
            id: EventId::new(),
            round: world.clock.round,
            timestamp: world.clock.current_date,
            category: EventCategory::Political,
            headline: synthesize_headline(&applied),
            narrative: narrative.unwrap_or_else(|| "(no narrative)".into()),
            typed_actions: applied.clone(),
            visibility: Visibility::Global,
            embedding: None,
            interrupts_player: false,
        });
    }

    ApplyOutcome {
        world,
        applied,
        failures,
    }
}

fn apply_one(
    world: &mut World,
    action: &TypedAction,
    adjacency: Option<&std::collections::HashMap<String, Vec<String>>>,
) -> Result<(), String> {
    match action {
        TypedAction::ModifyRelation {
            from,
            to,
            delta,
            reason: _,
        } => {
            let from_idx = world
                .nations
                .iter()
                .position(|n| n.id == *from)
                .ok_or_else(|| format!("from nation {} not found", from))?;
            world.nations.iter().position(|n| n.id == *to)
                .ok_or_else(|| format!("to nation {} not found", to))?;
            let nation = &mut world.nations[from_idx];
            let cur = nation.relations.get(to).copied().unwrap_or(0);
            nation
                .relations
                .insert(*to, (cur + delta).clamp(-100, 100));
            Ok(())
        }
        TypedAction::ModifyStability { nation, delta } => {
            let n = world
                .nations
                .iter_mut()
                .find(|n| n.id == *nation)
                .ok_or_else(|| format!("nation {} not found", nation))?;
            n.stability = (n.stability + delta).clamp(-100, 100);
            Ok(())
        }
        TypedAction::ModifyResource {
            nation,
            resource,
            delta,
        } => {
            let n = world
                .nations
                .iter_mut()
                .find(|n| n.id == *nation)
                .ok_or_else(|| format!("nation {} not found", nation))?;
            use crate::world::nation::Resource;
            match resource {
                Resource::Steel => n.resources.steel = (n.resources.steel + delta).max(0),
                Resource::Oil => n.resources.oil = (n.resources.oil + delta).max(0),
                Resource::Rubber => {
                    n.resources.rubber = (n.resources.rubber + delta).max(0)
                }
                Resource::Tungsten => {
                    n.resources.tungsten = (n.resources.tungsten + delta).max(0)
                }
            }
            Ok(())
        }
        TypedAction::ChangeGovernment {
            nation,
            new_form,
            mechanism: _,
        } => {
            let n = world
                .nations
                .iter_mut()
                .find(|n| n.id == *nation)
                .ok_or_else(|| format!("nation {} not found", nation))?;
            n.government = *new_form;
            Ok(())
        }
        TypedAction::TransferTerritory {
            from,
            to,
            provinces,
            mechanism: _,
        } => {
            if !world.nations.iter().any(|n| n.id == *from) {
                return Err(format!("from nation {} not found", from));
            }
            if !world.nations.iter().any(|n| n.id == *to) {
                return Err(format!("to nation {} not found", to));
            }
            let mut moved = 0usize;
            for pid in provinces {
                if let Some(p) = world.provinces.iter_mut().find(|p| p.id == *pid) {
                    if p.owner == *from {
                        p.owner = *to;
                        moved += 1;
                    }
                }
            }
            if moved == 0 {
                return Err("no matching provinces transferred".into());
            }
            Ok(())
        }
        TypedAction::DeclareWar {
            aggressor,
            target,
            justification: _,
            casus_belli,
        } => {
            // Relations to -100 both ways (the existing peacetime-guard
            // in combat.rs checks <= -90).
            for (a, b) in [(aggressor, target), (target, aggressor)] {
                if let Some(n) = world.nations.iter_mut().find(|n| n.id == *a) {
                    n.relations.insert(*b, -100);
                }
            }

            // Plan 12 Phase 3 — Military faction loves war declarations
            // on the aggressor side; Business + Populist drift unhappy.
            apply_faction_shift(world, *aggressor, &[
                (crate::world::faction::FactionArchetype::Military, 8),
                (crate::world::faction::FactionArchetype::Business, -5),
                (crate::world::faction::FactionArchetype::Populist, -3),
            ]);
            // The defender's people rally around the flag — Military +
            // Populist satisfaction goes UP (defensive war), Business
            // down (markets).
            apply_faction_shift(world, *target, &[
                (crate::world::faction::FactionArchetype::Military, 5),
                (crate::world::faction::FactionArchetype::Populist, 4),
                (crate::world::faction::FactionArchetype::Business, -4),
            ]);

            // Plan 12 Phase 1: record the War on the world. If there's
            // already an active War record between the same parties,
            // don't duplicate.
            let already_active = world.wars.iter().any(|w| {
                matches!(w.status, crate::world::war::WarStatus::Active)
                    && w.aggressor == *aggressor
                    && w.defenders.contains(target)
            });
            if !already_active {
                let cb = casus_belli.unwrap_or(crate::world::war::CasusBelli::HumiliateRival);
                world.wars.push(crate::world::war::War {
                    id: uuid::Uuid::new_v4().to_string(),
                    aggressor: *aggressor,
                    defenders: vec![*target],
                    declared_on: world.clock.current_date,
                    casus_belli: cb,
                    occupation_pct: 0,
                    conquered_provinces: Vec::new(),
                    status: crate::world::war::WarStatus::Active,
                    peace_proposals: Vec::new(),
                });
            }
            Ok(())
        }
        TypedAction::SignTreaty {
            parties,
            kind,
            terms,
        } => {
            for p in parties {
                if !world.nations.iter().any(|n| n.id == *p) {
                    return Err(format!("party nation {} not found", p));
                }
            }
            world.treaties.push(Treaty {
                id: crate::world::ids::TreatyId::new(),
                kind: *kind,
                parties: parties.clone(),
                signed_on: world.clock.current_date,
                expires_on: None,
                terms: TreatyTerms {
                    territory_transfers: terms.territory_transfers.clone(),
                    tribute_per_year: terms.tribute_per_year,
                    extra_clauses: terms.extra_clauses.clone(),
                },
            });

            // Plan 12 Phase 3 — faction reactions to treaty kind.
            use crate::world::faction::FactionArchetype as A;
            use crate::world::treaty::TreatyKind as TK;
            let shifts: &[(A, i8)] = match kind {
                TK::TradeAgreement => {
                    &[(A::Business, 8), (A::Populist, 3)]
                }
                TK::DefensivePact | TK::Alliance => {
                    &[(A::Military, 6), (A::Business, 3)]
                }
                TK::PeaceTreaty | TK::Ceasefire => {
                    &[(A::Populist, 6), (A::Business, 5), (A::Military, -4)]
                }
                TK::NonAggression => &[(A::Business, 4)],
                TK::Vassalage => &[(A::Military, 6), (A::Populist, -5)],
            };
            for p in parties {
                apply_faction_shift(world, *p, shifts);
            }
            Ok(())
        }
        TypedAction::SpawnUnit {
            owner,
            unit_type,
            location,
            strength,
        } => {
            if !world.nations.iter().any(|n| n.id == *owner) {
                return Err(format!("spawn: owner {} not found", owner));
            }
            if !world.provinces.iter().any(|p| p.id == *location) {
                return Err(format!("spawn: province {} not found", location));
            }
            world.units.push(Unit {
                id: crate::world::ids::UnitId::new(),
                owner: *owner,
                unit_type: *unit_type,
                location: *location,
                strength: (*strength).clamp(1, 1000),
                organization: 80,
                experience: 0,
                supply_state: SupplyState::Supplied,
            });
            Ok(())
        }
        TypedAction::MoveUnit { unit, target } => {
            // Caller-provided adjacency takes priority (frontend sometimes
            // sends a trimmed map); fall back to the embedded full graph so
            // NPC turns and engine-internal callers don't need to plumb it.
            let fallback = crate::engine::adjacency::default_adjacency();
            let adj = adjacency.unwrap_or(fallback);
            let lookup = |s: &str| -> Vec<String> {
                adj.get(s).cloned().unwrap_or_default()
            };
            let outcome = resolve_movement(world, *unit, *target, &lookup);
            match outcome {
                crate::engine::combat::MovementOutcome::Invalid { reason } => Err(reason),
                _ => Ok(()),
            }
        }
        TypedAction::AssassinateNpc { target } => {
            let before = world.npcs.len();
            world.npcs.retain(|n| n.id != *target);
            if world.npcs.len() == before {
                return Err(format!("npc {} not found", target));
            }
            Ok(())
        }
    }
}

/// Plan 12 Phase 3 — Move faction satisfaction on the named nation.
/// Clamps to [0, 100]. No-op if the nation or archetype isn't found.
fn apply_faction_shift(
    world: &mut World,
    nation_id: crate::world::ids::NationId,
    shifts: &[(crate::world::faction::FactionArchetype, i8)],
) {
    let Some(n) = world.nations.iter_mut().find(|n| n.id == nation_id) else {
        return;
    };
    for (archetype, delta) in shifts {
        if let Some(f) = n.factions.iter_mut().find(|f| f.archetype == *archetype) {
            let v = f.satisfaction as i32 + *delta as i32;
            f.satisfaction = v.clamp(0, 100) as u8;
        }
    }
}

fn synthesize_headline(applied: &[TypedAction]) -> String {
    if applied.is_empty() {
        return "Turn end".into();
    }
    let kinds: Vec<&'static str> = applied
        .iter()
        .map(|a| match a {
            TypedAction::DeclareWar { .. } => "war declared",
            TypedAction::SignTreaty { .. } => "treaty signed",
            TypedAction::TransferTerritory { .. } => "territory transferred",
            TypedAction::ModifyRelation { .. } => "diplomatic shift",
            TypedAction::ModifyStability { .. } => "stability change",
            TypedAction::ModifyResource { .. } => "resource change",
            TypedAction::ChangeGovernment { .. } => "government change",
            TypedAction::SpawnUnit { .. } => "unit raised",
            TypedAction::MoveUnit { .. } => "unit moved",
            TypedAction::AssassinateNpc { .. } => "assassination",
        })
        .collect();
    let mut unique: Vec<&'static str> = kinds.clone();
    unique.sort();
    unique.dedup();
    unique.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::{BranchId, SaveId};
    use crate::world::scenario::build_modern_world;
    use chrono::NaiveDate;

    fn fresh_world() -> World {
        build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        )
    }

    #[test]
    fn modify_stability_clamps() {
        let mut w = fresh_world();
        let nid = w.nations[0].id;
        w.nations[0].stability = 50;
        let out = apply_actions(
            w,
            vec![TypedAction::ModifyStability {
                nation: nid,
                delta: 999,
            }],
            None,
            None,
        );
        assert_eq!(out.applied.len(), 1);
        assert_eq!(
            out.world.nations.iter().find(|n| n.id == nid).unwrap().stability,
            100
        );
    }

    #[test]
    fn modify_relation_writes_clamped_value() {
        let mut w = fresh_world();
        let a = w.nations[0].id;
        let b = w.nations[1].id;
        w.nations[0].relations.insert(b, 30);
        let out = apply_actions(
            w,
            vec![TypedAction::ModifyRelation {
                from: a,
                to: b,
                delta: -200,
                reason: "test".into(),
            }],
            None,
            None,
        );
        assert_eq!(out.applied.len(), 1);
        assert_eq!(
            *out
                .world
                .nations
                .iter()
                .find(|n| n.id == a)
                .unwrap()
                .relations
                .get(&b)
                .unwrap(),
            -100
        );
    }

    #[test]
    fn unknown_nation_is_recorded_as_failure() {
        let w = fresh_world();
        let bogus = crate::world::ids::NationId::new();
        let out = apply_actions(
            w,
            vec![TypedAction::ModifyStability {
                nation: bogus,
                delta: 5,
            }],
            None,
            None,
        );
        assert_eq!(out.applied.len(), 0);
        assert_eq!(out.failures.len(), 1);
    }

    #[test]
    fn applied_actions_get_a_history_event() {
        let w = fresh_world();
        let nid = w.nations[0].id;
        let before = w.events.len();
        let out = apply_actions(
            w,
            vec![TypedAction::ModifyStability {
                nation: nid,
                delta: 5,
            }],
            Some("Test narrative.".into()),
            None,
        );
        assert_eq!(out.world.events.len(), before + 1);
        let last = out.world.events.last().unwrap();
        assert_eq!(last.narrative, "Test narrative.");
    }
}
