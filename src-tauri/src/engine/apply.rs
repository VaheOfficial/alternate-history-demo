//! Apply typed actions to the world.
//!
//! Each `TypedAction` is independently applied; failures are collected per
//! action so the caller can show which ones the validator accepted but the
//! engine couldn't apply (e.g. unit not found).
//!
//! Plan 04 Phase C handles the most common diplomatic / governance actions
//! deterministically. Combat application lands in Plan 05.

use serde::Serialize;

use crate::world::action::TypedAction;
use crate::world::event::{Event, EventCategory, Visibility};
use crate::world::ids::EventId;
use crate::world::treaty::{Treaty, TreatyTerms};
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
pub fn apply_actions(
    mut world: World,
    actions: Vec<TypedAction>,
    narrative: Option<String>,
) -> ApplyOutcome {
    let mut applied = Vec::new();
    let mut failures = Vec::new();

    for action in actions {
        match apply_one(&mut world, &action) {
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

fn apply_one(world: &mut World, action: &TypedAction) -> Result<(), String> {
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
        } => {
            // Modeled as setting relations both ways to -100. War book-keeping
            // (frontline creation, mobilization) comes with the combat module
            // in Plan 05.
            for (a, b) in [(aggressor, target), (target, aggressor)] {
                if let Some(n) = world.nations.iter_mut().find(|n| n.id == *a) {
                    n.relations.insert(*b, -100);
                }
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
            Ok(())
        }
        TypedAction::SpawnUnit { .. } | TypedAction::MoveUnit { .. } => {
            // Stubs — wired up in Plan 05 along with combat.
            Err("unit actions not yet implemented".into())
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
        );
        assert_eq!(out.world.events.len(), before + 1);
        let last = out.world.events.last().unwrap();
        assert_eq!(last.narrative, "Test narrative.");
    }
}
