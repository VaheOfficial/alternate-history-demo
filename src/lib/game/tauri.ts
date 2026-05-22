import { invoke } from "@tauri-apps/api/core";
import type { ModernSaveBootstrap, SaveSummary, World } from "./types";

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
