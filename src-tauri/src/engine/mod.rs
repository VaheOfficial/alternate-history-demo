//! Deterministic engine — applies typed actions and advances the clock.
//!
//! This is the *trusted* side: the LLM proposes things, the engine decides
//! what actually happens. No randomness here yet — Plan 04 Phase C is the
//! first slice; combat resolution, supply, production all land in Plan 05+.

pub mod adjacency;
pub mod apply;
pub mod combat;
pub mod crises;
pub mod economy;
#[cfg(test)]
pub mod mock_provider;
pub mod npc_turn;
pub mod pending;
pub mod production;
pub mod tick;
pub mod victory;
pub mod war;

pub use apply::{apply_actions, ApplyOutcome};
pub use combat::{resolve_movement, MovementOutcome};
pub use economy::run_economy_tick;
pub use npc_turn::{run_npc_turn, NationTurn, NpcTurnResult, OrchestratorPick};
pub use pending::tick_pending;
pub use production::{apply_production, ProductionOutcome, ProductionRequest};
pub use tick::advance_clock;
pub use victory::{check_victory, compute_progress, mark_concluded, VictoryProgress};
pub use war::{accept_peace_proposal, reject_peace_proposal, tick_wars};
pub use crises::{resolve_crisis, tick_crises};
