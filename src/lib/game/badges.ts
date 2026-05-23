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

  // Production (Phase 4): amber when no orders are queued and there's
  // industry to spend. Info badge with count when orders are active.
  const myOrders = (world.production_orders ?? []).filter(
    (o) => o.owner === world.player_nation,
  );
  if (myOrders.length > 0) {
    out.production = { level: "info", count: myOrders.length };
  }

  // Research (Phase 4): amber when no project is set (encourages
  // picking one); cleared once a target is active.
  const playerFull = world.nations.find((n) => n.id === world.player_nation);
  if (playerFull && !playerFull.research?.target) {
    out.research = { level: "amber" };
  } else {
    delete (out as Partial<Record<DockTab, BadgeSpec>>).research;
  }

  // Politics (Phase 3): elevate to red when any faction satisfaction <
  // 20, amber when any < 50. Counts each unhappy faction.
  const player = world.nations.find((n) => n.id === world.player_nation);
  if (player?.factions && player.factions.length > 0) {
    const veryUnhappy = player.factions.filter((f) => f.satisfaction < 20).length;
    const unhappy = player.factions.filter((f) => f.satisfaction < 50).length;
    if (veryUnhappy > 0) {
      out.politics = { level: "red", count: veryUnhappy };
    } else if (unhappy > 0) {
      out.politics = { level: "amber", count: unhappy };
    }
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

  // Intelligence (Phase 5): info badge for active missions, amber when
  // a new completed report is sitting unread (resolved but not yet
  // dismissed via the screen — we approximate by counting resolved
  // missions whose outcome exists).
  const missions = world.spy_missions ?? [];
  const activeMissions = missions.filter((m) => !m.resolved).length;
  const unreadReports = missions.filter((m) => m.resolved && m.outcome).length;
  if (unreadReports > 0) {
    out.intelligence = { level: "amber", count: unreadReports };
  } else if (activeMissions > 0) {
    out.intelligence = { level: "info", count: activeMissions };
  }

  // Crises: red dot with the count of unresolved decision cards.
  const unresolved = (world.crises ?? []).filter((c) => !c.resolved).length;
  if (unresolved > 0) {
    out.crises = { level: "red", count: unresolved };
  }

  // War: red dot when an active war has an unresolved peace proposal
  // (a decision is genuinely waiting on the player). Otherwise amber
  // when any active war exists at all (just to highlight ongoing
  // conflict).
  const activeWars = (world.wars ?? []).filter((w) => w.status === "active");
  let pendingProposals = 0;
  for (const w of activeWars) {
    for (const p of w.peace_proposals) {
      if (!p.accepted && !p.rejected) pendingProposals++;
    }
  }
  if (pendingProposals > 0) {
    out.war = { level: "red", count: pendingProposals };
  } else if (activeWars.length > 0) {
    out.war = { level: "amber", count: activeWars.length };
  }

  // Pending operations strip in the HUD already shows pending; we don't
  // re-badge the dock for it.

  return out;
}
