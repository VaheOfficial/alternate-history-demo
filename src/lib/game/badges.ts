import type { World } from "./types";
import type { BadgeLevel } from "../../components/ui/NotificationBadge";
import type { DockTab } from "../../components/Game/CommandDock";

export interface BadgeSpec {
  level: BadgeLevel;
  count?: number;
}

/**
 * Derive the per-tab badge state from the current world. Phase 0 returns
 * placeholder hints — a soft amber "?" dot on the brand-new screens
 * the first time a game opens, so the player notices them. Later
 * phases replace these stubs with real counts (active crises, free
 * build slots, intel reports waiting, etc.).
 *
 * Discovery design rule: never show a red badge on a new game state.
 * Red means REQUIRED. The player has done nothing wrong; they have
 * just opened the app.
 */
export function computeBadges(world: World): Partial<Record<DockTab, BadgeSpec>> {
  const round = world.clock?.round ?? 0;
  const out: Partial<Record<DockTab, BadgeSpec>> = {};

  // Phase 0 stub: on round 0/1, hint the new screens softly. As real
  // producers (crises, build queues, intel reports) come online in
  // later phases they overwrite these.
  if (round <= 1) {
    out.politics = { level: "amber" };
    out.research = { level: "amber" };
    out.production = { level: "amber" };
  }

  // Crises / war / intelligence start empty — no badge until producers exist.
  // Diplomacy: a small info badge if there's at least one open channel
  // with unread NPC messages (any message after the player's last one).
  const playerNation = world.player_nation;
  if (playerNation) {
    const openChannels = (world.diplomatic_channels ?? []).filter(
      (c) => c.status === "open",
    );
    let unreadChannelCount = 0;
    for (const c of openChannels) {
      // Heuristic: last message exists and was sent by someone other
      // than the player → unread.
      const last = c.messages[c.messages.length - 1];
      if (last && last.speaker !== playerNation) unreadChannelCount++;
    }
    if (unreadChannelCount > 0) {
      out.diplomacy = { level: "info", count: unreadChannelCount };
    }
  }

  // Plans: amber if any plan is in "planned" but never executed.
  const planned = (world.battle_plans ?? []).filter(
    (p) => p.owner === playerNation && p.status === "planned",
  ).length;
  if (planned > 0) {
    out.plans = { level: "amber", count: planned };
  }

  // Pending operations strip in the HUD already shows pending; we don't
  // re-badge the dock for it.

  return out;
}
