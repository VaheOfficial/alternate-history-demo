use serde::{Deserialize, Serialize};

use super::ids::{NationId, ProvinceId, UnitId};
use super::nation::UnitType;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupplyState {
    Supplied,
    Reduced,
    OutOfSupply,
}

impl Default for SupplyState {
    fn default() -> Self {
        SupplyState::Supplied
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Unit {
    pub id: UnitId,
    pub owner: NationId,
    pub unit_type: UnitType,
    pub location: ProvinceId,
    pub strength: u32,
    pub organization: u32,
    pub experience: u32,
    #[serde(default)]
    pub supply_state: SupplyState,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::nation::UnitType;

    #[test]
    fn unit_serializes_round_trip() {
        let u = Unit {
            id: UnitId::new(),
            owner: NationId::new(),
            unit_type: UnitType::Armor,
            location: ProvinceId::new(),
            strength: 100,
            organization: 80,
            experience: 0,
            supply_state: SupplyState::Supplied,
        };
        let json = serde_json::to_string(&u).unwrap();
        let back: Unit = serde_json::from_str(&json).unwrap();
        assert_eq!(back.unit_type, UnitType::Armor);
        assert_eq!(back.organization, 80);
    }
}
