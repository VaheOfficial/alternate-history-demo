import type { World } from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { EyeIcon } from "../../ui/Icon";

/**
 * Intelligence screen stub (Plan 12 Phase 5). Spy missions, counter-intel,
 * and intel reports live here once the espionage data model lands.
 */
export function IntelligenceScreen({ world }: { world: World }) {
  void world;
  return (
    <EmptyState
      icon={<EyeIcon />}
      title="Intelligence"
      description="Spy missions, counter-intel operations, and intelligence reports about other powers live here."
      hint="Steal technology, sabotage industry, fund coups, or just gather intel — the surface for it shows up in a later gameplay phase."
    />
  );
}
