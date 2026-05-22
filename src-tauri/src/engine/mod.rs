//! Deterministic engine — applies typed actions and advances the clock.
//!
//! This is the *trusted* side: the LLM proposes things, the engine decides
//! what actually happens. No randomness here yet — Plan 04 Phase C is the
//! first slice; combat resolution, supply, production all land in Plan 05+.

pub mod apply;
pub mod combat;
pub mod economy;
pub mod npc_turn;
pub mod production;
pub mod tick;

pub use apply::{apply_actions, ApplyOutcome};
pub use combat::{resolve_movement, MovementOutcome};
pub use economy::run_economy_tick;
pub use npc_turn::{run_npc_turn, NationTurn, NpcTurnResult, OrchestratorPick};
pub use production::{apply_production, ProductionOutcome, ProductionRequest};
pub use tick::advance_clock;
