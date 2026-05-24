//! War occupation tracking + peace-proposal generation (Plan 12 Phase 1).
//!
//! Runs after every `end_turn_cmd`. For each active War, recomputes
//! `occupation_pct` from the current province ownership and spawns a
//! `PeaceProposal` when occupation crosses each new threshold
//! (30 / 60 / 100 %). The proposal carries the typed actions the
//! engine will apply if the player accepts — same pipeline the
//! validator uses.

use chrono::NaiveDate;

use crate::world::action::TypedAction;
use crate::world::ids::NationId;
use crate::world::treaty::{TreatyKind, TreatyTerms};
use crate::world::war::{CasusBelli, PeaceProposal, WarStatus};
use crate::world::world::World;

const THRESHOLDS: &[u8] = &[30, 60, 100];

/// Recompute occupation% on every active war, then spawn peace
/// proposals for any newly-crossed threshold. Idempotent — re-running
/// won't duplicate proposals.
pub fn tick_wars(world: &mut World) {
    // Snapshot the data we'll need to read while we mutate world.wars.
    let today = world.clock.current_date;

    // Province ownership by NationId.
    let owner_by_province: std::collections::HashMap<
        crate::world::ids::ProvinceId,
        NationId,
    > = world
        .provinces
        .iter()
        .map(|p| (p.id, p.owner))
        .collect();
    // Total defender province counts at the START of each war.
    // We treat the current province count as the universe (defenders
    // can lose provinces to OTHER wars, but our denominator follows
    // them — meaning a defender that's been swallowed by someone else
    // can still be reached via 100%).

    // First pass: compute snapshots + new occupation% + planned proposals
    // WITHOUT borrowing world.wars mutably (so build_peace_proposal can
    // still read &world). Second pass writes back.
    struct Plan {
        idx: usize,
        new_pct: u8,
        new_proposals: Vec<PeaceProposal>,
    }
    let mut plans: Vec<Plan> = Vec::new();
    for (idx, war) in world.wars.iter().enumerate() {
        if !matches!(war.status, WarStatus::Active) {
            continue;
        }
        let defenders: std::collections::HashSet<NationId> =
            war.defenders.iter().copied().collect();
        let mut held_by_aggressor: u32 = 0;
        let mut still_defenders: u32 = 0;
        for (pid, owner) in &owner_by_province {
            if *owner == war.aggressor && war.conquered_provinces.contains(pid) {
                held_by_aggressor += 1;
            } else if defenders.contains(owner) {
                still_defenders += 1;
            }
        }
        let total = (held_by_aggressor + still_defenders).max(1);
        let pct: u8 = (((held_by_aggressor as u32) * 100) / total).min(100) as u8;

        let mut new_proposals: Vec<PeaceProposal> = Vec::new();
        for &threshold in THRESHOLDS {
            if pct < threshold {
                continue;
            }
            let already = war.peace_proposals.iter().any(|p| p.threshold == threshold);
            if already {
                continue;
            }
            new_proposals.push(build_peace_proposal(war, threshold, today, world));
        }
        plans.push(Plan {
            idx,
            new_pct: pct,
            new_proposals,
        });
    }

    // Second pass: apply.
    for plan in plans {
        let war = &mut world.wars[plan.idx];
        war.occupation_pct = plan.new_pct;
        for p in plan.new_proposals {
            war.peace_proposals.push(p);
        }
    }

    // Plan 12 post-test: war support consequences. For every ACTIVE war,
    // war_support trends DOWN slightly each tick (war weariness) for
    // the aggressor unless the war is going well (occupation% > 40)
    // — in which case it ticks UP because the public is enjoying the
    // victories. The defender's war_support trends DOWN faster the
    // more they're losing.
    let aggressor_updates: Vec<(NationId, i32)> = world
        .wars
        .iter()
        .filter(|w| matches!(w.status, WarStatus::Active))
        .map(|w| {
            let delta = if w.occupation_pct >= 40 {
                2
            } else {
                -1
            };
            (w.aggressor, delta)
        })
        .collect();
    let defender_updates: Vec<(NationId, i32)> = world
        .wars
        .iter()
        .filter(|w| matches!(w.status, WarStatus::Active))
        .flat_map(|w| {
            let delta = if w.occupation_pct >= 60 {
                -4
            } else if w.occupation_pct >= 30 {
                -2
            } else {
                -1
            };
            w.defenders.iter().map(move |d| (*d, delta))
        })
        .collect();
    for (nid, delta) in aggressor_updates.iter().chain(defender_updates.iter()) {
        if let Some(n) = world.nations.iter_mut().find(|n| n.id == *nid) {
            n.war_support = (n.war_support + delta).clamp(-100, 100);
        }
    }
}

