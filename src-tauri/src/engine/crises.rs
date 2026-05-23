//! Crisis producer + resolver (Plan 12 Phase 2).
//!
//! Crises are interrupting decision cards the world drops on the player.
//! They come from three sources:
//!
//! 1. **Pending op completions** that affect the player — e.g. "Border
//!    mobilization completed" gives them a decision: escalate to a
//!    declared war, hold position, or stand down.
//! 2. **Hostile NPC moves** — when a recent event's typed_actions
//!    include a DeclareWar against the player or a deep negative
//!    ModifyRelation toward the player, spawn a "Diplomatic incident
//!    with X" crisis.
//! 3. **Seeded random events** — once per end-turn we sample a
//!    low-frequency global event (oil shock, earthquake, etc.) with a
//!    deterministic RNG seeded off the world's clock.
//!
//! All crises carry 2-3 options the player can pick. If the player
//! doesn't pick before `deadline_round` the engine applies option 0
//! automatically.

use chrono::{Datelike, NaiveDate};

use crate::world::action::TypedAction;
use crate::world::crisis::{Crisis, CrisisCategory, CrisisOption, EscalationLevel};
use crate::world::event::Event;
use crate::world::ids::{CrisisId, NationId};
use crate::world::world::World;

/// Top-level tick: spawn new crises from recent events + tick the
/// existing ones (auto-resolve past deadline). Idempotent — the
/// dedupe key is `(category, parties)` so we don't re-spawn the same
/// "diplomatic incident with X" every turn.
pub fn tick_crises(world: &mut World) {
    auto_resolve_expired(world);
    spawn_from_recent_events(world);
    spawn_random_events(world);
}

fn auto_resolve_expired(world: &mut World) {
    let current_round = world.clock.round;
    // Two-pass to avoid borrowing world.crises mutably while reading it.
    let mut to_apply: Vec<(usize, Vec<TypedAction>, String)> = Vec::new();
    for (idx, c) in world.crises.iter().enumerate() {
        if c.resolved {
            continue;
        }
        let Some(deadline) = c.deadline_round else {
            continue;
        };
        if current_round < deadline {
            continue;
        }
        // Past deadline → auto-pick option 0.
        let Some(option) = c.options.first() else {
            // No options = informational, just mark resolved.
            to_apply.push((idx, Vec::new(), c.headline.clone()));
            continue;
        };
        to_apply.push((idx, option.actions.clone(), c.headline.clone()));
    }
    for (idx, actions, headline) in to_apply {
        let snapshot = world.clone();
        let outcome = crate::engine::apply::apply_actions(
            snapshot,
            actions,
            Some(format!("Crisis auto-resolved past deadline: {}", headline)),
            None,
        );
        *world = outcome.world;
        if let Some(c) = world.crises.get_mut(idx) {
            c.resolved = true;
            c.resolved_option = Some(0);
        }
    }
}

fn spawn_from_recent_events(world: &mut World) {
    let Some(player) = world.player_nation else {
        return;
    };
    // Walk the most-recent 5 events for hostile actions targeting the
    // player. Skip events we've already spawned a crisis for (dedupe
    // by checking if the crisis with same parties + headline exists).
    let recent: Vec<Event> = world.events.iter().rev().take(5).cloned().collect();
    let today = world.clock.current_date;
    let current_round = world.clock.round;

    for evt in recent {
        for action in &evt.typed_actions {
            match action {
                TypedAction::DeclareWar { aggressor, target, .. } if *target == player => {
                    spawn_war_declared_crisis(world, *aggressor, today, current_round);
                }
                TypedAction::ModifyRelation { from, to, delta, .. }
                    if *to == player && *delta <= -40 =>
                {
                    spawn_diplomatic_incident_crisis(world, *from, today, current_round);
                }
                _ => {}
            }
        }
    }
}

