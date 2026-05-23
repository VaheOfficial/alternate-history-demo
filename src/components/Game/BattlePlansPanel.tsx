import { useState } from "react";
import type { BattlePlan, World } from "../../lib/game/types";
import {
  cancelBattlePlan,
  executeBattlePlan,
  type BattlePlanStep,
} from "../../lib/game/tauri";

/**
 * Battle Plans (Plan 10) — list of player-drawn movement plans. Each plan
 * shows source provinces (with current division counts), target, status,
 * and Execute / Cancel buttons. Execute moves units one hop toward the
 * target along the adjacency graph; the player presses it each turn to
 * march further. Cancel drops the plan from the world.
 *
 * Selection workflow lives in GameSession; this panel is just the
 * inventory view + actions.
 */
export function BattlePlansPanel({
  world,
  adjacency,
  onWorldUpdate,
  draftSourceCount,
  onClearDraft,
}: {
  world: World;
  adjacency: Record<string, string[]> | null;
  onWorldUpdate: (world: World) => void;
  /**
   * The number of provinces currently selected as battle-plan sources.
   * The panel surfaces this as a hint so the player knows what they're
   * about to commit to with the next right-click.
   */
  draftSourceCount: number;
  onClearDraft: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSteps, setLastSteps] = useState<{
    planId: string;
    steps: BattlePlanStep[];
  } | null>(null);

  // Only show plans owned by the player.
  const playerNation = world.player_nation;
  const plans: BattlePlan[] = (world.battle_plans ?? []).filter(
    (p) => p.owner === playerNation,
  );

  const provinceById = new Map(world.provinces.map((p) => [p.id, p]));
  const playerUnitsByProvince = new Map<string, number>();
  if (playerNation) {
    for (const u of world.units) {
      if (u.owner !== playerNation) continue;
      playerUnitsByProvince.set(
        u.location,
        (playerUnitsByProvince.get(u.location) ?? 0) + 1,
      );
    }
  }

  const handleExecute = async (plan: BattlePlan) => {
    if (!adjacency) {
      setError("Adjacency map not loaded yet — try again in a moment.");
      return;
    }
    setBusyId(plan.id);
    setError(null);
    try {
      const result = await executeBattlePlan(world, plan.id, adjacency);
      onWorldUpdate(result.world);
      setLastSteps({ planId: plan.id, steps: result.steps });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (plan: BattlePlan) => {
    setBusyId(plan.id);
    setError(null);
    try {
      const newWorld = await cancelBattlePlan(world, plan.id);
      onWorldUpdate(newWorld);
      if (lastSteps?.planId === plan.id) setLastSteps(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <div style={titleStyle}>Battle Plans</div>
          <div style={subtitleStyle}>
            Shift-click friendly provinces to add as sources, then
            right-click any province to set the target. Execute moves
            divisions one hop toward the target each turn.
          </div>
        </div>
      </div>

      {draftSourceCount > 0 && (
        <div style={draftBannerStyle}>
          <span>
            <strong>{draftSourceCount}</strong> source province
            {draftSourceCount === 1 ? "" : "s"} selected — right-click any
            province on the map to set the target.
          </span>
          <button
            onClick={onClearDraft}
            style={clearDraftBtnStyle}
            className="ahd-press"
          >
            Clear
          </button>
        </div>
      )}

      {error && <div style={errStyle}>{error}</div>}

      {plans.length === 0 ? (
        <div style={emptyStyle}>
          No active plans. Shift-click a friendly province on the map to
          start drawing one.
        </div>
      ) : (
        <div style={listStyle}>
          {plans.map((plan) => {
            const sources = plan.sources
              .map((id) => provinceById.get(id))
              .filter((p): p is NonNullable<typeof p> => !!p);
            const totalUnits = plan.sources.reduce(
              (sum, id) => sum + (playerUnitsByProvince.get(id) ?? 0),
              0,
            );
            const target = provinceById.get(plan.target);
            const cardSteps =
              lastSteps?.planId === plan.id ? lastSteps.steps : null;
            return (
              <div key={plan.id} style={cardStyle}>
                <div style={cardHeaderRow}>
                  <div style={statusChipStyle(plan.status)}>
                    {plan.status.toUpperCase()}
                  </div>
                  <div style={cardLabelStyle}>
                    {sources.length} source
                    {sources.length === 1 ? "" : "s"} → {target?.name ?? "?"}
                  </div>
                </div>
                <div style={cardDetailStyle}>
                  <strong>{totalUnits}</strong> divisions ready ·{" "}
                  {plan.executions > 0 && (
                    <>marched {plan.executions} hop{plan.executions === 1 ? "" : "s"} · </>
                  )}
                  from{" "}
                  {sources
                    .map((p) => p.name)
                    .slice(0, 3)
                    .join(", ")}
                  {sources.length > 3 && ` +${sources.length - 3} more`}
                </div>
                <div style={cardActionsRow}>
                  <button
                    onClick={() => handleExecute(plan)}
                    disabled={busyId === plan.id || !adjacency}
                    style={executeBtnStyle}
                    className="ahd-press"
                  >
                    {busyId === plan.id ? "Marching…" : "Execute one hop"}
                  </button>
                  <button
                    onClick={() => handleCancel(plan)}
                    disabled={busyId === plan.id}
                    style={cancelBtnStyle}
                    className="ahd-press"
                  >
                    Cancel
                  </button>
                </div>
                {cardSteps && cardSteps.length > 0 && (
                  <details style={stepsStyle}>
                    <summary style={stepsSummaryStyle}>
                      Last execute: {cardSteps.filter((s) => s.units_moved > 0).length}/
                      {cardSteps.length} sources advanced
                    </summary>
                    <ul style={stepsListStyle}>
                      {cardSteps.map((s, i) => {
                        const src = provinceById.get(s.source);
                        const hop =
                          s.hop_target ? provinceById.get(s.hop_target) : null;
                        const isInvalid =
                          typeof s.outcome === "object" &&
                          s.outcome.outcome === "invalid";
                        return (
                          <li
                            key={i}
                            style={{
                              color: isInvalid
                                ? "var(--danger)"
                                : "var(--fg-muted)",
                            }}
                          >
                            {src?.name ?? "?"} →{" "}
                            {hop?.name ?? "—"}: {s.units_moved} div ·{" "}
                            {summarizeOutcome(s)}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function summarizeOutcome(step: BattlePlanStep): string {
  const o = step.outcome;
  if (typeof o !== "object") return String(o);
  switch (o.outcome) {
    case "moved":
      return "moved";
    case "battle_won_conquered":
      return "conquered";
    case "battle_won":
      return "battle won";
    case "stalemate":
      return "stalemate";
    case "battle_lost":
      return "repulsed";
    case "invalid":
      return `blocked — ${o.reason}`;
    default:
      return "—";
  }
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  gap: 10,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "var(--fs-md)",
  letterSpacing: "-0.01em",
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
  marginTop: 2,
  lineHeight: 1.45,
};

const draftBannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  background: "rgba(245, 215, 110, 0.12)",
  border: "1px solid rgba(245, 215, 110, 0.35)",
  borderRadius: "var(--radius-md)",
  padding: "8px 12px",
  fontSize: "var(--fs-xs)",
  color: "var(--fg)",
};

const clearDraftBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: "var(--fs-xs)",
};

const errStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
};

const emptyStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-sm)",
  background: "var(--surface-1)",
  border: "1px dashed var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 14,
  lineHeight: 1.5,
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  flex: 1,
  overflowY: "auto",
  paddingRight: 6,
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const cardHeaderRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

function statusChipStyle(status: BattlePlan["status"]): React.CSSProperties {
  const bg =
    status === "planned"
      ? "#f5d76e"
      : status === "executed"
      ? "#7aa2f7"
      : "var(--surface-3)";
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color: "#0c1322",
    fontWeight: 800,
    fontSize: 10,
    letterSpacing: "0.08em",
  };
}

const cardLabelStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "var(--fs-sm)",
  letterSpacing: "-0.005em",
};

const cardDetailStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-xs)",
};

const cardActionsRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 4,
};

const executeBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
  fontWeight: 700,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
  fontWeight: 600,
};

const stepsStyle: React.CSSProperties = {
  marginTop: 6,
  background: "rgba(122, 162, 247, 0.06)",
  border: "1px solid rgba(122, 162, 247, 0.18)",
  borderRadius: "var(--radius-sm)",
  padding: "4px 8px",
};

const stepsSummaryStyle: React.CSSProperties = {
  cursor: "pointer",
  fontSize: "var(--fs-xs)",
  color: "var(--accent)",
  fontWeight: 600,
};

const stepsListStyle: React.CSSProperties = {
  margin: "6px 0 0",
  paddingLeft: 18,
  fontSize: "var(--fs-xs)",
  lineHeight: 1.5,
};
