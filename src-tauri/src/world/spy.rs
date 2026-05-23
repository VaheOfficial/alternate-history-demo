//! Espionage data model (Plan 12 Phase 5).
//!
//! v1 only models PLAYER spy missions. NPC spy activity is deferred.
//! Each mission has a target nation, a kind (StealTech etc.), a days
//! countdown until resolution, and a success_pct. Resolution happens
//! at end_turn; outcomes mutate the target nation or queue typed
//! actions on the world.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::ids::NationId;
use super::tech::TechId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpyMissionKind {
    /// Lift a specific tech from the target. Success → player gains
    /// 50% of the tech's cost as research progress on that tech.
    StealTech,
    /// Sabotage the target's industry. Success → target loses 5 IC
    /// for 60 days (pending op).
    SabotageIndustry,
    /// Quietly observe the target. Success → an intel report is
    /// stamped + (Phase 9-style) fog widens for 30 days; v1 just
    /// produces the report.
    GatherIntel,
}

impl SpyMissionKind {
    pub fn label(&self) -> &'static str {
        match self {
            SpyMissionKind::StealTech => "Steal Technology",
            SpyMissionKind::SabotageIndustry => "Sabotage Industry",
            SpyMissionKind::GatherIntel => "Gather Intelligence",
        }
    }
    pub fn base_success_pct(&self) -> u8 {
        match self {
            SpyMissionKind::StealTech => 35,
            SpyMissionKind::SabotageIndustry => 45,
            SpyMissionKind::GatherIntel => 70,
        }
    }
    pub fn days_to_resolve(&self) -> i64 {
        match self {
            SpyMissionKind::StealTech => 28,
            SpyMissionKind::SabotageIndustry => 21,
            SpyMissionKind::GatherIntel => 14,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpyMission {
    pub id: String,
    pub target: NationId,
    pub kind: SpyMissionKind,
    pub started_on: NaiveDate,
    pub resolves_on: NaiveDate,
    pub success_pct: u8,
    /// For StealTech missions, which tech we're after.
    #[serde(default)]
    pub tech_target: Option<TechId>,
    #[serde(default)]
    pub resolved: bool,
    #[serde(default)]
    pub outcome: Option<SpyOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum SpyOutcome {
    Success { narrative: String },
    Failure { narrative: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mission_round_trips() {
        let m = SpyMission {
            id: "m1".into(),
            target: NationId::new(),
            kind: SpyMissionKind::StealTech,
            started_on: NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
            resolves_on: NaiveDate::from_ymd_opt(2026, 6, 19).unwrap(),
            success_pct: 35,
            tech_target: Some(TechId::Encryption),
            resolved: false,
            outcome: None,
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: SpyMission = serde_json::from_str(&json).unwrap();
        assert!(matches!(back.kind, SpyMissionKind::StealTech));
        assert!(matches!(back.tech_target, Some(TechId::Encryption)));
    }
}
