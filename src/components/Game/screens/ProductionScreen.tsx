import type { World } from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { FactoryIcon } from "../../ui/Icon";

/**
 * Production screen stub (Plan 12 Phase 4). Multi-turn build queue
 * with slots lives here once the data model lands.
 */
export function ProductionScreen({ world }: { world: World }) {
  const player = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  return (
    <EmptyState
      icon={<FactoryIcon />}
      title="Production"
      description={
        player
          ? `Industry capacity ${player.industry_capacity} · treasury $${(player.treasury / 1_000_000).toFixed(1)}M. The multi-turn build queue lands here in the next gameplay phase.`
          : "Multi-turn build queue. Pick a player nation to see what you can produce."
      }
    />
  );
}
