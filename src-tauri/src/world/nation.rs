use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::ids::{NationId, NpcId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GovernmentType {
    Democracy,
    Monarchy,
    Republic,
    Communist,
    Fascist,
    MilitaryJunta,
    Theocracy,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DoctrineId {
    MobileWarfare,
    DefenseInDepth,
    MassAssault,
    SuperiorFirepower,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Resource {
    Steel,
    Oil,
    Rubber,
    Tungsten,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ResourceStockpile {
    #[serde(default)]
    pub steel: i64,
    #[serde(default)]
    pub oil: i64,
    #[serde(default)]
    pub rubber: i64,
    #[serde(default)]
    pub tungsten: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndustrySplit {
    pub civilian: u8,
    pub military: u8,
    pub research: u8,
}

impl Default for IndustrySplit {
    fn default() -> Self {
        Self {
            civilian: 60,
            military: 30,
            research: 10,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TechLevel(pub u8);

impl Default for TechLevel {
    fn default() -> Self {
        Self(1)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitType {
    Infantry,
    Armor,
    Mechanized,
    Artillery,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BuildOrder {
    pub unit_type: UnitType,
    pub progress: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nation {
    pub id: NationId,
    pub name: String,
    /// ISO 3166-1 alpha-3 code (e.g. "USA"). Used to join with Natural Earth
    /// province + country data. Empty for fictional / sub-national nations
    /// created mid-game.
    #[serde(default)]
    pub iso_a3: String,
    pub government: GovernmentType,
    pub leader: NpcId,

    pub treasury: i64,
    pub gdp: i64,
    pub population: i64,
    pub manpower_pool: i64,
    pub stability: i32,
    pub war_support: i32,

    pub industry_capacity: u32,
    #[serde(default)]
    pub industry_split: IndustrySplit,
    #[serde(default)]
    pub resources: ResourceStockpile,
    #[serde(default)]
    pub tech: TechLevel,
    pub doctrine: DoctrineId,

    /// Natural Earth `mapcolor13` (1..13) — adjacent-country-aware color
    /// index. Drives default UI fill in absence of player overrides.
    #[serde(default = "default_map_color")]
    pub map_color: u8,

    #[serde(default)]
    pub relations: HashMap<NationId, i32>,

    #[serde(default)]
    pub build_queue: Vec<BuildOrder>,

    /// Short text directives the nation pursues — feeds the NPC actor prompt
    /// so each LLM call gets that nation's voice + intent. Evolves over time
    /// as the LLM updates them through `NationTurn.goal_update`.
    #[serde(default)]
    pub goals: Vec<String>,

    /// Internal factions (Plan 12 Phase 3). 3-5 entries seeded from
    /// government type. Power + satisfaction shift as policy + war
    /// outcomes happen.
    #[serde(default)]
    pub factions: Vec<crate::world::faction::Faction>,
}

fn default_map_color() -> u8 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::NpcId;

    #[test]
    fn nation_serializes_round_trip() {
        let n = Nation {
            id: NationId::new(),
            name: "Test".into(),
            iso_a3: "TST".into(),
            government: GovernmentType::Democracy,
            leader: NpcId::new(),
            treasury: 100,
            gdp: 1000,
            population: 50_000_000,
            manpower_pool: 5_000_000,
            stability: 60,
            war_support: 40,
            industry_capacity: 20,
            industry_split: IndustrySplit::default(),
            resources: ResourceStockpile::default(),
            tech: TechLevel::default(),
            doctrine: DoctrineId::DefenseInDepth,
            map_color: 1,
            relations: HashMap::new(),
            build_queue: Vec::new(),
            goals: vec!["test goal".into()],
            factions: vec![],
        };
        let json = serde_json::to_string(&n).unwrap();
        let back: Nation = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, n.name);
        assert_eq!(back.doctrine, DoctrineId::DefenseInDepth);
    }
}
