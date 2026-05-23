//! Multi-turn production queue (Plan 12 Phase 4).
//!
//! Each player order accrues industry capacity each end_turn. Once a
//! unit's industry cost is fully paid, treasury + manpower are spent
//! and one unit spawns at the requested location. Repeats until the
//! ordered count is complete.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::ids::{NationId, ProvinceId};
use super::nation::UnitType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductionOrder {
    pub id: String,
    pub owner: NationId,
    pub unit_type: UnitType,
    /// Total number of units the player wants.
    pub count: u32,
    /// Units already spawned by previous accrual ticks.
    #[serde(default)]
    pub built: u32,
    /// Province to spawn each finished unit. None → engine picks the
    /// nation's largest-pop province at spawn time.
    pub location: Option<ProvinceId>,
    /// Industry points required PER UNIT.
    pub industry_cost_per: u32,
    /// Industry accumulated toward the NEXT unit (resets after each spawn).
    #[serde(default)]
    pub industry_paid: u32,
    pub treasury_cost_per: i64,
    pub manpower_cost_per: i64,
    pub created_on: NaiveDate,
}

impl ProductionOrder {
    pub fn remaining(&self) -> u32 {
        self.count.saturating_sub(self.built)
    }
    pub fn is_complete(&self) -> bool {
        self.remaining() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::NationId;

    #[test]
    fn production_order_round_trips() {
        let o = ProductionOrder {
            id: "p1".into(),
            owner: NationId::new(),
            unit_type: UnitType::Infantry,
            count: 5,
            built: 1,
            location: None,
            industry_cost_per: 1,
            industry_paid: 0,
            treasury_cost_per: 80_000_000,
            manpower_cost_per: 8_000,
            created_on: NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        };
        let json = serde_json::to_string(&o).unwrap();
        let back: ProductionOrder = serde_json::from_str(&json).unwrap();
        assert_eq!(back.count, 5);
        assert_eq!(back.remaining(), 4);
    }
}
