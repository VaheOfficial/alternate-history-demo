//! Clock advancement.
//!
//! Phase B only ticks the calendar — no production / supply / treaty timers
//! yet. Those land alongside combat in Plan 05+.

use chrono::Duration;

use crate::world::clock::GameClock;
use crate::world::world::World;

/// Advance the world clock by `days`. Returns a new `World` with the clock
/// updated and `round` incremented by 1. All other state is preserved.
pub fn advance_clock(mut world: World, days: i64) -> World {
    let new_date = world
        .clock
        .current_date
        .checked_add_signed(Duration::days(days.max(1)))
        .unwrap_or(world.clock.current_date);
    world.clock = GameClock {
        current_date: new_date,
        round: world.clock.round + 1,
    };
    world
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::{BranchId, SaveId};
    use chrono::NaiveDate;

    #[test]
    fn advance_clock_increments_round_and_date() {
        let w = World::empty(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let w2 = advance_clock(w.clone(), 7);
        assert_eq!(w2.clock.round, 1);
        assert_eq!(
            w2.clock.current_date,
            NaiveDate::from_ymd_opt(2026, 5, 29).unwrap()
        );
    }

    #[test]
    fn advance_clock_clamps_zero_to_one_day() {
        let w = World::empty(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let w2 = advance_clock(w, 0);
        // Even a 0-day request bumps by 1 — clock always moves on End Turn.
        assert_eq!(
            w2.clock.current_date,
            NaiveDate::from_ymd_opt(2026, 5, 23).unwrap()
        );
    }
}
