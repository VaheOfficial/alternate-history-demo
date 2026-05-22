//! NPC turn orchestrator.
//!
//! Each turn, the LLM is asked TWICE per nation: once as a global orchestrator
//! to pick a small set of nations that would plausibly act this period, then
//! once per picked nation to generate that nation's actions.
//!
//! The NPC turn is independent of the player turn — `end_turn_cmd` advances
//! the clock and runs economy ticks deterministically; this module is called
//! after that to layer LLM-driven NPC behavior on top.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::engine::apply::{apply_actions, ApplyOutcome};
use crate::providers::types::{ChatMessage, ChatRequest, Role};
use crate::providers::Provider;
use crate::world::action::TypedAction;
use crate::world::world::World;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpcTurnResult {
    pub orchestrator_picks: Vec<OrchestratorPick>,
    pub nation_turns: Vec<NationTurn>,
    pub world: World,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorPick {
    pub iso: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NationTurn {
    pub iso: String,
    pub nation_name: String,
    pub narrative: String,
    pub applied: Vec<TypedAction>,
    pub failures: Vec<String>,
    pub goal_update: Option<Vec<String>>,
    pub raw_response: String,
}

/// Run one NPC turn. Returns the new world + per-nation summaries.
pub async fn run_npc_turn(
    provider: Arc<dyn Provider>,
    model: String,
    mut world: World,
    days: i64,
    max_actors: usize,
) -> Result<NpcTurnResult, String> {
    // Step 1: orchestrator decides who acts.
    let picks = orchestrate(&*provider, &model, &world, days, max_actors).await?;

    // Step 2: each picked nation takes its turn.
    let mut nation_turns: Vec<NationTurn> = Vec::new();
    for pick in &picks {
        match run_nation_turn(&*provider, &model, &world, days, &pick.iso).await {
            Ok(turn) => {
                // Apply the nation's actions.
                let actions = turn.applied.clone();
                let narrative = Some(turn.narrative.clone());
                let ApplyOutcome {
                    world: new_world,
                    applied,
                    failures,
                } = apply_actions(world.clone(), actions, narrative, None);
                world = new_world;

                // Persist goal updates if provided.
                if let Some(new_goals) = &turn.goal_update {
                    if let Some(n) = world
                        .nations
                        .iter_mut()
                        .find(|n| n.iso_a3 == pick.iso)
                    {
                        n.goals = new_goals.clone();
                    }
                }

                nation_turns.push(NationTurn {
                    iso: pick.iso.clone(),
                    nation_name: turn.nation_name,
                    narrative: turn.narrative,
                    applied,
                    failures: failures.into_iter().map(|f| f.reason).collect(),
                    goal_update: turn.goal_update,
                    raw_response: turn.raw_response,
                });
            }
            Err(e) => {
                nation_turns.push(NationTurn {
                    iso: pick.iso.clone(),
                    nation_name: pick.iso.clone(),
                    narrative: format!("(turn failed: {})", e),
                    applied: Vec::new(),
                    failures: vec![e],
                    goal_update: None,
                    raw_response: String::new(),
                });
            }
        }
    }

    Ok(NpcTurnResult {
        orchestrator_picks: picks,
        nation_turns,
        world,
    })
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct OrchestratorEnvelope {
    #[serde(default)]
    nations: Option<Vec<OrchestratorPick>>,
}

async fn orchestrate(
    provider: &dyn Provider,
    model: &str,
    world: &World,
    days: i64,
    max_actors: usize,
) -> Result<Vec<OrchestratorPick>, String> {
    let nations_summary = build_nation_directory(world);
    let recent_events = build_recent_events(world);

    let system = format!(
        "You decide which world nations would plausibly take a significant action \
         in the next {} days. Pick at most {} nations. Consider: ongoing wars, \
         recent treaties, internal instability, regional rivalries, looming \
         deadlines. Do NOT include the inactive long tail of small peaceful \
         states. Do NOT favor any particular country.\n\n\
         Output JSON only:\n\
         {{\"nations\": [{{\"iso\": \"<ISO3>\", \"reason\": \"<one sentence>\"}}, ...]}}\n\
         Use ISO3 codes from the directory below verbatim.",
        days, max_actors
    );
    let user = format!(
        "WORLD DATE: {}\n\nNATIONS:\n{}\n\nRECENT EVENTS:\n{}\n\nPick the actors.",
        world.clock.current_date, nations_summary, recent_events
    );

    let req = ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: Role::System,
                content: system,
            },
            ChatMessage {
                role: Role::User,
                content: user,
            },
        ],
        max_tokens: Some(512),
        temperature: Some(0.5),
        stream: false,
        keep_alive: None,
        response_format: Some("json".to_string()),
    };
    let resp = provider
        .chat(req)
        .await
        .map_err(|e| format!("orchestrator chat failed: {}", e))?;
    let env = parse_envelope::<OrchestratorEnvelope>(&resp.content)
        .ok_or_else(|| "orchestrator: could not parse JSON".to_string())?;
    let picks = env.nations.unwrap_or_default();

    // Filter to valid ISOs only.
    let valid: std::collections::HashSet<String> =
        world.nations.iter().map(|n| n.iso_a3.clone()).collect();
    Ok(picks
        .into_iter()
        .filter(|p| valid.contains(&p.iso))
        .take(max_actors)
        .collect())
}

