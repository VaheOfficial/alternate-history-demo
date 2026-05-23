import type { World } from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { CrownIcon } from "../../ui/Icon";

/**
 * Politics screen (Plan 12 Phase 3 will fill this in). Until factions
 * exist on the world model, the screen surfaces the player nation's
 * government and high-level pulse (stability, war support) as a
 * recognisable placeholder.
 */
export function PoliticsScreen({ world }: { world: World }) {
  const player = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  if (!player) {
    return (
      <EmptyState
        icon={<CrownIcon />}
        title="Politics"
        description="Your nation's internal coalitions and government structure live here."
        hint="Pick a player nation from the landing page to populate this screen."
      />
    );
  }

  return (
    <EmptyState
      icon={<CrownIcon />}
      title={`Politics — ${player.name}`}
      description={`${governmentLabel(player.government)} · stability ${player.stability} · war support ${player.war_support}`}
      hint="Faction power & satisfaction will appear here in the next gameplay phase."
    />
  );
}

function governmentLabel(g: string): string {
  return g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, " ");
}
