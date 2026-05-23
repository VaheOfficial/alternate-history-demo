//! War state (Plan 12 Phase 1).
//!
//! When a `DeclareWar` action lands, the engine creates a `War` record on
//! the world. Each tick we recompute `occupation_pct` — the share of the
//! defender's provinces currently held by the aggressor (or any of its
//! co-belligerents). Crossing 30% / 60% / 100% triggers a peace
//! proposal: a `PeaceProposal` is appended to the war, the UI surfaces
//! it under the War screen and the player can `accept_peace_cmd` to
//! sign a peace treaty + (optionally) transfer the contested territory.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::ids::{NationId, ProvinceId};

/// What the aggressor is fighting FOR. Determines the shape of the
/// peace deal at the end. We don't model fractional war-score yet —
/// it's binary: either you crossed the threshold or you didn't.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Copy)]
#[serde(rename_all = "snake_case")]
pub enum CasusBelli {
    /// Take specific provinces. Peace deal includes a TransferTerritory
    /// of every defender province currently occupied by the aggressor.
    AnnexProvinces,
    /// Install a friendly government. Peace = ChangeGovernment in the
    /// loser to match the aggressor's, + reset relations.
    InstallPuppet,
    /// One-time concession. Peace = +20 aggressor stability + drop
    /// loser relations heavily.
    ForceConcession,
    /// Strip the loser's military. Peace = aggressor relations reset
    /// + (Phase 4) loser industry cap halved for a period. v1 just
    /// applies a deep relation penalty + stability hit.
    Demilitarize,
    /// Default / catchall — pure prestige war.
    HumiliateRival,
    /// Help a third party throw off a senior. v1 same effect as
    /// HumiliateRival but with a different narrative tag.
    FreeNation,
}

impl CasusBelli {
    pub fn label(&self) -> &'static str {
        match self {
            CasusBelli::AnnexProvinces => "Annex contested provinces",
            CasusBelli::InstallPuppet => "Install friendly government",
            CasusBelli::ForceConcession => "Force a concession",
            CasusBelli::Demilitarize => "Demilitarize the loser",
            CasusBelli::HumiliateRival => "Humiliate the rival",
            CasusBelli::FreeNation => "Liberate a satellite",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WarStatus {
    /// Active hostilities. Combat resolutions still count toward occupation%.
    Active,
    /// Player accepted a peace proposal; world.treaties has the treaty.
    Concluded,
    /// White peace — both sides walked. No CB satisfied.
    WhitePeace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct War {
    pub id: String,
    pub aggressor: NationId,
    /// One or more defender nations (we don't model wide alliance
    /// chains yet; v1 = single defender, but the field is a Vec so we
    /// can grow it later).
    pub defenders: Vec<NationId>,
    pub declared_on: NaiveDate,
    pub casus_belli: CasusBelli,
    /// 0-100. Share of defender provinces currently owned by the
    /// aggressor. Recomputed every end-turn.
    #[serde(default)]
    pub occupation_pct: u8,
    /// Provinces conquered by the aggressor since the war started.
    /// Used to build the AnnexProvinces peace deal.
    #[serde(default)]
    pub conquered_provinces: Vec<ProvinceId>,
    pub status: WarStatus,
    /// Auto-generated peace proposals attached to the war as
    /// occupation crosses thresholds. Each carries a list of typed
    /// actions to apply if the player accepts.
    #[serde(default)]
    pub peace_proposals: Vec<PeaceProposal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeaceProposal {
    pub id: String,
    /// Which side is offering. v1: the loser always offers; if the
    /// aggressor is losing, no proposal spawns (they can press on or
    /// concede via the conclude run flow).
    pub from: NationId,
    pub created_on: NaiveDate,
    /// Threshold that triggered this (30 / 60 / 100).
    pub threshold: u8,
    pub headline: String,
    pub narrative: String,
    /// Typed actions to apply when the player accepts. Same shape the
    /// validator emits, applied via the same `apply_actions` pipeline.
    pub actions: Vec<crate::world::action::TypedAction>,
    #[serde(default)]
    pub accepted: bool,
    #[serde(default)]
    pub rejected: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn war_round_trips() {
        let w = War {
            id: "w1".into(),
            aggressor: NationId::new(),
            defenders: vec![NationId::new()],
            declared_on: NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
            casus_belli: CasusBelli::AnnexProvinces,
            occupation_pct: 0,
            conquered_provinces: vec![],
            status: WarStatus::Active,
            peace_proposals: vec![],
        };
        let json = serde_json::to_string(&w).unwrap();
        let back: War = serde_json::from_str(&json).unwrap();
        assert!(matches!(back.casus_belli, CasusBelli::AnnexProvinces));
        assert!(matches!(back.status, WarStatus::Active));
    }
}
