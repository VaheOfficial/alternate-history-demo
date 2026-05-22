import { invoke } from "@tauri-apps/api/core";
import type { ModernSaveBootstrap, SaveSummary, World } from "./types";

export interface ValidatorResult {
  accepted: boolean;
  narrative: string;
  applied: unknown[];
  failures: { reason: string }[];
  world: World;
  next_tick_days: number | null;
  raw_response: string;
}

export function createModernDaySave(name: string) {
  return invoke<ModernSaveBootstrap>("create_modern_day_save_cmd", { name });
}

export function listSaves() {
  return invoke<SaveSummary[]>("list_saves_cmd");
}

export function deleteSave(id: string) {
  return invoke<void>("delete_save_cmd", { id });
}

export function saveSnapshot(world: World) {
  return invoke<void>("save_snapshot_cmd", { world });
}

export function loadSnapshot(save: string, branch: string, round: number) {
  return invoke<World>("load_snapshot_cmd", { save, branch, round });
}

export interface SnapshotMeta {
  save_id: string;
  branch_id: string;
  round: number;
  game_date: string;
}

export function listSnapshots(save: string, branch: string) {
  return invoke<SnapshotMeta[]>("list_snapshots_cmd", { save, branch });
}

export function endTurn(world: World, days: number) {
  return invoke<World>("end_turn_cmd", { world, days });
}

export function validateAction(
  providerId: string,
  model: string,
  world: World,
  playerText: string,
  adjacency?: Record<string, string[]>,
) {
  return invoke<ValidatorResult>("validate_action_cmd", {
    providerId,
    model,
    world,
    playerText,
    adjacency: adjacency ?? null,
  });
}

export interface OrchestratorPick {
  iso: string;
  reason: string;
}

export interface NationTurn {
  iso: string;
  nation_name: string;
  narrative: string;
  applied: unknown[];
  failures: string[];
  goal_update: string[] | null;
  raw_response: string;
}

export interface NpcTurnResult {
  orchestrator_picks: OrchestratorPick[];
  nation_turns: NationTurn[];
  world: World;
}

export function runNpcTurn(
  providerId: string,
  model: string,
  world: World,
  days: number,
  maxActors?: number,
) {
  return invoke<NpcTurnResult>("run_npc_turn_cmd", {
    providerId,
    model,
    world,
    days,
    maxActors: maxActors ?? null,
  });
}

export interface ProductionRequestInput {
  unit_type: "infantry" | "armor" | "mechanized" | "artillery";
  count: number;
  location_province?: string | null;
}

export interface ProductionDenied {
  unit_type: string;
  requested: number;
  granted: number;
  reason: string;
}

export interface ProductionOutcome {
  spawned: string[];
  denied: ProductionDenied[];
  industry_used: number;
  treasury_spent: number;
  manpower_spent: number;
}

export interface ProductionResult {
  accepted: boolean;
  narrative: string;
  plan: ProductionRequestInput[];
  outcome: ProductionOutcome;
  world: World;
  raw_response: string;
}

export function requestProduction(
  providerId: string,
  model: string,
  world: World,
  playerText: string,
) {
  return invoke<ProductionResult>("request_production_cmd", {
    providerId,
    model,
    world,
    playerText,
  });
}

export type MovementOutcome =
  | { outcome: "moved" }
  | { outcome: "battle_won_conquered"; defender_losses_pct: number; attacker_losses_pct: number; new_owner: string; previous_owner: string }
  | { outcome: "battle_won"; defender_losses_pct: number; attacker_losses_pct: number }
  | { outcome: "stalemate"; both_losses_pct: number }
  | { outcome: "battle_lost"; attacker_losses_pct: number; defender_losses_pct: number }
  | { outcome: "invalid"; reason: string };

export interface MoveUnitResult {
  outcome: MovementOutcome;
  world: World;
}

export function moveUnit(
  world: World,
  unit: string,
  target: string,
  adjacency: Record<string, string[]>,
) {
  return invoke<MoveUnitResult>("move_unit_cmd", {
    world,
    request: { unit, target },
    adjacency,
  });
}
