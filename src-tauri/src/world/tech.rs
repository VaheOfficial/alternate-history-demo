//! Tech research (Plan 12 Phase 4).
//!
//! Six flat-tree technologies, each with a fixed research cost.
//! v1 has no prereqs — the player picks any one as their current
//! research target. Research progress accrues each end_turn at
//! `nation.industry_capacity / 10`. Once progress reaches cost,
//! the tech is unlocked (progress stays at cost; engine looks it
//! up via `Nation::has_tech`).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TechId {
    ImprovedInfantry,
    MechanizedDoctrine,
    ArmoredWarfare,
    Encryption,
    AdvancedLogistics,
    Communications,
}

impl TechId {
    pub fn all() -> [TechId; 6] {
        [
            TechId::ImprovedInfantry,
            TechId::MechanizedDoctrine,
            TechId::ArmoredWarfare,
            TechId::Encryption,
            TechId::AdvancedLogistics,
            TechId::Communications,
        ]
    }

    pub fn label(&self) -> &'static str {
        match self {
            TechId::ImprovedInfantry => "Improved Infantry",
            TechId::MechanizedDoctrine => "Mechanized Doctrine",
            TechId::ArmoredWarfare => "Armored Warfare",
            TechId::Encryption => "Encryption",
            TechId::AdvancedLogistics => "Advanced Logistics",
            TechId::Communications => "Communications",
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            TechId::ImprovedInfantry => {
                "Better small arms + training. +10% infantry strength."
            }
            TechId::MechanizedDoctrine => {
                "Mechanized infantry doctrine. +15% organization on mech units."
            }
            TechId::ArmoredWarfare => {
                "Modern armored warfare. +20% armor combat power."
            }
            TechId::Encryption => {
                "Secure communications. Resists hostile espionage."
            }
            TechId::AdvancedLogistics => {
                "Improved supply network. Units stay supplied at longer range."
            }
            TechId::Communications => {
                "Network-centric warfare. +5% all-unit organization recovery."
            }
        }
    }

    /// Research cost in research points. Each end-turn the nation
    /// gains `industry_capacity / 10` toward its current target.
    pub fn cost(&self) -> u32 {
        match self {
            TechId::ImprovedInfantry => 500,
            TechId::MechanizedDoctrine => 800,
            TechId::ArmoredWarfare => 1200,
            TechId::Encryption => 600,
            TechId::AdvancedLogistics => 700,
            TechId::Communications => 900,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResearchState {
    /// Current research target. None = nothing in progress.
    #[serde(default)]
    pub target: Option<TechId>,
    /// progress[tech] points accumulated. When progress[t] >= t.cost,
    /// the tech is unlocked.
    #[serde(default)]
    pub progress: HashMap<TechId, u32>,
}

impl ResearchState {
    pub fn is_unlocked(&self, tech: TechId) -> bool {
        self.progress.get(&tech).copied().unwrap_or(0) >= tech.cost()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlocked_when_progress_meets_cost() {
        let mut s = ResearchState::default();
        s.progress.insert(TechId::ImprovedInfantry, 500);
        assert!(s.is_unlocked(TechId::ImprovedInfantry));
        assert!(!s.is_unlocked(TechId::ArmoredWarfare));
    }
}
