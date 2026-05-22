//! Game-loop Tauri commands: turn ticker + LLM-backed action validator.

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::engine::{
    advance_clock, apply_actions, apply_production, resolve_movement, run_economy_tick,
    run_npc_turn, ApplyOutcome, MovementOutcome, NpcTurnResult, ProductionOutcome,
    ProductionRequest,
};
use crate::world::ids::{ProvinceId, UnitId};
use crate::error::{AppError, Result};
use crate::providers::types::{ChatMessage, ChatRequest, Role};
use crate::saves::snapshot::save_snapshot;
use crate::world::action::TypedAction;
use crate::world::world::World;
use crate::AppState;

// ─── Turn ticker ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn end_turn_cmd(world: World, days: i64) -> Result<World> {
    let mut advanced = advance_clock(world, days);
    run_economy_tick(&mut advanced, days.max(1));
    save_snapshot(advanced.clone()).await?;
    Ok(advanced)
}

// ─── Combat MVP ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ProductionResult {
    pub accepted: bool,
    pub narrative: String,
    pub plan: Vec<ProductionRequest>,
    pub outcome: ProductionOutcome,
    pub world: World,
    pub raw_response: String,
}

#[derive(Debug, Deserialize)]
struct ProductionEnvelope {
    #[serde(default)]
    accepted: Option<bool>,
    #[serde(default)]
    narrative: Option<String>,
    #[serde(default)]
    units: Option<Vec<ProductionRequest>>,
}

