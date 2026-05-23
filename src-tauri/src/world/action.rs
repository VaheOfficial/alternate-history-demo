use serde::{Deserialize, Serialize};

use super::ids::{NationId, NpcId, ProvinceId, UnitId};
use super::nation::{GovernmentType, Resource, UnitType};
use super::treaty::{TreatyKind, TreatyTerms};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferReason {
    Conquest,
    Treaty,
    Secession,
    Decolonization,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeReason {
    Election,
    Coup,
    Revolution,
    Abdication,
    ForeignImposition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TypedAction {
    DeclareWar {
        aggressor: NationId,
        target: NationId,
        justification: String,
        /// Optional casus belli. When None on deserialize, the engine
        /// defaults to HumiliateRival (Plan 12 Phase 1). Existing saves
        /// + LLM outputs without this field still deserialize cleanly.
        #[serde(default)]
        casus_belli: Option<crate::world::war::CasusBelli>,
    },
    SignTreaty {
        parties: Vec<NationId>,
        kind: TreatyKind,
        terms: TreatyTerms,
    },
    TransferTerritory {
        from: NationId,
        to: NationId,
        provinces: Vec<ProvinceId>,
        mechanism: TransferReason,
    },
    ModifyRelation {
        from: NationId,
        to: NationId,
        delta: i32,
        reason: String,
    },
    SpawnUnit {
        owner: NationId,
        unit_type: UnitType,
        location: ProvinceId,
        strength: u32,
    },
    MoveUnit {
        unit: UnitId,
        target: ProvinceId,
    },
    ChangeGovernment {
        nation: NationId,
        new_form: GovernmentType,
        mechanism: ChangeReason,
    },
    AssassinateNpc {
        target: NpcId,
    },
    ModifyResource {
        nation: NationId,
        resource: Resource,
        delta: i64,
    },
    ModifyStability {
        nation: NationId,
        delta: i32,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declare_war_round_trip() {
        let a = TypedAction::DeclareWar {
            aggressor: NationId::new(),
            target: NationId::new(),
            justification: "Casus belli over Sudetenland".into(),
            casus_belli: None,
        };
        let json = serde_json::to_string(&a).unwrap();
        let back: TypedAction = serde_json::from_str(&json).unwrap();
        match back {
            TypedAction::DeclareWar { justification, .. } => {
                assert!(justification.contains("Sudetenland"));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn typed_action_uses_action_tag() {
        let a = TypedAction::ModifyStability {
            nation: NationId::new(),
            delta: -5,
        };
        let json = serde_json::to_string(&a).unwrap();
        assert!(
            json.contains("\"action\":\"modify_stability\""),
            "expected action tag, got: {}",
            json
        );
    }
}