// ─── Per-nation actor ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ActorEnvelope {
    #[serde(default)]
    narrative: Option<String>,
    #[serde(default)]
    actions: Option<Vec<TypedAction>>,
    #[serde(default)]
    goal_update: Option<Vec<String>>,
}

struct ActorOutput {
    nation_name: String,
    narrative: String,
    applied: Vec<TypedAction>,
    goal_update: Option<Vec<String>>,
    raw_response: String,
}

async fn run_nation_turn(
    provider: &dyn Provider,
    model: &str,
    world: &World,
    days: i64,
    iso: &str,
) -> Result<ActorOutput, String> {
    let nation = world
        .nations
        .iter()
        .find(|n| n.iso_a3 == iso)
        .ok_or_else(|| format!("nation {} not in world", iso))?;

    let relations = build_relations_block(world, nation);
    let directory = build_nation_directory(world);
    let recent_events = build_recent_events(world);

    let goals = if nation.goals.is_empty() {
        "(no specific goals — preserve sovereignty and stability)".to_string()
    } else {
        nation.goals
            .iter()
            .enumerate()
            .map(|(i, g)| format!("  {}. {}", i + 1, g))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let action_schema = r#"{
  "narrative": "1-2 paragraph in-world description of what this nation does and why",
  "actions": [
    // 0 to 2 typed actions. Each must be one of the action types the engine supports.
    // Use ONLY NationId / ProvinceId / NpcId values from the world summary.
  ],
  "goal_update": ["new goal 1", ...]  // OPTIONAL; only include if this turn's events
                                       // meaningfully changed the nation's strategic outlook
}"#;

    let system = format!(
        "You ARE the nation '{}' (iso={}, id={}). Act in this nation's own self-interest.\n\
         Do NOT cater to any player. Pursue your goals. React to threats. Form / break alliances\n\
         when it serves you.\n\n\
         Government: {:?}. Doctrine: {:?}. Stability: {}. War support: {}.\n\
         Population: {}M. Treasury: ${}M. Industry: {}.\n\n\
         YOUR GOALS:\n{}\n\n\
         RULES:\n\
         - Respond with ONE JSON object only matching the schema below.\n\
         - Take 0–2 actions. Quiet diplomatic periods are normal — empty actions list is fine.\n\
         - Use the action shapes from the engine schema. Use ONLY nation IDs from the directory below.\n\
         - Be specific: justify each action in the narrative.\n\n\
         SCHEMA:\n{}\n\n\
         ENGINE ACTION TYPES (use exact shapes):\n\
         {{\"action\": \"declare_war\", \"aggressor\": \"<NationId>\", \"target\": \"<NationId>\", \"justification\": \"...\"}}\n\
         {{\"action\": \"sign_treaty\", \"parties\": [...], \"kind\": \"non_aggression|defensive_pact|alliance|trade_agreement|ceasefire|peace_treaty|vassalage\", \"terms\": {{\"territory_transfers\": [], \"tribute_per_year\": 0, \"extra_clauses\": []}}}}\n\
         {{\"action\": \"modify_relation\", \"from\": \"<NationId>\", \"to\": \"<NationId>\", \"delta\": -100..100, \"reason\": \"...\"}}\n\
         {{\"action\": \"change_government\", \"nation\": \"<NationId>\", \"new_form\": \"democracy|monarchy|republic|communist|fascist|military_junta|theocracy|other\", \"mechanism\": \"election|coup|revolution|abdication|foreign_imposition\"}}\n\
         {{\"action\": \"modify_stability\", \"nation\": \"<NationId>\", \"delta\": -100..100}}\n\
         {{\"action\": \"modify_resource\", \"nation\": \"<NationId>\", \"resource\": \"steel|oil|rubber|tungsten\", \"delta\": -10000..10000}}",
        nation.name,
        nation.iso_a3,
        nation.id,
        nation.government,
        nation.doctrine,
        nation.stability,
        nation.war_support,
        nation.population / 1_000_000,
        nation.gdp / 1_000_000,
        nation.industry_capacity,
        goals,
        action_schema
    );

    let user = format!(
        "Date: {}. {} days have elapsed since last turn.\n\n\
         RELATIONS:\n{}\n\n\
         NATION DIRECTORY (iso=id|name):\n{}\n\n\
         RECENT EVENTS:\n{}\n\n\
         What do you do?",
        world.clock.current_date, days, relations, directory, recent_events
    );

    let req = ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: Role::System,
                content: system,
            },
            ChatMessage {
                role: Role::User,
                content: user,
            },
        ],
        max_tokens: Some(1024),
        temperature: Some(0.6),
        stream: false,
        keep_alive: None,
        response_format: Some("json".to_string()),
    };

    let resp = provider
        .chat(req)
        .await
        .map_err(|e| format!("actor chat failed: {}", e))?;
    let raw = resp.content;
    let env: ActorEnvelope = parse_envelope(&raw).unwrap_or(ActorEnvelope {
        narrative: Some(format!("(unparseable response): {}", raw.chars().take(500).collect::<String>())),
        actions: None,
        goal_update: None,
    });

    Ok(ActorOutput {
        nation_name: nation.name.clone(),
        narrative: env.narrative.unwrap_or_default(),
        applied: env.actions.unwrap_or_default(),
        goal_update: env.goal_update,
        raw_response: raw,
    })
}

