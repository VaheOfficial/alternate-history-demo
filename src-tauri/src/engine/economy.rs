//! Per-turn economy ticks.
//!
//! For each day advanced:
//!   - Treasury earns a fraction of (annual revenue = GDP × tax_rate).
//!   - Manpower regenerates at a small per-day pop-fraction.
//!   - Stability drifts gently toward the natural equilibrium (~50).
//!   - War support drifts gently down toward 0 (no perpetual war fever).
//!
//! All deterministic; tuned to feel like HOI4/EU4-ish numbers without being
//! a fully-modeled economic sim. Plan 06+ will layer production queues,
//! resource consumption, and trade on top.

use crate::world::world::World;

/// Government revenue as a fraction of GDP per year. Real-world OECD avg ~22%.
const TAX_RATE: f64 = 0.20;
/// Manpower regenerated per population per day. 0.5% of pop per year ≈ births
/// minus retirements at military-age windows.
const MANPOWER_REGEN_PER_POP_PER_DAY: f64 = 0.005 / 365.0;
/// Stability drifts toward this baseline each day. Slow correction.
const STABILITY_BASELINE: i32 = 50;
/// War support drifts toward 0 (peacetime).
const WAR_SUPPORT_BASELINE: i32 = 0;
/// How much of the gap to close per day. 0.001 = ~30% per year.
const DRIFT_RATE_PER_DAY: f64 = 0.001;

/// Apply economy ticks for `days` days. Mutates each Nation in place.
pub fn run_economy_tick(world: &mut World, days: i64) {
    if days <= 0 {
        return;
    }
    let days_f = days as f64;

    for n in &mut world.nations {
        // Treasury — income from GDP × tax rate, scaled to days.
        let annual_revenue = (n.gdp as f64 * TAX_RATE) as i64;
        let income = ((annual_revenue as f64) * (days_f / 365.0)) as i64;
        n.treasury = n.treasury.saturating_add(income);

        // Manpower regen — capped at 8% of population (realistic mobilisation
        // ceiling; matches HOI4 max field-army size).
        let regen = ((n.population as f64) * MANPOWER_REGEN_PER_POP_PER_DAY * days_f) as i64;
        let max_manpower = ((n.population as f64) * 0.08) as i64;
        n.manpower_pool = (n.manpower_pool + regen).min(max_manpower);

        // Stability drift toward 50.
        n.stability = drift_toward(n.stability, STABILITY_BASELINE, days_f);
        // War support drift toward 0.
        n.war_support = drift_toward(n.war_support, WAR_SUPPORT_BASELINE, days_f);
    }
}

fn drift_toward(current: i32, target: i32, days: f64) -> i32 {
    let gap = (target - current) as f64;
    let step = gap * DRIFT_RATE_PER_DAY * days;
    // Round away from zero so small gaps still close eventually.
    let step_i = if step.abs() < 1.0 && step != 0.0 {
        step.signum() as i32
    } else {
        step.round() as i32
    };
    let next = current + step_i;
    // Don't overshoot the target.
    if (current <= target && next > target) || (current >= target && next < target) {
        target
    } else {
        next.clamp(-100, 100)
    }
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
    fn treasury_grows_after_a_year() {
        let mut w = fresh_world();
        let target = w.nations[0].id;
        let before = w.nations.iter().find(|n| n.id == target).unwrap().treasury;
        let gdp = w.nations.iter().find(|n| n.id == target).unwrap().gdp;
        run_economy_tick(&mut w, 365);
        let after = w.nations.iter().find(|n| n.id == target).unwrap().treasury;
        // One year ≈ gdp × tax_rate income.
        let expected_income = (gdp as f64 * TAX_RATE) as i64;
        let actual_delta = after - before;
        // Allow ±1% for rounding.
        assert!(
            (actual_delta - expected_income).abs() < expected_income.abs() / 100 + 1,
            "expected ≈{}, got {}",
            expected_income,
            actual_delta
        );
    }

    #[test]
    fn stability_drifts_toward_50() {
        let mut w = fresh_world();
        let nid = w.nations[0].id;
        w.nations.iter_mut().find(|n| n.id == nid).unwrap().stability = 0;
        // Run 5 years.
        run_economy_tick(&mut w, 365 * 5);
        let s = w.nations.iter().find(|n| n.id == nid).unwrap().stability;
        assert!(s > 10, "stability barely moved: {}", s);
        assert!(s <= 50, "overshot: {}", s);
    }

    #[test]
    fn manpower_does_not_exceed_eight_percent_of_pop() {
        let mut w = fresh_world();
        // Pre-fill manpower to a stupidly high value to check the cap.
        let nid = w.nations[0].id;
        let pop = w.nations.iter().find(|n| n.id == nid).unwrap().population;
        w.nations.iter_mut().find(|n| n.id == nid).unwrap().manpower_pool = pop * 2;
        run_economy_tick(&mut w, 365);
        let m = w.nations.iter().find(|n| n.id == nid).unwrap().manpower_pool;
        let cap = (pop as f64 * 0.08) as i64;
        assert!(m <= cap, "manpower={} > cap={}", m, cap);
    }
}
