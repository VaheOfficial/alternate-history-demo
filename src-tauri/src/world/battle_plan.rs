//! Battle plans — HOI4-style strategic intent the player draws on the map.
//!
//! A plan picks one or more SOURCE provinces (where the player has units)
//! and a TARGET province (where they want to push them toward). Plans
//! live on the world until the player executes or cancels them. Executing
//! a plan moves units one HOP closer to the target along the land
//! adjacency graph; the same `resolve_movement` engine that powers
//! shift+click handles peacetime guards / combat / conquest.
//!
//! See `docs/superpowers/plans/2026-05-22-plan-10-battle-plans.md`.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::ids::{NationId, ProvinceId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BattlePlanStatus {
    /// On the map, waiting for Execute.
    Planned,
    /// Player ran Execute at least once. Plan stays around so it can be
    /// re-executed each turn to march further; status is informational.
    Executed,
    /// Player dismissed it.
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BattlePlan {
    pub id: String,
    pub owner: NationId,
    pub target: ProvinceId,
    pub sources: Vec<ProvinceId>,
    pub status: BattlePlanStatus,
    pub created_on: NaiveDate,
    /// Number of times the player has pressed Execute. Helpful so the UI
    /// can show "marched 3 hops" or similar.
    #[serde(default)]
    pub executions: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::{NationId, ProvinceId};

    #[test]
    fn battle_plan_round_trips_via_serde() {
        let p = BattlePlan {
            id: "abc".into(),
            owner: NationId::new(),
            target: ProvinceId::new(),
            sources: vec![ProvinceId::new(), ProvinceId::new()],
            status: BattlePlanStatus::Planned,
            created_on: NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
            executions: 0,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: BattlePlan = serde_json::from_str(&json).unwrap();
        assert_eq!(back.sources.len(), 2);
        assert!(matches!(back.status, BattlePlanStatus::Planned));
    }
}
