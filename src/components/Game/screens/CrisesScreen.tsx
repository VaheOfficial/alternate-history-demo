import type { World } from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { BellIcon } from "../../ui/Icon";

/**
 * Crises screen stub (Plan 12 Phase 2). Interrupting decision cards
 * with branching options live here once the crisis producer lands.
 */
export function CrisesScreen({ world }: { world: World }) {
  // World.crises already exists in the model; we just don't generate
  // any yet. Surfacing the empty list as the empty state is honest.
  const count = (world.crises ?? []).length;
  return (
    <EmptyState
      icon={<BellIcon />}
      title="Crises"
      description={
        count === 0
          ? "Interrupting decisions show up here — moments where the world demands an answer from you with branching outcomes."
          : `${count} unresolved crisis card${count === 1 ? "" : "s"} pending.`
      }
      hint="Nothing pressing right now. Crises spawn from pending operations, hostile NPC moves, and rare world events."
    />
  );
}
