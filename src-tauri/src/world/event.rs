use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::action::TypedAction;
use super::ids::{EventId, NationId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventCategory {
    Military,
    Diplomatic,
    Economic,
    Political,
    Social,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Visibility {
    Global,
    NationOnly { nation: NationId },
    Hidden,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: EventId,
    pub round: u32,
    pub timestamp: NaiveDate,
    pub category: EventCategory,
    pub headline: String,
    pub narrative: String,
    #[serde(default)]
    pub typed_actions: Vec<TypedAction>,
    pub visibility: Visibility,
    /// Filled later by the Event Consolidator (Plan 09). Not persisted in Plan 02.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
    #[serde(default)]
    pub interrupts_player: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_round_trip() {
        let e = Event {
            id: EventId::new(),
            round: 3,
            timestamp: NaiveDate::from_ymd_opt(1939, 9, 1).unwrap(),
            category: EventCategory::Military,
            headline: "German invasion of Poland".into(),
            narrative: "At dawn on 1 September 1939...".into(),
            typed_actions: vec![],
            visibility: Visibility::Global,
            embedding: None,
            interrupts_player: true,
        };
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert!(back.interrupts_player);
    }
}
