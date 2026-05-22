use serde::{Deserialize, Serialize};

use super::ids::{NationId, ProvinceId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Terrain {
    Plains,
    Forest,
    HillsRough,
    Mountains,
    Urban,
    Desert,
    River,
    Coastal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ResourceYield {
    #[serde(default)]
    pub steel: u32,
    #[serde(default)]
    pub oil: u32,
    #[serde(default)]
    pub rubber: u32,
    #[serde(default)]
    pub tungsten: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Province {
    pub id: ProvinceId,
    pub name: String,
    /// GADM polygon reference. Opaque string in Plan 02; real lookup in Plan 03.
    pub geometry_ref: String,
    pub owner: NationId,
    #[serde(default)]
    pub core_of: Vec<NationId>,
    pub terrain: Terrain,
    pub population: i64,
    pub base_industry: u32,
    #[serde(default)]
    pub base_resources: ResourceYield,
    pub supply_value: u32,
    pub is_capital: bool,
    pub is_supply_hub: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn province_serializes_round_trip() {
        let p = Province {
            id: ProvinceId::new(),
            name: "Bavaria".into(),
            geometry_ref: "DEU.2_1".into(),
            owner: NationId::new(),
            core_of: Vec::new(),
            terrain: Terrain::Forest,
            population: 12_000_000,
            base_industry: 5,
            base_resources: ResourceYield::default(),
            supply_value: 3,
            is_capital: false,
            is_supply_hub: false,
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: Province = serde_json::from_str(&json).unwrap();
        assert_eq!(back.terrain, Terrain::Forest);
        assert_eq!(back.geometry_ref, "DEU.2_1");
    }
}
