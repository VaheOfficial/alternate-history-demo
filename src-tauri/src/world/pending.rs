//! Multi-turn pending operations.
//!
//! Some player intents — "invade Canada", "develop UFO tech", "build a moon
//! base" — can't realistically complete in a single 7-day turn. The
//! validator queues them as `PendingAction`s with a completion date; each
//! end_turn ticks them down, and when the date arrives the engine applies
//! the on-complete typed actions.
//!
//! Player imagination is the limit. The game adjudicator does NOT veto
//! actions for realism; it just translates "I want X" into "X completes in
//! Y days" + the mechanical actions that fire on completion.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::action::TypedAction;
use super::ids::NationId;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingAction {
    /// Unique identifier (UUID-as-string for portability).
    pub id: String,
    /// Nation that initiated the operation (player or NPC).
    pub initiator: NationId,
    /// Human-readable name shown in the UI ("Invasion of Canada", "Lunar base").
    pub label: String,
    /// LLM's narrative describing the operation.
    pub narrative: String,
    /// When the player issued the order.
    pub started_on: NaiveDate,
    /// Date when the on_complete actions fire.
    pub completes_on: NaiveDate,
    /// Progress 0..100. Visualised as a progress bar.
    pub progress_pct: u8,
    /// Typed actions to apply when completion arrives.
    #[serde(default)]
    pub on_complete: Vec<TypedAction>,
}
