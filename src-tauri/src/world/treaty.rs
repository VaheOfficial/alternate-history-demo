use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::ids::{NationId, TreatyId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TreatyKind {
    NonAggression,
    DefensivePact,
    Alliance,
    TradeAgreement,
    Ceasefire,
    PeaceTreaty,
    Vassalage,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TreatyTerms {
    #[serde(default)]
    pub territory_transfers: Vec<TerritoryTransfer>,
    #[serde(default)]
    pub tribute_per_year: i64,
    #[serde(default)]
    pub extra_clauses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerritoryTransfer {
    pub from: NationId,
    pub to: NationId,
    pub province_geometry_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Treaty {
    pub id: TreatyId,
    pub kind: TreatyKind,
    pub parties: Vec<NationId>,
    pub signed_on: NaiveDate,
    pub expires_on: Option<NaiveDate>,
    #[serde(default)]
    pub terms: TreatyTerms,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treaty_round_trip() {
        let t = Treaty {
            id: TreatyId::new(),
            kind: TreatyKind::NonAggression,
            parties: vec![NationId::new(), NationId::new()],
            signed_on: NaiveDate::from_ymd_opt(1939, 8, 23).unwrap(),
            expires_on: None,
            terms: TreatyTerms::default(),
        };
        let json = serde_json::to_string(&t).unwrap();
        let back: Treaty = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, TreatyKind::NonAggression);
        assert_eq!(back.parties.len(), 2);
    }
}
