use serde::{Deserialize, Serialize};

use super::ids::{FrontlineId, NationId, ProvinceId, UnitId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrontPosture {
    Hold,
    Active,
    Retreat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OffensiveKind {
    FullAttack,
    Probe,
    Hold,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Offensive {
    pub source: ProvinceId,
    pub target: ProvinceId,
    pub kind: OffensiveKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frontline {
    pub id: FrontlineId,
    pub owner: NationId,
    pub enemy: NationId,
    pub provinces: Vec<ProvinceId>,
    #[serde(default)]
    pub assigned_units: Vec<UnitId>,
    #[serde(default)]
    pub offensives: Vec<Offensive>,
    pub posture: FrontPosture,
    #[serde(default)]
    pub ai_managed: bool,
    #[serde(default)]
    pub war_goals: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontline_round_trip() {
        let f = Frontline {
            id: FrontlineId::new(),
            owner: NationId::new(),
            enemy: NationId::new(),
            provinces: vec![ProvinceId::new()],
            assigned_units: vec![UnitId::new(), UnitId::new()],
            offensives: vec![Offensive {
                source: ProvinceId::new(),
                target: ProvinceId::new(),
                kind: OffensiveKind::FullAttack,
            }],
            posture: FrontPosture::Active,
            ai_managed: false,
            war_goals: "push to Berlin".into(),
        };
        let json = serde_json::to_string(&f).unwrap();
        let back: Frontline = serde_json::from_str(&json).unwrap();
        assert_eq!(back.posture, FrontPosture::Active);
        assert_eq!(back.assigned_units.len(), 2);
    }
}
