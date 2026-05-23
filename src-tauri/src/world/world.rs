use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::battle_plan::BattlePlan;
use super::clock::GameClock;
use super::crisis::Crisis;
use super::diplomacy::DiplomaticChannel;
use super::event::Event;
use super::frontline::Frontline;
use super::ids::{BranchId, NationId, SaveId};
use super::nation::Nation;
use super::npc::Npc;
use super::pending::PendingAction;
use super::province::Province;
use super::treaty::Treaty;
use super::unit::Unit;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct World {
    pub save_id: SaveId,
    pub branch_id: BranchId,
    pub clock: GameClock,
    pub player_nation: Option<NationId>,
    pub nations: Vec<Nation>,
    pub provinces: Vec<Province>,
    pub units: Vec<Unit>,
    pub npcs: Vec<Npc>,
    pub treaties: Vec<Treaty>,
    pub crises: Vec<Crisis>,
    pub frontlines: Vec<Frontline>,
    pub events: Vec<Event>,
    /// Multi-turn operations awaiting their completion date.
    /// Player can queue arbitrarily ambitious intents (invasion, tech
    /// projects, mega-construction) — engine ticks them each end-turn.
    #[serde(default)]
    pub pending: Vec<PendingAction>,
    /// HOI4-style player-drawn movement plans. See
    /// `world::battle_plan::BattlePlan` and Plan 10.
    #[serde(default)]
    pub battle_plans: Vec<BattlePlan>,
    /// Multi-NPC diplomatic group chats opened by the player. See
    /// `world::diplomacy::DiplomaticChannel` and Plan 11.
    #[serde(default)]
    pub diplomatic_channels: Vec<DiplomaticChannel>,
}

impl World {
    /// Construct a minimal empty world. Used by tests + scenario bootstrap (later plans).
    /// Not behind `#[cfg(test)]` because integration tests live in a separate crate
    /// and can only see public, non-test-gated items.
    pub fn empty(save: SaveId, branch: BranchId, start: NaiveDate) -> Self {
        Self {
            save_id: save,
            branch_id: branch,
            clock: GameClock::new(start),
            player_nation: None,
            nations: vec![],
            provinces: vec![],
            units: vec![],
            npcs: vec![],
            treaties: vec![],
            crises: vec![],
            frontlines: vec![],
            events: vec![],
            pending: vec![],
            battle_plans: vec![],
            diplomatic_channels: vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_world_serializes_round_trip() {
        let w = World::empty(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(1939, 9, 1).unwrap(),
        );
        let json = serde_json::to_string(&w).unwrap();
        let back: World = serde_json::from_str(&json).unwrap();
        assert_eq!(back.clock.round, 0);
        assert_eq!(back.nations.len(), 0);
    }
}
