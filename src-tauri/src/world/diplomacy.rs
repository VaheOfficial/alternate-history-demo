//! Diplomatic channels — multi-NPC group chat data model (Plan 11).
//!
//! A channel persists on the World until explicitly closed. Each message
//! records its speaker (nation), the in-character content, and any
//! advisory typed_actions the LLM proposed (e.g. "I propose we sign a
//! non-aggression pact" carrying a SignTreaty action). The player then
//! decides whether to enact a proposal.
//!
//! See `docs/superpowers/plans/2026-05-22-plan-11-diplomacy-chats.md`.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::action::TypedAction;
use super::ids::NationId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelStatus {
    Open,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiplomaticMessage {
    pub id: String,
    pub speaker: NationId,
    pub content: String,
    pub timestamp: NaiveDate,
    /// Actions proposed by the speaker, advisory only — the player enacts
    /// them manually via `enact_diplomatic_proposal_cmd`.
    #[serde(default)]
    pub proposed_actions: Vec<TypedAction>,
    /// True once the player has run `enact_diplomatic_proposal_cmd` for
    /// this message. UI uses this to grey out the Enact button.
    #[serde(default)]
    pub enacted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiplomaticChannel {
    pub id: String,
    pub participants: Vec<NationId>,
    #[serde(default)]
    pub messages: Vec<DiplomaticMessage>,
    pub status: ChannelStatus,
    pub opened_on: NaiveDate,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::NationId;

    #[test]
    fn diplomatic_channel_round_trips() {
        let c = DiplomaticChannel {
            id: "abc".into(),
            participants: vec![NationId::new(), NationId::new()],
            messages: vec![DiplomaticMessage {
                id: "m1".into(),
                speaker: NationId::new(),
                content: "Hello".into(),
                timestamp: NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
                proposed_actions: vec![],
                enacted: false,
            }],
            status: ChannelStatus::Open,
            opened_on: NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: DiplomaticChannel = serde_json::from_str(&json).unwrap();
        assert_eq!(back.participants.len(), 2);
        assert_eq!(back.messages.len(), 1);
        assert!(matches!(back.status, ChannelStatus::Open));
    }
}
