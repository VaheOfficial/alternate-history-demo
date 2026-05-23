//! Internal factions for each nation (Plan 12 Phase 3).
//!
//! Each nation has 3-5 factions drawn from a small set of archetypes.
//! Each carries `power` (how much they sway national decisions, 0-100)
//! and `satisfaction` (how content they are with current policy,
//! 0-100). Player and engine actions move satisfaction; low
//! satisfaction × high power = coup risk (deferred to a later
//! iteration, model just records the state in v1).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactionArchetype {
    Military,
    Business,
    Religious,
    Populist,
    Intellectual,
}

impl FactionArchetype {
    pub fn label(&self) -> &'static str {
        match self {
            FactionArchetype::Military => "Military",
            FactionArchetype::Business => "Business",
            FactionArchetype::Religious => "Religious",
            FactionArchetype::Populist => "Populist",
            FactionArchetype::Intellectual => "Intellectual",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Faction {
    pub archetype: FactionArchetype,
    pub power: u8,
    pub satisfaction: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faction_round_trips() {
        let f = Faction {
            archetype: FactionArchetype::Military,
            power: 60,
            satisfaction: 40,
        };
        let json = serde_json::to_string(&f).unwrap();
        let back: Faction = serde_json::from_str(&json).unwrap();
        assert_eq!(back.power, 60);
        assert!(matches!(back.archetype, FactionArchetype::Military));
    }
}
