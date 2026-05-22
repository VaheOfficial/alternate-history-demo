//! Deterministic engine — applies typed actions and advances the clock.
//!
//! This is the *trusted* side: the LLM proposes things, the engine decides
//! what actually happens. No randomness here yet — Plan 04 Phase C is the
//! first slice; combat resolution, supply, production all land in Plan 05+.

pub mod apply;
pub mod tick;

pub use apply::{apply_actions, ApplyOutcome};
pub use tick::advance_clock;
