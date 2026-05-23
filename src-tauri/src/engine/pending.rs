//! Multi-turn operation processing.
//!
//! Each end_turn calls `tick_pending` to:
//!   - Update progress_pct on every active operation based on elapsed days.
//!   - Apply on_complete actions for any operation whose completes_on date
//!     has arrived. Apply via engine::apply_actions so they flow through
//!     the same path as immediate orders.
//!   - Remove completed operations from world.pending.
//!   - Stamp an Event for each completion so the turn summary surfaces it.

use crate::engine::apply::apply_actions;
use crate::world::event::{Event, EventCategory, Visibility};
use crate::world::ids::EventId;
use crate::world::world::World;

/// Tick all pending operations. Returns the number of operations that
/// completed this tick (for surfacing in turn summaries).
pub fn tick_pending(world: &mut World) -> usize {
    let today = world.clock.current_date;
    let mut completed_count = 0;

    // Update progress_pct on everything still pending.
    for p in &mut world.pending {
        let total_days = (p.completes_on - p.started_on).num_days().max(1);
        let elapsed = (today - p.started_on).num_days().max(0);
        let pct = ((elapsed as f64 / total_days as f64) * 100.0) as i64;
        p.progress_pct = pct.clamp(0, 100) as u8;
    }

    // Split into completed (date arrived) and still-active.
    let (completed, active): (Vec<_>, Vec<_>) = std::mem::take(&mut world.pending)
        .into_iter()
        .partition(|p| today >= p.completes_on);
    world.pending = active;

    for p in completed {
        completed_count += 1;
        // Apply the on_complete actions through the normal engine pathway.
        // We pass None for adjacency — multi-turn ops shouldn't need
        // movement (those would have been immediate). If a future plan
        // wants pending movement we can thread adjacency through.
        let actions = p.on_complete.clone();
        let narrative = format!("{} completed: {}", p.label, p.narrative);
        let out = apply_actions(world.clone(), actions, Some(narrative.clone()), None);
        *world = out.world;
        // Also stamp a dedicated event so the completion is visible even
        // if the on_complete actions were empty/all-failed.
        world.events.push(Event {
            id: EventId::new(),
            round: world.clock.round,
            timestamp: world.clock.current_date,
            category: EventCategory::Political,
            headline: format!("{} — completed", p.label),
            narrative,
            typed_actions: out.applied,
            visibility: Visibility::Global,
            embedding: None,
            interrupts_player: false,
        });
    }

    completed_count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::action::TypedAction;
    use crate::world::ids::{BranchId, SaveId};
    use crate::world::pending::PendingAction;
    use crate::world::scenario::build_modern_world;
    use chrono::{Duration, NaiveDate};

    #[test]
    fn pending_progress_increments_as_days_elapse() {
        let mut w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let nid = w.nations[0].id;
        let started = w.clock.current_date;
        w.pending.push(PendingAction {
            id: "p1".into(),
            initiator: nid,
            label: "Test op".into(),
            narrative: "test".into(),
            started_on: started,
            completes_on: started + Duration::days(100),
            progress_pct: 0,
            on_complete: vec![],
        });
        // Advance clock 30 days.
        w.clock.current_date = started + Duration::days(30);
        let n = tick_pending(&mut w);
        assert_eq!(n, 0);
        assert_eq!(w.pending[0].progress_pct, 30);
    }

    #[test]
    fn pending_with_empty_on_complete_still_emits_event() {
        let mut w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let nid = w.nations[0].id;
        let started = w.clock.current_date;
        w.pending.push(PendingAction {
            id: "p1".into(),
            initiator: nid,
            label: "UFO research".into(),
            narrative: "classified".into(),
            started_on: started,
            completes_on: started + Duration::days(10),
            progress_pct: 0,
            on_complete: vec![], // imagination-only ops can have no mechanical effect
        });
        w.clock.current_date = started + Duration::days(15);
        let n = tick_pending(&mut w);
        assert_eq!(n, 1);
        // Pending list cleared.
        assert!(w.pending.is_empty());
        // Event stamped — completion is visible even with empty on_complete.
        assert!(w.events.iter().any(|e| e.headline.contains("UFO research")));
    }

    #[test]
    fn pending_completes_when_date_arrives() {
        let mut w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let nid = w.nations[0].id;
        let target_nation = w.nations[1].id;
        let started = w.clock.current_date;
        // Pending op that bumps relations on completion.
        w.pending.push(PendingAction {
            id: "p1".into(),
            initiator: nid,
            label: "Diplomatic mission".into(),
            narrative: "behind-the-scenes work".into(),
            started_on: started,
            completes_on: started + Duration::days(30),
            progress_pct: 0,
            on_complete: vec![TypedAction::ModifyRelation {
                from: nid,
                to: target_nation,
                delta: 25,
                reason: "completed mission".into(),
            }],
        });
        // Advance clock past completion.
        w.clock.current_date = started + Duration::days(35);
        let n = tick_pending(&mut w);
        assert_eq!(n, 1);
        assert_eq!(w.pending.len(), 0);
        // Relation was applied.
        let n0 = w.nations.iter().find(|n| n.id == nid).unwrap();
        assert_eq!(n0.relations.get(&target_nation).copied(), Some(25));
        // Event was stamped.
        assert!(w.events.iter().any(|e| e.headline.contains("Diplomatic mission")));
    }
}
