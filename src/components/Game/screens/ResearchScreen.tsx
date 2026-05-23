import type { World } from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { BeakerIcon } from "../../ui/Icon";

/**
 * Research screen stub (Plan 12 Phase 4). Shows the player nation's
 * tech level today; the tech tree + active project will land in
 * Phase 4.
 */
export function ResearchScreen({ world }: { world: World }) {
  const player = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  return (
    <EmptyState
      icon={<BeakerIcon />}
      title="Research"
      description={
        player
          ? `Current tech level: ${player.tech}. A six-node tech tree (infantry, mech, armor, encryption, logistics, air basics) appears here in the next gameplay phase.`
          : "Where your nation's technology progress lives — pick a player nation first."
      }
    />
  );
}