fn spawn_war_declared_crisis(
    world: &mut World,
    aggressor: NationId,
    today: NaiveDate,
    current_round: u32,
) {
    let Some(player) = world.player_nation else {
        return;
    };
    let aggressor_name = world
        .nations
        .iter()
        .find(|n| n.id == aggressor)
        .map(|n| n.name.clone())
        .unwrap_or_else(|| "Unknown power".into());
    let headline = format!("{} has declared war", aggressor_name);
    if world
        .crises
        .iter()
        .any(|c| c.headline == headline && !c.resolved)
    {
        return;
    }
    world.crises.push(Crisis {
        id: CrisisId::new(),
        headline: headline.clone(),
        category: CrisisCategory::Military,
        parties: vec![aggressor, player],
        stakes: format!(
            "{} has formally declared war on you. The world is watching how you respond.",
            aggressor_name
        ),
        escalation: EscalationLevel(80),
        options: vec![
            CrisisOption {
                label: "General mobilization".into(),
                narrative: format!(
                    "We mobilize our reserves and put every division on alert. {} will pay for this.",
                    aggressor_name
                ),
                actions: vec![TypedAction::ModifyRelation {
                    from: player,
                    to: aggressor,
                    delta: -100,
                    reason: "Mobilization following war declaration".into(),
                }],
            },
            CrisisOption {
                label: "Open a diplomatic backchannel".into(),
                narrative: format!(
                    "Even with hostilities formal, we attempt to reach {} through neutral parties for an off-ramp.",
                    aggressor_name
                ),
                actions: vec![TypedAction::ModifyRelation {
                    from: player,
                    to: aggressor,
                    delta: 10,
                    reason: "Backchannel diplomacy attempted".into(),
                }],
            },
            CrisisOption {
                label: "Issue an ultimatum".into(),
                narrative: format!(
                    "We give {} 30 days to retract their declaration or face overwhelming counter-mobilization.",
                    aggressor_name
                ),
                actions: vec![TypedAction::ModifyRelation {
                    from: player,
                    to: aggressor,
                    delta: -30,
                    reason: "Counter-ultimatum issued".into(),
                }],
            },
        ],
        deadline_round: Some(current_round.saturating_add(2)),
        created_on: Some(today),
        resolved: false,
        resolved_option: None,
    });
}

fn spawn_diplomatic_incident_crisis(
    world: &mut World,
    from: NationId,
    today: NaiveDate,
    current_round: u32,
) {
    let Some(player) = world.player_nation else {
        return;
    };
    let other_name = world
        .nations
        .iter()
        .find(|n| n.id == from)
        .map(|n| n.name.clone())
        .unwrap_or_else(|| "A foreign power".into());
    let headline = format!("Diplomatic incident: {}", other_name);
    if world
        .crises
        .iter()
        .any(|c| c.headline == headline && !c.resolved)
    {
        return;
    }
    world.crises.push(Crisis {
        id: CrisisId::new(),
        headline: headline.clone(),
        category: CrisisCategory::Diplomatic,
        parties: vec![from, player],
        stakes: format!(
            "{} has taken a hostile diplomatic stance. Relations are deteriorating fast.",
            other_name
        ),
        escalation: EscalationLevel(40),
        options: vec![
            CrisisOption {
                label: "Express formal displeasure".into(),
                narrative: format!(
                    "We issue a strongly-worded démarche through proper channels. {} is left in no doubt about our position.",
                    other_name
                ),
                actions: vec![TypedAction::ModifyRelation {
                    from: player,
                    to: from,
                    delta: -10,
                    reason: "Formal protest".into(),
                }],
            },
            CrisisOption {
                label: "Ignore it".into(),
                narrative: format!(
                    "We choose to overlook the incident. The press will speculate; the chancelleries will move on."
                ),
                actions: vec![],
            },
            CrisisOption {
                label: "Recall our ambassador".into(),
                narrative: format!(
                    "We pull our envoy from {}. A serious signal — possibly a step too far if we want this to de-escalate.",
                    other_name
                ),
                actions: vec![TypedAction::ModifyRelation {
                    from: player,
                    to: from,
                    delta: -25,
                    reason: "Ambassador recalled".into(),
                }],
            },
        ],
        deadline_round: Some(current_round.saturating_add(3)),
        created_on: Some(today),
        resolved: false,
        resolved_option: None,
    });
}