fn build_peace_proposal(
    war: &crate::world::war::War,
    threshold: u8,
    today: NaiveDate,
    world: &World,
) -> PeaceProposal {
    // Loser = the defenders (we model the simple case of single defender).
    let from = *war.defenders.first().unwrap_or(&war.aggressor);
    let aggressor = war.aggressor;
    let aggressor_name = world
        .nations
        .iter()
        .find(|n| n.id == aggressor)
        .map(|n| n.name.clone())
        .unwrap_or_else(|| "the aggressor".into());
    let from_name = world
        .nations
        .iter()
        .find(|n| n.id == from)
        .map(|n| n.name.clone())
        .unwrap_or_else(|| "the loser".into());

    let cb = war.casus_belli;
    let (headline, narrative, actions) = match cb {
        CasusBelli::AnnexProvinces => {
            // Hand over every conquered province + sign a peace treaty.
            let mut actions: Vec<TypedAction> = Vec::new();
            actions.push(TypedAction::SignTreaty {
                parties: vec![aggressor, from],
                kind: TreatyKind::PeaceTreaty,
                terms: TreatyTerms {
                    territory_transfers: Vec::new(),
                    tribute_per_year: 0,
                    extra_clauses: vec![format!(
                        "Ceded territory after {} loss",
                        from_name
                    )],
                },
            });
            if !war.conquered_provinces.is_empty() {
                actions.push(TypedAction::TransferTerritory {
                    from,
                    to: aggressor,
                    provinces: war.conquered_provinces.clone(),
                    mechanism:
                        crate::world::action::TransferReason::Treaty,
                });
            }
            // Restore relations to 0 since the war ends.
            actions.push(TypedAction::ModifyRelation {
                from: aggressor,
                to: from,
                delta: 100, // bring -100 → 0
                reason: "Peace concluded".into(),
            });
            actions.push(TypedAction::ModifyRelation {
                from,
                to: aggressor,
                delta: 100,
                reason: "Peace concluded".into(),
            });
            (
                format!(
                    "{} cedes contested provinces to {}",
                    from_name, aggressor_name
                ),
                format!(
                    "With {:.0}% of its land under occupation, {} sues for peace and cedes {} province(s) to {}.",
                    threshold as f64,
                    from_name,
                    war.conquered_provinces.len(),
                    aggressor_name,
                ),
                actions,
            )
        }
        CasusBelli::InstallPuppet => {
            // Sign a Vassalage treaty + relations reset.
            let actions: Vec<TypedAction> = vec![
                TypedAction::SignTreaty {
                    parties: vec![aggressor, from],
                    kind: TreatyKind::Vassalage,
                    terms: TreatyTerms {
                        territory_transfers: Vec::new(),
                        tribute_per_year: 0,
                        extra_clauses: vec![format!(
                            "{} accepts vassalage to {} after defeat",
                            from_name, aggressor_name
                        )],
                    },
                },
                TypedAction::ModifyRelation {
                    from: aggressor,
                    to: from,
                    delta: 100,
                    reason: "Puppet government installed".into(),
                },
                TypedAction::ModifyRelation {
                    from,
                    to: aggressor,
                    delta: 100,
                    reason: "New senior partner".into(),
                },
            ];
            (
                format!("{} becomes a vassal of {}", from_name, aggressor_name),
                format!(
                    "Defeated at {}% occupation, {} accepts {} as its senior partner and reorganizes its government accordingly.",
                    threshold as u32, from_name, aggressor_name
                ),
                actions,
            )
        }
        _ => {
            // Generic peace: white-ish peace with relations restored
            // + a permanent relation penalty to the loser. v1 keeps it
            // simple; later phases can use stability/war-support
            // effects.
            let actions: Vec<TypedAction> = vec![
                TypedAction::SignTreaty {
                    parties: vec![aggressor, from],
                    kind: TreatyKind::PeaceTreaty,
                    terms: TreatyTerms {
                        territory_transfers: Vec::new(),
                        tribute_per_year: 0,
                        extra_clauses: vec![format!(
                            "{} sues for peace with {}",
                            from_name, aggressor_name
                        )],
                    },
                },
                TypedAction::ModifyRelation {
                    from: aggressor,
                    to: from,
                    delta: 100,
                    reason: "Peace concluded".into(),
                },
                TypedAction::ModifyRelation {
                    from,
                    to: aggressor,
                    delta: 60, // residual resentment
                    reason: "Peace concluded under pressure".into(),
                },
            ];
            (
                format!("{} offers peace to {}", from_name, aggressor_name),
                format!(
                    "Under {}% occupation, {} requests a return to peace. The casus belli ({}) is satisfied.",
                    threshold as u32,
                    from_name,
                    cb.label(),
                ),
                actions,
            )
        }
    };

    PeaceProposal {
        id: uuid::Uuid::new_v4().to_string(),
        from,
        created_on: today,
        threshold,
        headline,
        narrative,
        actions,
        accepted: false,
        rejected: false,
    }
}

/// Apply a peace proposal: run its typed_actions through `apply_actions`,
/// mark the war Concluded, mark the proposal accepted. Public so the
/// Tauri command can call it without round-tripping.
pub fn accept_peace_proposal(
    world: &mut World,
    war_id: &str,
    proposal_id: &str,
) -> Result<(), String> {
    let (actions, war_idx) = {
        let war_idx = world
            .wars
            .iter()
            .position(|w| w.id == war_id)
            .ok_or_else(|| format!("war {} not found", war_id))?;
        let proposal = world.wars[war_idx]
            .peace_proposals
            .iter_mut()
            .find(|p| p.id == proposal_id)
            .ok_or_else(|| format!("proposal {} not found", proposal_id))?;
        if proposal.accepted || proposal.rejected {
            return Err("proposal already resolved".into());
        }
        proposal.accepted = true;
        (proposal.actions.clone(), war_idx)
    };

    let mutable = world.clone();
    let outcome = crate::engine::apply::apply_actions(
        mutable,
        actions,
        Some("Peace proposal accepted.".into()),
        None,
    );
    let mut new_world = outcome.world;
    new_world.wars[war_idx].status = WarStatus::Concluded;
    *world = new_world;
    Ok(())
}

pub fn reject_peace_proposal(
    world: &mut World,
    war_id: &str,
    proposal_id: &str,
) -> Result<(), String> {
    let war = world
        .wars
        .iter_mut()
        .find(|w| w.id == war_id)
        .ok_or_else(|| format!("war {} not found", war_id))?;
    let proposal = war
        .peace_proposals
        .iter_mut()
        .find(|p| p.id == proposal_id)
        .ok_or_else(|| format!("proposal {} not found", proposal_id))?;
    if proposal.accepted || proposal.rejected {
        return Err("proposal already resolved".into());
    }
    proposal.rejected = true;
    Ok(())
}