/// LLM-mediated unit production. Player describes desired build; LLM looks
/// at nation industry / treasury / manpower and emits a plan the engine
/// applies. Capacity caps are enforced server-side regardless of what the
/// LLM says (defensive — LLM can't overspend the budget).
#[tauri::command]
pub async fn request_production_cmd(
    state: State<'_, AppState>,
    provider_id: Uuid,
    model: String,
    world: World,
    player_text: String,
) -> Result<ProductionResult> {
    let provider = state
        .registry
        .get(provider_id)
        .await
        .ok_or_else(|| AppError::NotFound("provider".into()))?;

    let nation_id = world
        .player_nation
        .ok_or_else(|| AppError::InvalidArgument("no player nation".into()))?;
    let nation = world
        .nations
        .iter()
        .find(|n| n.id == nation_id)
        .ok_or_else(|| AppError::NotFound("player nation".into()))?
        .clone();

    let system = format!(
        "You are the strategic planning bureau of {} (iso={}). The player just \
         told you what they want built. Decide what is REALISTICALLY producible \
         this turn given the constraints below.\n\n\
         CAPACITY:\n\
         - Industry capacity: {} points/turn\n\
         - Treasury: ${} M\n\
         - Manpower pool: {}\n\n\
         COSTS PER UNIT (industry, treasury USD, manpower):\n\
         - infantry: 1 IC, $80M, 8,000\n\
         - mechanized: 2 IC, $220M, 6,500\n\
         - armor: 4 IC, $600M, 5,000\n\
         - artillery: 2 IC, $180M, 4,500\n\n\
         Respond with ONE JSON object only matching this schema. Engine will \
         enforce caps anyway, but try to be honest.\n\
         {{\n\
           \"accepted\": true | false,\n\
           \"narrative\": \"1-2 paragraph in-character description of the build\",\n\
           \"units\": [\n\
             {{\"unit_type\": \"infantry|mechanized|armor|artillery\", \"count\": <int>, \"location_province\": null}}\n\
           ]\n\
         }}",
        nation.name,
        nation.iso_a3,
        nation.industry_capacity,
        nation.treasury / 1_000_000,
        nation.manpower_pool
    );

    let req = ChatRequest {
        model,
        messages: vec![
            ChatMessage {
                role: Role::System,
                content: system,
            },
            ChatMessage {
                role: Role::User,
                content: player_text,
            },
        ],
        max_tokens: Some(1024),
        temperature: Some(0.4),
        stream: false,
        keep_alive: None,
        response_format: Some("json".to_string()),
    };
    let resp = provider.chat(req).await?;
    let raw = resp.content;

    let env = parse_production_envelope(&raw).unwrap_or(ProductionEnvelope {
        accepted: Some(false),
        narrative: Some(format!(
            "(unparseable LLM response): {}",
            raw.chars().take(500).collect::<String>()
        )),
        units: None,
    });

    let accepted = env.accepted.unwrap_or(false);
    let narrative = env.narrative.unwrap_or_default();
    let plan = env.units.unwrap_or_default();

    if !accepted || plan.is_empty() {
        return Ok(ProductionResult {
            accepted: false,
            narrative,
            plan,
            outcome: ProductionOutcome {
                spawned: Vec::new(),
                denied: Vec::new(),
                industry_used: 0,
                treasury_spent: 0,
                manpower_spent: 0,
            },
            world,
            raw_response: raw,
        });
    }

    let mut mutable_world = world;
    let outcome = apply_production(&mut mutable_world, nation_id, plan.clone());
    let _ = save_snapshot(mutable_world.clone()).await;

    Ok(ProductionResult {
        accepted: true,
        narrative,
        plan,
        outcome,
        world: mutable_world,
        raw_response: raw,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MoveUnitRequest {
    pub unit: UnitId,
    pub target: ProvinceId,
}

#[derive(Debug, Serialize)]
pub struct MoveUnitResult {
    pub outcome: MovementOutcome,
    pub world: World,
}

/// Engine-only move command (no LLM in the loop). Takes a unit + target
/// province + adjacency map (sent from the frontend so the engine can stay
/// stateless wrt asset files). Combat resolves automatically when the
/// destination contains hostile units.
#[tauri::command]
pub async fn move_unit_cmd(
    world: World,
    request: MoveUnitRequest,
    adjacency: std::collections::HashMap<String, Vec<String>>,
) -> Result<MoveUnitResult> {
    let mut mutable = world;
    let lookup =
        |s: &str| -> Vec<String> { adjacency.get(s).cloned().unwrap_or_default() };
    let outcome = resolve_movement(&mut mutable, request.unit, request.target, &lookup);
    let _ = save_snapshot(mutable.clone()).await;
    Ok(MoveUnitResult {
        outcome,
        world: mutable,
    })
}

/// Run the NPC turn — the LLM picks 3–6 relevant nations to act, then each
/// generates its own narrative + typed actions. Results are applied via the
/// engine and a fresh snapshot is persisted.
#[tauri::command]
pub async fn run_npc_turn_cmd(
    state: State<'_, AppState>,
    provider_id: Uuid,
    model: String,
    world: World,
    days: i64,
    max_actors: Option<usize>,
) -> Result<NpcTurnResult> {
    let provider = state
        .registry
        .get(provider_id)
        .await
        .ok_or_else(|| AppError::NotFound("provider".into()))?;
    let max = max_actors.unwrap_or(4);
    let result = run_npc_turn(provider, model, world, days, max)
        .await
        .map_err(|e| AppError::InvalidArgument(e))?;
    let _ = save_snapshot(result.world.clone()).await;
    Ok(result)
}

// ─── Action validator (LLM) ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatorResult {
    pub accepted: bool,
    pub narrative: String,
    pub applied: Vec<TypedAction>,
    pub failures: Vec<EngineFailure>,
    pub world: World,
    pub next_tick_days: Option<u32>,
    pub raw_response: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineFailure {
    pub reason: String,
}

#[derive(Debug, Deserialize)]
struct LlmEnvelope {
    #[serde(default)]
    accepted: Option<bool>,
    #[serde(default)]
    narrative: Option<String>,
    #[serde(default)]
    actions: Option<Vec<TypedAction>>,
    #[serde(default)]
    next_tick_days: Option<u32>,
}

#[tauri::command]
pub async fn validate_action_cmd(
    state: State<'_, AppState>,
    provider_id: Uuid,
    model: String,
    world: World,
    player_text: String,
    adjacency: Option<std::collections::HashMap<String, Vec<String>>>,
) -> Result<ValidatorResult> {
    let provider = state
        .registry
        .get(provider_id)
        .await
        .ok_or_else(|| AppError::NotFound("provider".into()))?;

    let system = build_system_prompt(&world);
    let user = build_user_prompt(&world, &player_text);

    let req = ChatRequest {
        model,
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
        temperature: Some(0.4),
        stream: false,
        keep_alive: None,
        response_format: Some("json".to_string()),
    };
    let response = provider.chat(req).await?;
    let raw = response.content;

    // Parse — be lenient. LLMs often wrap JSON in prose or fence it.
    let envelope: LlmEnvelope = parse_envelope(&raw).unwrap_or(LlmEnvelope {
        accepted: Some(false),
        narrative: Some(format!(
            "(could not parse LLM response as JSON)\n\n{}",
            raw.chars().take(2000).collect::<String>()
        )),
        actions: None,
        next_tick_days: None,
    });

    let accepted = envelope.accepted.unwrap_or(false);
    let narrative = envelope.narrative.unwrap_or_default();
    let next_tick_days = envelope.next_tick_days;

    if !accepted {
        return Ok(ValidatorResult {
            accepted: false,
            narrative,
            applied: Vec::new(),
            failures: Vec::new(),
            world,
            next_tick_days,
            raw_response: raw,
        });
    }

    let actions = envelope.actions.unwrap_or_default();
    let ApplyOutcome {
        world: new_world,
        applied,
        failures,
    } = apply_actions(world, actions, Some(narrative.clone()), adjacency.as_ref());

    // Persist a snapshot at the current round so it can be reloaded later.
    let _ = save_snapshot(new_world.clone()).await;

    Ok(ValidatorResult {
        accepted: true,
        narrative,
        applied,
        failures: failures
            .into_iter()
            .map(|f| EngineFailure { reason: f.reason })
            .collect(),
        world: new_world,
        next_tick_days,
        raw_response: raw,
    })
}

fn build_system_prompt(world: &World) -> String {
    let action_schema = r#"{
  "accepted": true | false,
  "narrative": "1-3 paragraph in-world description of what happens",
  "actions": [
    // Choose zero or more typed actions. Each MUST be one of:
    {"action": "declare_war", "aggressor": "<NationId>", "target": "<NationId>", "justification": "..."},
    {"action": "sign_treaty", "parties": ["<NationId>", "<NationId>"], "kind": "non_aggression|defensive_pact|alliance|trade_agreement|ceasefire|peace_treaty|vassalage", "terms": {"territory_transfers": [], "tribute_per_year": 0, "extra_clauses": []}},
    {"action": "transfer_territory", "from": "<NationId>", "to": "<NationId>", "provinces": ["<ProvinceId>"], "mechanism": "conquest|treaty|secession|decolonization|other"},
    {"action": "modify_relation", "from": "<NationId>", "to": "<NationId>", "delta": -100..100, "reason": "..."},
    {"action": "change_government", "nation": "<NationId>", "new_form": "democracy|monarchy|republic|communist|fascist|military_junta|theocracy|other", "mechanism": "election|coup|revolution|abdication|foreign_imposition"},
    {"action": "modify_stability", "nation": "<NationId>", "delta": -100..100},
    {"action": "modify_resource", "nation": "<NationId>", "resource": "steel|oil|rubber|tungsten", "delta": -10000..10000},
    {"action": "assassinate_npc", "target": "<NpcId>"}
  ],
  "next_tick_days": <integer, 1..365 — how many days the engine should advance after applying these>
}"#;

    let player_clause = match world.player_nation
        .and_then(|id| world.nations.iter().find(|n| n.id == id))
    {
        Some(p) => format!(
            "THE PLAYER CONTROLS: {} (iso={}, id={}).\n\
            Treat first-person language ('I', 'we', 'us') and bare verbs ('invade', 'demand', \n\
            'sign a pact with', 'build up') as the player's nation acting. Only that nation \n\
            initiates actions; other nations respond plausibly inside the narrative but do \n\
            NOT spawn typed actions of their own (they'll get their own turns later).\n\n",
            p.name, p.iso_a3, p.id
        ),
        None => "THE PLAYER HAS NO ASSIGNED NATION YET — interpret the text as a neutral \
            observer steering the world.\n\n"
            .to_string(),
    };

    format!(
        "You are the rules adjudicator for an alternate-history grand-strategy game.\n\
        Date in-game: {}.\n\n\
        {}\
        The player describes what they want to do. You decide whether it is plausible,\n\
        narrate the outcome in 1-3 paragraphs, and emit a strict JSON envelope describing\n\
        the world-state changes.\n\n\
        STRICT REQUIREMENTS:\n\
        - Respond with ONE JSON object only. No prose before or after.\n\
        - Use the exact schema below. Unknown fields cause parse failures.\n\
        - If the player's request is impossible, unwise, or violates the constraint of\n\
          'a single nation acting realistically over a short period', set accepted=false\n\
          with a brief explanatory narrative and no actions.\n\
        - Use ONLY NationId / ProvinceId / NpcId values from the world summary below.\n\
        - Never invent IDs.\n\n\
        SCHEMA:\n{}\n",
        world.clock.current_date, player_clause, action_schema
    )
}

fn build_user_prompt(world: &World, player_text: &str) -> String {
    let player_nation = world
        .player_nation
        .and_then(|id| world.nations.iter().find(|n| n.id == id));

    // Top 30 by industry — get full economic detail.
    let mut by_industry: Vec<&crate::world::nation::Nation> = world.nations.iter().collect();
    by_industry.sort_by_key(|n| -(n.industry_capacity as i64));
    let top: Vec<String> = by_industry
        .iter()
        .take(30)
        .map(|n| {
            format!(
                "{} (iso={}): gov={:?}, pop={}M, industry={}, stability={}, id={}",
                n.name,
                n.iso_a3,
                n.government,
                n.population / 1_000_000,
                n.industry_capacity,
                n.stability,
                n.id
            )
        })
        .collect();

    // FULL nation directory — every nation as a compact iso → id row so the LLM
    // can reference any country, not just the top 30. This fixes the "Canada
    // isn't in the world summary" rejection class.
    let mut by_name: Vec<&crate::world::nation::Nation> = world.nations.iter().collect();
    by_name.sort_by(|a, b| a.name.cmp(&b.name));
    let directory: Vec<String> = by_name
        .iter()
        .map(|n| format!("{}={}|{}", n.iso_a3, n.id, n.name))
        .collect();

    // Treaty list — also useful context. Compact form.
    let treaty_lines: Vec<String> = world
        .treaties
        .iter()
        .take(40)
        .map(|t| {
            let members: Vec<String> = t
                .parties
                .iter()
                .filter_map(|pid| world.nations.iter().find(|n| n.id == *pid))
                .map(|n| n.iso_a3.clone())
                .collect();
            let label = t
                .terms
                .extra_clauses
                .first()
                .cloned()
                .unwrap_or_else(|| format!("{:?}", t.kind));
            format!("{} [{}]", label, members.join(", "))
        })
        .collect();

    let mut out = String::new();
    out.push_str("WORLD SUMMARY:\n");
    if let Some(p) = player_nation {
        out.push_str(&format!(
            "Player nation: {} (iso={}) id={}\n",
            p.name, p.iso_a3, p.id
        ));
        // Player-specific extras
        out.push_str(&format!(
            "  treasury={}, gdp={}, manpower={}, doctrine={:?}\n",
            p.treasury, p.gdp, p.manpower_pool, p.doctrine
        ));
    } else {
        out.push_str("Player nation: (unassigned)\n");
    }
    out.push_str(&format!(
        "Round: {}, Date: {}\n\n",
        world.clock.round, world.clock.current_date
    ));

    out.push_str("Top nations by industry (detail):\n");
    for line in &top {
        out.push_str(" - ");
        out.push_str(line);
        out.push('\n');
    }

    out.push_str("\nALL NATIONS (iso=id|name) — use these IDs verbatim:\n");
    // Chunk to avoid one massive line in the prompt rendering.
    for chunk in directory.chunks(6) {
        out.push_str("  ");
        out.push_str(&chunk.join("  "));
        out.push('\n');
    }

    if !treaty_lines.is_empty() {
        out.push_str("\nACTIVE TREATIES / BLOCS:\n");
        for t in &treaty_lines {
            out.push_str(" - ");
            out.push_str(t);
            out.push('\n');
        }
    }

    out.push_str("\nPLAYER REQUEST:\n");
    out.push_str(player_text);
    out.push_str("\n\nRespond with one JSON object matching the schema.");
    out
}

/// Extract the largest balanced `{ ... }` block from `raw` and parse it as
/// the LLM envelope. Tolerant of code fences and surrounding prose.
fn parse_envelope(raw: &str) -> Option<LlmEnvelope> {
    parse_with_repair::<LlmEnvelope>(raw)
}

fn parse_production_envelope(raw: &str) -> Option<ProductionEnvelope> {
    parse_with_repair::<ProductionEnvelope>(raw)
}

/// Try parsing as-is; if it fails, run cheap repair (strip fences, trailing
/// commas, balance brackets) and try again.
fn parse_with_repair<T: serde::de::DeserializeOwned>(raw: &str) -> Option<T> {
    let cleaned = strip_code_fences(raw);
    let block = find_json_block(&cleaned)?;
    if let Ok(v) = serde_json::from_str::<T>(block) {
        return Some(v);
    }
    let repaired = repair_json(block);
    serde_json::from_str::<T>(&repaired).ok()
}

fn strip_code_fences(s: &str) -> String {
    // 1) Strip <think>...</think> blocks some reasoning models prepend.
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
    // 2) Strip ``` code fences (with or without language tag).
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

/// Best-effort JSON repair for common LLM mistakes:
///   - trailing commas before `]` or `}`
///   - missing closing brackets at EOF (model ran out of tokens)
fn repair_json(s: &str) -> String {
    // Strip trailing commas: `,]` → `]`, `,}` → `}`.
    let mut out: Vec<char> = Vec::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut in_string = false;
    let mut esc = false;
    for &c in &chars {
        if in_string {
            out.push(c);
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            continue;
        }
        if c == ']' || c == '}' {
            // Walk back and drop any whitespace + trailing comma.
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
    // Balance brackets at the tail.
    let mut s2: String = out.into_iter().collect();
    let mut depth_obj = 0i32;
    let mut depth_arr = 0i32;
    let mut in_str = false;
    let mut esc2 = false;
    for c in s2.chars() {
        if in_str {
            if esc2 {
                esc2 = false;
            } else if c == '\\' {
                esc2 = true;
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
    // Truncated JSON (LLM ran out of tokens) — return from `start` to end so
    // the repair pass can balance the brackets.
    start.map(|st| &s[st..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_envelope_handles_fenced_json() {
        let raw = "```json\n{\"accepted\": true, \"narrative\": \"ok\"}\n```";
        let env = parse_envelope(raw).expect("parses");
        assert_eq!(env.accepted, Some(true));
        assert_eq!(env.narrative.as_deref(), Some("ok"));
    }

    #[test]
    fn parse_envelope_handles_prose_around_json() {
        let raw = "Sure, here is your answer:\n{\"accepted\": false, \"narrative\": \"no\"}\nHope that helps!";
        let env = parse_envelope(raw).expect("parses");
        assert_eq!(env.accepted, Some(false));
    }

    #[test]
    fn parse_envelope_returns_none_on_garbage() {
        assert!(parse_envelope("definitely not json").is_none());
    }

    #[test]
    fn parse_envelope_handles_trailing_comma() {
        let raw = r#"{"accepted": true, "narrative": "ok", "actions": [],}"#;
        let env = parse_envelope(raw).expect("should repair trailing comma");
        assert_eq!(env.accepted, Some(true));
    }

    #[test]
    fn parse_envelope_handles_truncated_json() {
        // Missing closing braces — common when LLM hits max_tokens.
        let raw = r#"{"accepted": true, "narrative": "trunc"#;
        // Won't parse cleanly even after repair (string isn't closed), but
        // shouldn't panic.
        let _ = parse_envelope(raw);
    }

    #[test]
    fn parse_envelope_strips_think_tags() {
        let raw = "<think>let me think about this</think>{\"accepted\": false, \"narrative\": \"hmm\"}";
        let env = parse_envelope(raw).expect("should strip think tags");
        assert_eq!(env.accepted, Some(false));
    }

    #[test]
    fn parse_envelope_repairs_missing_closing_brackets() {
        // Object with one missing closing brace.
        let raw = r#"{"accepted": true, "narrative": "ok", "actions": []"#;
        let env = parse_envelope(raw).expect("should balance brackets");
        assert_eq!(env.accepted, Some(true));
    }
}