fn spawn_random_events(world: &mut World) {
    // Deterministic-ish: hash the date + round to pick whether to fire
    // an event this turn. Probability ≈ 1/4 per turn.
    let seed = (world.clock.current_date.num_days_from_ce() as u64)
        .wrapping_mul(31)
        .wrapping_add(world.clock.round as u64);
    let r = (seed.wrapping_mul(2654435761) >> 56) & 0xFF; // 0..255
    if r >= 64 {
        return;
    }
    // We avoid global events when there's no player nation set.
    let Some(player) = world.player_nation else {
        return;
    };
    // Pick which event to fire based on the same seed.
    let pick = ((seed >> 8) & 0x3) as usize;
    let today = world.clock.current_date;
    let current_round = world.clock.round;
    let crisis = match pick {
        0 => Crisis {
            id: CrisisId::new(),
            headline: "Global oil price shock".into(),
            category: CrisisCategory::Economic,
            parties: vec![player],
            stakes: "A sudden disruption in major exporters has spiked oil prices worldwide. The treasury will feel it.".into(),
            escalation: EscalationLevel(20),
            options: vec![
                CrisisOption {
                    label: "Tap strategic reserves".into(),
                    narrative: "We release reserves to stabilize domestic supply. Costs us, but business confidence holds.".into(),
                    actions: vec![],
                },
                CrisisOption {
                    label: "Ride it out".into(),
                    narrative: "We accept the cost-of-living hit. Households are unhappy; nothing the next election can't survive.".into(),
                    actions: vec![TypedAction::ModifyStability {
                        nation: player,
                        delta: -3,
                    }],
                },
            ],
            deadline_round: Some(current_round.saturating_add(3)),
            created_on: Some(today),
            resolved: false,
            resolved_option: None,
        },
        1 => Crisis {
            id: CrisisId::new(),
            headline: "Major natural disaster".into(),
            category: CrisisCategory::Humanitarian,
            parties: vec![player],
            stakes: "An earthquake / flood / wildfire has struck a populous region. Public eyes are on the response.".into(),
            escalation: EscalationLevel(15),
            options: vec![
                CrisisOption {
                    label: "Mobilize a massive relief effort".into(),
                    narrative: "Every division of the engineer corps is deployed. The country sees its government competent and present.".into(),
                    actions: vec![TypedAction::ModifyStability { nation: player, delta: 5 }],
                },
                CrisisOption {
                    label: "Standard emergency response".into(),
                    narrative: "We follow the playbook. Coverage is mixed.".into(),
                    actions: vec![],
                },
            ],
            deadline_round: Some(current_round.saturating_add(2)),
            created_on: Some(today),
            resolved: false,
            resolved_option: None,
        },
        2 => Crisis {
            id: CrisisId::new(),
            headline: "Major cyber-intrusion suspected".into(),
            category: CrisisCategory::Political,
            parties: vec![player],
            stakes: "A foreign-origin breach has been detected on critical infrastructure. Attribution is unclear.".into(),
            escalation: EscalationLevel(30),
            options: vec![
                CrisisOption {
                    label: "Quiet hardening, no public attribution".into(),
                    narrative: "Intelligence patches systems quietly. No diplomatic incident, but no political win either.".into(),
                    actions: vec![],
                },
                CrisisOption {
                    label: "Name and shame".into(),
                    narrative: "We publicly attribute the attack to a probable culprit. Domestic stability holds; one foreign power is now hostile.".into(),
                    actions: vec![TypedAction::ModifyStability { nation: player, delta: 2 }],
                },
            ],
            deadline_round: Some(current_round.saturating_add(2)),
            created_on: Some(today),
            resolved: false,
            resolved_option: None,
        },
        _ => Crisis {
            id: CrisisId::new(),
            headline: "Domestic faction tensions".into(),
            category: CrisisCategory::Political,
            parties: vec![player],
            stakes: "A coalition of opposition voices is gaining traction with a populist message. The capital is watching.".into(),
            escalation: EscalationLevel(25),
            options: vec![
                CrisisOption {
                    label: "Concede on a minor policy".into(),
                    narrative: "We trade a small policy win to drain the opposition's energy.".into(),
                    actions: vec![TypedAction::ModifyStability { nation: player, delta: 3 }],
                },
                CrisisOption {
                    label: "Crack down on dissent".into(),
                    narrative: "Police presence triples. Headlines abroad turn unfriendly; at home things hold.".into(),
                    actions: vec![TypedAction::ModifyStability { nation: player, delta: -2 }],
                },
            ],
            deadline_round: Some(current_round.saturating_add(3)),
            created_on: Some(today),
            resolved: false,
            resolved_option: None,
        },
    };

    // Dedupe: skip if there's an unresolved crisis with this headline.
    if world.crises.iter().any(|c| c.headline == crisis.headline && !c.resolved) {
        return;
    }
    world.crises.push(crisis);
}

/// Player picks an option to resolve a crisis.
pub fn resolve_crisis(
    world: &mut World,
    crisis_id: CrisisId,
    option_idx: usize,
) -> Result<(), String> {
    let actions: Vec<TypedAction> = {
        let crisis = world
            .crises
            .iter_mut()
            .find(|c| c.id == crisis_id)
            .ok_or_else(|| format!("crisis {} not found", crisis_id))?;
        if crisis.resolved {
            return Err("crisis already resolved".into());
        }
        let opt = crisis
            .options
            .get(option_idx)
            .ok_or_else(|| format!("option {} out of range", option_idx))?;
        let actions = opt.actions.clone();
        crisis.resolved = true;
        crisis.resolved_option = Some(option_idx);
        actions
    };
    let snapshot = world.clone();
    let outcome = crate::engine::apply::apply_actions(
        snapshot,
        actions,
        Some("Crisis resolved by player.".into()),
        None,
    );
    *world = outcome.world;
    Ok(())
}
