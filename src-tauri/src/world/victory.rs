//! Victory / endgame state (Plan 12 Phase 6).
//!
//! Four ways the run can end:
//!   - `Hegemon`         — player controls > 60% of world population AND
//!                         > 60% of world industry. The "dominance" path.
//!   - `UniversalEmpire` — every other nation with pop > 10M is either
//!                         annexed OR vassalized to the player. The
//!                         "total conquest" path; rarer + harder.
//!   - `Survivor`        — game date >= 2050-01-01. Not a "victory" in
//!                         the dominance sense — the world endured.
//!   - `Concluded`       — player explicitly hit "Concede this run" in
//!                         the menu. The "I'm done" exit.
//!
//! See `docs/superpowers/plans/2026-05-22-plan-12-gameplay-depth.md`.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VictoryKind {
    Hegemon,
    UniversalEmpire,
    Survivor,
    Concluded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Victory {
    pub kind: VictoryKind,
    pub triggered_on: NaiveDate,
    pub headline: String,
    /// One-paragraph in-character summary the UI can show in the
    /// victory modal. Generated cheaply server-side, not via LLM.
    pub summary: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn victory_round_trips() {
        let v = Victory {
            kind: VictoryKind::Hegemon,
            triggered_on: NaiveDate::from_ymd_opt(2030, 1, 1).unwrap(),
            headline: "Hegemon".into(),
            summary: "Dominant global power".into(),
        };
        let json = serde_json::to_string(&v).unwrap();
        let back: Victory = serde_json::from_str(&json).unwrap();
        assert!(matches!(back.kind, VictoryKind::Hegemon));
    }
}
