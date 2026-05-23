use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::action::TypedAction;
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

/// One of the player's choices for resolving a crisis. The label and
/// narrative are shown in the UI; the `actions` are applied via the
/// engine's apply_actions when the player picks this option.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrisisOption {
    pub label: String,
    pub narrative: String,
    #[serde(default)]
    pub actions: Vec<TypedAction>,
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
    /// Decision options for the player. Empty list = informational
    /// crisis (just an event card with no decision required); the
    /// player still dismisses it but no actions fire.
    #[serde(default)]
    pub options: Vec<CrisisOption>,
    /// Round by which the crisis MUST be resolved. After this, option 0
    /// (the first) is applied automatically and the crisis is removed.
    /// None = no deadline.
    #[serde(default)]
    pub deadline_round: Option<u32>,
    /// Date the crisis was created. Useful for UI sorting + "X days
    /// ago" labels.
    #[serde(default)]
    pub created_on: Option<NaiveDate>,
    /// True once the player picked an option (or the deadline passed
    /// and option 0 auto-applied). Kept on the world so the UI can
    /// fade it out instead of vanishing.
    #[serde(default)]
    pub resolved: bool,
    /// Index of the option that resolved this crisis. None if still pending.
    #[serde(default)]
    pub resolved_option: Option<usize>,
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
            options: vec![],
            deadline_round: Some(10),
            created_on: None,
            resolved: false,
            resolved_option: None,
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: Crisis = serde_json::from_str(&json).unwrap();
        assert_eq!(back.escalation, EscalationLevel(5));
        assert_eq!(back.deadline_round, Some(10));
    }
}
