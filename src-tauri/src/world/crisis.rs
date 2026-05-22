use serde::{Deserialize, Serialize};

use super::ids::{CrisisId, NationId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrisisCategory {
    Diplomatic,
    Military,
    Economic,
    Political,
    Humanitarian,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EscalationLevel(pub u8);

impl Default for EscalationLevel {
    fn default() -> Self {
        Self(0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Crisis {
    pub id: CrisisId,
    pub headline: String,
    pub category: CrisisCategory,
    pub parties: Vec<NationId>,
    pub stakes: String,
    #[serde(default)]
    pub escalation: EscalationLevel,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crisis_round_trip() {
        let c = Crisis {
            id: CrisisId::new(),
            headline: "Sudetenland tensions".into(),
            category: CrisisCategory::Diplomatic,
            parties: vec![NationId::new(), NationId::new()],
            stakes: "Border territory and ethnic German minority".into(),
            escalation: EscalationLevel(5),
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: Crisis = serde_json::from_str(&json).unwrap();
        assert_eq!(back.escalation, EscalationLevel(5));
    }
}
