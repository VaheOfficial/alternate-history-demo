//! Unit production.
//!
//! Player describes desired build via the LLM-mediated `request_production_cmd`.
//! The LLM looks at the nation's industry capacity + treasury + manpower and
//! returns a plan the engine actually applies. The engine then:
//!   - Caps each requested batch by industry / treasury / manpower available
//!   - Spawns units in the requested or default (capital → largest-pop)
//!     province
//!   - Charges treasury + consumes manpower

use serde::{Deserialize, Serialize};

use crate::world::ids::{NationId, ProvinceId, UnitId};
use crate::world::nation::UnitType;
use crate::world::unit::{SupplyState, Unit};
use crate::world::world::World;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionRequest {
    pub unit_type: UnitType,
    pub count: u32,
    #[serde(default)]
    pub location_province: Option<ProvinceId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionOutcome {
    pub spawned: Vec<UnitId>,
    pub denied: Vec<DeniedProduction>,
    /// Industry-points consumed this batch (≤ nation.industry_capacity).
    pub industry_used: u32,
    pub treasury_spent: i64,
    pub manpower_spent: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeniedProduction {
    pub unit_type: UnitType,
    pub requested: u32,
    pub granted: u32,
    pub reason: String,
}

/// Cost of one unit, by type, expressed as (industry_pts, treasury_usd, manpower).
pub fn unit_cost(t: UnitType) -> (u32, i64, i64) {
    match t {
        UnitType::Infantry => (1, 80_000_000, 8_000),
        UnitType::Mechanized => (2, 220_000_000, 6_500),
        UnitType::Armor => (4, 600_000_000, 5_000),
        UnitType::Artillery => (2, 180_000_000, 4_500),
    }
}

// ─── Multi-turn production queue (Plan 12 Phase 4) ─────────────────────────

/// Tick the multi-turn production queue. For each owner, allocate their
/// per-turn industry capacity across their orders; when a unit's
/// industry cost is fully paid, spend treasury + manpower and spawn
/// the unit at the requested location (or the nation's largest-pop
/// province by default).
///
/// Removes orders whose `built` reaches `count`.
pub fn tick_production_queue(world: &mut World) {
    use crate::world::ids::{NationId, ProvinceId, UnitId};
    use crate::world::unit::{SupplyState, Unit};

    if world.production_orders.is_empty() {
        return;
    }

    // Group orders by owner.
    let mut by_owner: std::collections::HashMap<NationId, Vec<usize>> =
        std::collections::HashMap::new();
    for (i, o) in world.production_orders.iter().enumerate() {
        by_owner.entry(o.owner).or_default().push(i);
    }

    // For each owner, drain their per-turn industry capacity into orders
    // round-robin, charging treasury + manpower per unit completed.
    let owners: Vec<NationId> = by_owner.keys().copied().collect();
    let mut spawn_queue: Vec<(NationId, UnitType, ProvinceId, u32)> = Vec::new();

    for owner_id in owners {
        let order_idxs = by_owner.get(&owner_id).cloned().unwrap_or_default();
        if order_idxs.is_empty() {
            continue;
        }
        let (mut ic_left, mut treasury_left, mut manpower_left) = {
            let Some(n) = world.nations.iter().find(|n| n.id == owner_id) else {
                continue;
            };
            (n.industry_capacity, n.treasury, n.manpower_pool)
        };
        // Pre-pick default location for this owner (largest-pop province).
        let default_loc = world
            .provinces
            .iter()
            .filter(|p| p.owner == owner_id)
            .max_by_key(|p| p.population)
            .map(|p| p.id);

        // Round-robin allocate 1 IC at a time until budget exhausted or
        // all orders complete.
        let mut active: Vec<usize> = order_idxs;
        while ic_left > 0 && !active.is_empty() {
            let mut new_active: Vec<usize> = Vec::new();
            for &idx in &active {
                if ic_left == 0 {
                    new_active.push(idx);
                    continue;
                }
                let o = &mut world.production_orders[idx];
                if o.remaining() == 0 {
                    continue;
                }
                let cost_per = o.industry_cost_per.max(1);
                let needed = cost_per.saturating_sub(o.industry_paid);
                let take = needed.min(ic_left);
                o.industry_paid += take;
                ic_left -= take;

                if o.industry_paid >= cost_per {
                    // Check treasury + manpower.
                    if treasury_left < o.treasury_cost_per
                        || manpower_left < o.manpower_cost_per
                    {
                        // Can't afford the actual unit yet — pause this
                        // order, hold the industry already paid.
                        new_active.push(idx);
                        continue;
                    }
                    treasury_left -= o.treasury_cost_per;
                    manpower_left -= o.manpower_cost_per;
                    o.industry_paid = 0;
                    o.built += 1;
                    let loc = o.location.or(default_loc);
                    if let Some(loc) = loc {
                        spawn_queue.push((owner_id, o.unit_type, loc, 0));
                        let _ = take; // satisfy compiler
                    }
                }
                if o.remaining() > 0 {
                    new_active.push(idx);
                }
            }
            active = new_active;
        }

        // Persist the budget consumption back to the nation.
        if let Some(n) = world.nations.iter_mut().find(|n| n.id == owner_id) {
            n.treasury = treasury_left;
            n.manpower_pool = manpower_left;
        }
    }

    // Materialize spawns.
    for (owner, unit_type, location, _) in spawn_queue {
        let nation_tech = world
            .nations
            .iter()
            .find(|n| n.id == owner)
            .map(|n| n.tech.0)
            .unwrap_or(5);
        let strength = (75 + nation_tech as u32 * 5).clamp(60, 120);
        world.units.push(Unit {
            id: UnitId::new(),
            owner,
            unit_type,
            location,
            strength,
            organization: 80,
            experience: 0,
            supply_state: SupplyState::Supplied,
        });
    }

    // Drop completed orders.
    world.production_orders.retain(|o| !o.is_complete());
}

// ─── Tech research tick (Plan 12 Phase 4) ──────────────────────────────────

/// Tick research for every nation whose `research.target` is set.
/// Progress per tick = industry_capacity / 10. Caps at the tech's cost
/// (research doesn't "spill over" to other techs).
pub fn tick_research(world: &mut World) {
    for n in &mut world.nations {
        let Some(target) = n.research.target else {
            continue;
        };
        let cap = target.cost();
        let current = n.research.progress.get(&target).copied().unwrap_or(0);
        if current >= cap {
            // Already done; clear the target so the next pick fires.
            n.research.target = None;
            continue;
        }
        let gain = (n.industry_capacity / 10).max(1);
        let next = (current.saturating_add(gain)).min(cap);
        n.research.progress.insert(target, next);
        if next >= cap {
            n.research.target = None;
        }
    }
}

/// Apply a production plan. Greedy allocation: walk requests in order, grant
/// as many of each as the nation's remaining budget allows.
pub fn apply_production(
    world: &mut World,
    nation: NationId,
    plan: Vec<ProductionRequest>,
) -> ProductionOutcome {
    let mut outcome = ProductionOutcome {
        spawned: Vec::new(),
        denied: Vec::new(),
        industry_used: 0,
        treasury_spent: 0,
        manpower_spent: 0,
    };

    let nation_idx = match world.nations.iter().position(|n| n.id == nation) {
        Some(i) => i,
        None => return outcome,
    };
    // Cache state we need before we start mutating.
    let mut industry_remaining = world.nations[nation_idx].industry_capacity;
    let mut treasury_remaining = world.nations[nation_idx].treasury;
    let mut manpower_remaining = world.nations[nation_idx].manpower_pool;

    // Pick a default location if the request doesn't specify: the
    // highest-population province owned by this nation.
    let default_location: Option<ProvinceId> = world
        .provinces
        .iter()
        .filter(|p| p.owner == nation)
        .max_by_key(|p| p.population)
        .map(|p| p.id);

    for req in plan {
        if req.count == 0 {
            continue;
        }
        let (ind_each, money_each, manpower_each) = unit_cost(req.unit_type);

        // How many can we afford across all constraints?
        let by_industry = if ind_each == 0 {
            req.count
        } else {
            industry_remaining / ind_each
        };
        let by_treasury = if money_each <= 0 {
            req.count
        } else {
            (treasury_remaining / money_each).clamp(0, req.count as i64) as u32
        };
        let by_manpower = if manpower_each <= 0 {
            req.count
        } else {
            (manpower_remaining / manpower_each).clamp(0, req.count as i64) as u32
        };
        let granted = req.count.min(by_industry).min(by_treasury).min(by_manpower);

        if granted < req.count {
            let limit = if by_industry <= by_treasury && by_industry <= by_manpower {
                "industry"
            } else if by_treasury <= by_manpower {
                "treasury"
            } else {
                "manpower"
            };
            outcome.denied.push(DeniedProduction {
                unit_type: req.unit_type,
                requested: req.count,
                granted,
                reason: format!("limited by {}", limit),
            });
        }

        if granted == 0 {
            continue;
        }

        let location = req.location_province.or(default_location);
        let Some(loc) = location else {
            // Nation owns no provinces — can't spawn anything.
            continue;
        };

        for _ in 0..granted {
            let id = UnitId::new();
            world.units.push(Unit {
                id,
                owner: nation,
                unit_type: req.unit_type,
                location: loc,
                strength: 100,
                organization: 80,
                experience: 0,
                supply_state: SupplyState::Supplied,
            });
            outcome.spawned.push(id);
        }
        industry_remaining = industry_remaining.saturating_sub(ind_each * granted);
        treasury_remaining = treasury_remaining.saturating_sub(money_each * granted as i64);
        manpower_remaining =
            manpower_remaining.saturating_sub(manpower_each * granted as i64);

        outcome.industry_used += ind_each * granted;
        outcome.treasury_spent += money_each * granted as i64;
        outcome.manpower_spent += manpower_each * granted as i64;
    }

    // Persist the nation deltas.
    let n = &mut world.nations[nation_idx];
    n.treasury = treasury_remaining;
    n.manpower_pool = manpower_remaining;
    // Industry capacity does NOT decrement permanently — it's a per-turn
    // capacity we treat as a budget for this batch only.

    outcome
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
    fn infantry_request_respects_industry_cap() {
        let mut w = fresh_world();
        let nid = w.nations[0].id;
        // Give the nation a known IC.
        if let Some(n) = w.nations.iter_mut().find(|n| n.id == nid) {
            n.industry_capacity = 10;
            n.treasury = 10_000_000_000_000; // effectively unlimited
            n.manpower_pool = 1_000_000_000;
        }
        let out = apply_production(
            &mut w,
            nid,
            vec![ProductionRequest {
                unit_type: UnitType::Infantry,
                count: 50,
                location_province: None,
            }],
        );
        assert_eq!(out.spawned.len(), 10, "should have built exactly 10 infantry");
        assert_eq!(out.denied.len(), 1);
        assert_eq!(out.denied[0].reason, "limited by industry");
    }

    #[test]
    fn empty_treasury_blocks_armor() {
        let mut w = fresh_world();
        let nid = w.nations[0].id;
        if let Some(n) = w.nations.iter_mut().find(|n| n.id == nid) {
            n.industry_capacity = 100;
            n.treasury = 0;
            n.manpower_pool = 1_000_000;
        }
        let out = apply_production(
            &mut w,
            nid,
            vec![ProductionRequest {
                unit_type: UnitType::Armor,
                count: 5,
                location_province: None,
            }],
        );
        assert_eq!(out.spawned.len(), 0);
        assert!(!out.denied.is_empty());
    }

    #[test]
    fn spawns_at_capital_when_no_location_given() {
        let mut w = fresh_world();
        let nid = w.nations[0].id;
        let largest_pop_province = w
            .provinces
            .iter()
            .filter(|p| p.owner == nid)
            .max_by_key(|p| p.population)
            .unwrap()
            .id;
        if let Some(n) = w.nations.iter_mut().find(|n| n.id == nid) {
            n.industry_capacity = 5;
            n.treasury = 10_000_000_000_000;
            n.manpower_pool = 1_000_000;
        }
        let out = apply_production(
            &mut w,
            nid,
            vec![ProductionRequest {
                unit_type: UnitType::Infantry,
                count: 3,
                location_province: None,
            }],
        );
        assert_eq!(out.spawned.len(), 3);
        for uid in &out.spawned {
            let u = w.units.iter().find(|u| u.id == *uid).unwrap();
            assert_eq!(u.location, largest_pop_province);
        }
    }
}