// ─── Context builders ───────────────────────────────────────────────────────

fn build_nation_directory(world: &World) -> String {
    let mut by_name: Vec<&crate::world::nation::Nation> = world.nations.iter().collect();
    by_name.sort_by(|a, b| a.name.cmp(&b.name));
    let rows: Vec<String> = by_name
        .iter()
        .map(|n| format!("{}={}|{}", n.iso_a3, n.id, n.name))
        .collect();
    let mut out = String::new();
    for chunk in rows.chunks(6) {
        out.push_str(&chunk.join("  "));
        out.push('\n');
    }
    out
}

fn build_relations_block(world: &World, nation: &crate::world::nation::Nation) -> String {
    if nation.relations.is_empty() {
        return "(neutral toward all)".to_string();
    }
    let mut entries: Vec<(String, i32)> = Vec::new();
    for (other_id, rel) in &nation.relations {
        if let Some(other) = world.nations.iter().find(|n| n.id == *other_id) {
            entries.push((other.name.clone(), *rel));
        }
    }
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    entries
        .iter()
        .take(15)
        .map(|(name, rel)| format!("  {}: {:+}", name, rel))
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_recent_events(world: &World) -> String {
    let recent: Vec<String> = world
        .events
        .iter()
        .rev()
        .take(10)
        .map(|e| {
            format!(
                "  [round {}] {} — {}",
                e.round,
                e.headline,
                e.narrative.chars().take(140).collect::<String>(),
            )
        })
        .collect();
    if recent.is_empty() {
        "(no recent events)".to_string()
    } else {
        recent.join("\n")
    }
}

fn parse_envelope<T: serde::de::DeserializeOwned>(raw: &str) -> Option<T> {
    let cleaned = strip_code_fences(raw);
    let block = find_json_block(&cleaned)?;
    if let Ok(v) = serde_json::from_str::<T>(block) {
        return Some(v);
    }
    let repaired = repair_json(block);
    serde_json::from_str::<T>(&repaired).ok()
}

fn strip_code_fences(s: &str) -> String {
    let mut s = String::from(s);
    while let (Some(open), Some(close)) = (s.find("<think>"), s.find("</think>")) {
        if close > open {
            let before = &s[..open];
            let after = &s[close + "</think>".len()..];
            s = format!("{}{}", before, after);
        } else {
            break;
        }
    }
    if let (Some(start), Some(end)) = (s.find("```"), s.rfind("```")) {
        if end > start {
            let after_fence = &s[start + 3..end];
            let inner = if let Some(nl) = after_fence.find('\n') {
                &after_fence[nl + 1..]
            } else {
                after_fence
            };
            return inner.to_string();
        }
    }
    s
}

/// Strip trailing commas + balance bracket counts at EOF — covers the two
/// most common LLM JSON syntax mistakes.
fn repair_json(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out: Vec<char> = Vec::with_capacity(chars.len());
    let mut in_str = false;
    let mut esc = false;
    for &c in &chars {
        if in_str {
            out.push(c);
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        if c == '"' {
            in_str = true;
            out.push(c);
            continue;
        }
        if c == ']' || c == '}' {
            while let Some(&last) = out.last() {
                if last.is_whitespace() {
                    out.pop();
                } else if last == ',' {
                    out.pop();
                    break;
                } else {
                    break;
                }
            }
        }
        out.push(c);
    }
    let mut s2: String = out.into_iter().collect();
    let mut depth_obj = 0i32;
    let mut depth_arr = 0i32;
    let mut in_str = false;
    let mut esc = false;
    for c in s2.chars() {
        if in_str {
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '{' => depth_obj += 1,
            '}' => depth_obj -= 1,
            '[' => depth_arr += 1,
            ']' => depth_arr -= 1,
            _ => {}
        }
    }
    while depth_arr > 0 {
        s2.push(']');
        depth_arr -= 1;
    }
    while depth_obj > 0 {
        s2.push('}');
        depth_obj -= 1;
    }
    s2
}

fn find_json_block(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    let mut start = None;
    let mut depth = 0i32;
    let mut in_str = false;
    let mut esc = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_str {
            if esc {
                esc = false;
            } else if b == b'\\' {
                esc = true;
            } else if b == b'"' {
                in_str = false;
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'{' => {
                if depth == 0 {
                    start = Some(i);
                }
                depth += 1;
            }
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    let st = start?;
                    return Some(&s[st..=i]);
                }
            }
            _ => {}
        }
    }
    // Truncated JSON — return from `start` so repair can balance brackets.
    start.map(|st| &s[st..])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::{BranchId, SaveId};
    use crate::world::scenario::build_modern_world;
    use chrono::NaiveDate;

    #[test]
    fn scenario_seeds_goals_for_major_nations() {
        let w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let usa = w.nations.iter().find(|n| n.iso_a3 == "USA").unwrap();
        assert!(usa.goals.len() >= 2);
        let count_with_goals = w.nations.iter().filter(|n| !n.goals.is_empty()).count();
        assert!(count_with_goals >= w.nations.len() - 5,
            "expected nearly every nation to have goals, got {}/{}",
            count_with_goals, w.nations.len());
    }

    #[test]
    fn parse_envelope_handles_fenced_json() {
        #[derive(Deserialize)]
        struct T {
            ok: bool,
        }
        let raw = "```json\n{\"ok\": true}\n```";
        let t: T = parse_envelope(raw).unwrap();
        assert!(t.ok);
    }

    #[test]
    fn parse_envelope_handles_prose_wrapped() {
        #[derive(Deserialize)]
        struct T {
            ok: bool,
        }
        let raw = "Here's the answer: {\"ok\": true}\nlet me know if you need more.";
        let t: T = parse_envelope(raw).unwrap();
        assert!(t.ok);
    }

    #[test]
    fn parse_envelope_handles_think_prefix() {
        #[derive(Deserialize)]
        struct T {
            ok: bool,
        }
        let raw = "<think>need to figure out the best move</think>{\"ok\": true}";
        let t: T = parse_envelope(raw).unwrap();
        assert!(t.ok);
    }

    #[test]
    fn parse_envelope_repairs_trailing_comma() {
        #[derive(Deserialize)]
        struct T {
            #[serde(default)]
            ok: Option<bool>,
        }
        let raw = "{\"ok\": true,}";
        let t: T = parse_envelope(raw).unwrap();
        assert_eq!(t.ok, Some(true));
    }

    #[test]
    fn parse_envelope_repairs_truncated() {
        // Realistic LLM ran-out-of-tokens output.
        #[derive(Deserialize)]
        struct T {
            #[serde(default)]
            ok: Option<bool>,
        }
        let raw = "{\"ok\": true";
        let t: T = parse_envelope(raw).unwrap();
        assert_eq!(t.ok, Some(true));
    }

    #[tokio::test]
    async fn orchestrator_round_trip_with_mock() {
        use crate::engine::mock_provider::MockProvider;
        let mock = MockProvider::new(vec![
            r#"{"nations": [{"iso": "USA", "reason": "active in NATO"}, {"iso": "CHN", "reason": "Taiwan tension"}]}"#,
        ]);
        let w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let picks = orchestrate(mock.as_ref(), "mock", &w, 7, 4)
            .await
            .expect("orchestrator should succeed");
        assert_eq!(picks.len(), 2);
        assert_eq!(picks[0].iso, "USA");
        assert_eq!(picks[1].iso, "CHN");
    }

    #[tokio::test]
    async fn orchestrator_handles_fenced_response() {
        use crate::engine::mock_provider::MockProvider;
        let mock = MockProvider::new(vec![
            "```json\n{\"nations\": [{\"iso\": \"RUS\", \"reason\": \"Ukraine\"}]}\n```",
        ]);
        let w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let picks = orchestrate(mock.as_ref(), "mock", &w, 7, 4).await.unwrap();
        assert_eq!(picks.len(), 1);
        assert_eq!(picks[0].iso, "RUS");
    }

    #[tokio::test]
    async fn nation_turn_applies_modify_relation() {
        use crate::engine::mock_provider::MockProvider;
        let w0 = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let usa = w0.nations.iter().find(|n| n.iso_a3 == "USA").unwrap();
        let chn = w0.nations.iter().find(|n| n.iso_a3 == "CHN").unwrap();
        // Orchestrator → 1 nation (USA). USA actor → modify_relation toward CHN -20.
        let mock = MockProvider::new(vec![
            r#"{"nations": [{"iso": "USA", "reason": "Indo-Pacific tension"}]}"#,
            &format!(
                "{{\"narrative\": \"Pacific patrol expanded.\", \"actions\": [{{\"action\": \"modify_relation\", \"from\": \"{}\", \"to\": \"{}\", \"delta\": -20, \"reason\": \"freedom-of-navigation\"}}]}}",
                usa.id, chn.id
            ),
        ]);
        let result = run_npc_turn(mock.clone(), "mock".into(), w0.clone(), 7, 4)
            .await
            .unwrap();
        assert_eq!(result.nation_turns.len(), 1);
        assert_eq!(result.nation_turns[0].applied.len(), 1);
        let usa_after = result
            .world
            .nations
            .iter()
            .find(|n| n.iso_a3 == "USA")
            .unwrap();
        assert_eq!(usa_after.relations.get(&chn.id).copied(), Some(-20));
    }

    #[tokio::test]
    async fn nation_turn_persists_goal_update() {
        use crate::engine::mock_provider::MockProvider;
        let w0 = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let mock = MockProvider::new(vec![
            r#"{"nations": [{"iso": "DEU", "reason": "EU policy lead"}]}"#,
            r#"{"narrative": "Bundeswehr reform announced.", "actions": [], "goal_update": ["rebuild Bundeswehr to 200k strength", "lead EU defense industrial policy"]}"#,
        ]);
        let result = run_npc_turn(mock, "mock".into(), w0, 14, 4).await.unwrap();
        let deu = result
            .world
            .nations
            .iter()
            .find(|n| n.iso_a3 == "DEU")
            .unwrap();
        assert_eq!(deu.goals.len(), 2);
        assert!(deu.goals[0].contains("Bundeswehr"));
    }

    #[tokio::test]
    async fn nation_turn_survives_garbage_actor_output() {
        use crate::engine::mock_provider::MockProvider;
        let w0 = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let mock = MockProvider::new(vec![
            r#"{"nations": [{"iso": "USA", "reason": "anything"}]}"#,
            "completely unparseable garbage with no JSON",
        ]);
        let result = run_npc_turn(mock, "mock".into(), w0, 7, 4).await.unwrap();
        // Should not crash; should produce a NationTurn entry with the
        // unparseable narrative captured.
        assert_eq!(result.nation_turns.len(), 1);
        assert!(result.nation_turns[0].narrative.contains("unparseable"));
    }
}
