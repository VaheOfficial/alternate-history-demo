use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::ids::{NationId, NpcId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NpcRole {
    Leader,
    Advisor,
    General,
    ForeignMinister,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PersonaArchetype {
    Hawkish,
    Dovish,
    Pragmatist,
    Ideologue,
    Opportunist,
    Bureaucrat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeechStyle {
    Terse,
    Verbose,
    Formal,
    Folksy,
    Sarcastic,
    Cold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ideology {
    Marxist,
    Liberal,
    Conservative,
    Fascist,
    Nationalist,
    Pacifist,
    Centrist,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpcPersona {
    pub archetype: PersonaArchetype,
    #[serde(default)]
    pub traits: Vec<String>,
    pub speech_style: SpeechStyle,
    pub ideology: Ideology,
    #[serde(default)]
    pub historical_quirks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grudge {
    pub against_nation: Option<NationId>,
    pub against_npc: Option<NpcId>,
    pub date: NaiveDate,
    pub intensity: i32,
    pub description: String,
    pub decay_rate: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Npc {
    pub id: NpcId,
    pub name: String,
    pub nation: NationId,
    pub role: NpcRole,
    pub persona: NpcPersona,
    pub opinion_of_player: i32,
    #[serde(default)]
    pub grudges: Vec<Grudge>,
    #[serde(default)]
    pub relationships: HashMap<NpcId, i32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npc_round_trips_with_grudge() {
        let n = Npc {
            id: NpcId::new(),
            name: "Test".into(),
            nation: NationId::new(),
            role: NpcRole::Leader,
            persona: NpcPersona {
                archetype: PersonaArchetype::Hawkish,
                traits: vec!["paranoid".into()],
                speech_style: SpeechStyle::Terse,
                ideology: Ideology::Nationalist,
                historical_quirks: vec![],
            },
            opinion_of_player: -20,
            grudges: vec![Grudge {
                against_nation: Some(NationId::new()),
                against_npc: None,
                date: NaiveDate::from_ymd_opt(1939, 9, 1).unwrap(),
                intensity: 75,
                description: "betrayed in Munich".into(),
                decay_rate: 0.05,
            }],
            relationships: HashMap::new(),
        };
        let json = serde_json::to_string(&n).unwrap();
        let back: Npc = serde_json::from_str(&json).unwrap();
        assert_eq!(back.grudges.len(), 1);
        assert_eq!(back.grudges[0].intensity, 75);
    }
}
