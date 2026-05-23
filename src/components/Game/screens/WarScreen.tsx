import type { World } from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { FistIcon } from "../../ui/Icon";

/**
 * War screen stub (Plan 12 Phase 1). Active wars list with casus
 * belli, occupation %, war-goal progress, and a peace-channel
 * shortcut lives here once the war data model lands.
 */
export function WarScreen({ world }: { world: World }) {
  const player = world.player_nation;
  // Until Phase 1 lands, we approximate "at war" by relation <= -90 in
  // the player's relations table. Just so the screen shows something
  // recognisable on day one.
  const playerNation = player
    ? world.nations.find((n) => n.id === player) ?? null
    : null;
  const atWarCount = playerNation
    ? Object.values(playerNation.relations ?? {}).filter((r) => r <= -90).length
    : 0;

  return (
    <EmptyState
      icon={<FistIcon />}
      title="Wars"
      description={
        atWarCount === 0
          ? "Active wars, war goals, occupation, and peace negotiations live here. You are currently at peace."
          : `${atWarCount} war${atWarCount === 1 ? "" : "s"} in progress. Casus belli, occupation %, and peace deals will surface here in the next gameplay phase.`
      }
    />
  );
}
