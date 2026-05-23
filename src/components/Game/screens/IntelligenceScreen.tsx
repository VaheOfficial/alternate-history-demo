import { useMemo, useState } from "react";
import type {
  SpyMission,
  SpyMissionKind,
  TechId,
  World,
} from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { EyeIcon } from "../../ui/Icon";
import {
  dismissSpyMission,
  startSpyMission,
} from "../../../lib/game/tauri";

const KIND_DEFS: Array<{
  id: SpyMissionKind;
  label: string;
  description: string;
  days: number;
  successPct: number;
  techRequired?: boolean;
}> = [
  {
    id: "steal_tech",
    label: "Steal Technology",
    description:
      "Lift a target nation's research. On success, gain 50% of the chosen tech's cost as research progress.",
    days: 28,
    successPct: 35,
    techRequired: true,
  },
  {
    id: "sabotage_industry",
    label: "Sabotage Industry",
    description:
      "Damage the target's industrial base. On success, target loses 5 IC (semi-permanent until repaired).",
    days: 21,
    successPct: 45,
  },
  {
    id: "gather_intel",
    label: "Gather Intelligence",
    description:
      "Quietly survey the target. Highest success rate; output is a detailed report rather than a direct effect.",
    days: 14,
    successPct: 70,
  },
];

const TECH_OPTIONS: { id: TechId; label: string }[] = [
  { id: "improved_infantry", label: "Improved Infantry" },
  { id: "mechanized_doctrine", label: "Mechanized Doctrine" },
  { id: "armored_warfare", label: "Armored Warfare" },
  { id: "encryption", label: "Encryption" },
  { id: "advanced_logistics", label: "Advanced Logistics" },
  { id: "communications", label: "Communications" },
];

export function IntelligenceScreen({
  world,
  onWorldUpdate,
}: {
  world: World;
  onWorldUpdate: (world: World) => void;
}) {
  const [kind, setKind] = useState<SpyMissionKind>("gather_intel");
  const [targetIso, setTargetIso] = useState("");
  const [techTarget, setTechTarget] = useState<TechId>("encryption");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const player = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;
  if (!player) {
    return (
      <EmptyState
        icon={<EyeIcon />}
        title="Intelligence"
        description="Pick a player nation to recruit spies and run missions."
      />
    );
  }

  const candidates = useMemo(
    () =>
      world.nations
        .filter((n) => n.id !== player.id)
        .sort((a, b) => b.industry_capacity - a.industry_capacity)
        .slice(0, 60),
    [world.nations, player.id],
  );
  const nationsById = new Map(world.nations.map((n) => [n.id, n]));

  const missions = world.spy_missions ?? [];
  const active = missions.filter((m) => !m.resolved);
  const reports = missions.filter((m) => m.resolved);

  const handleStart = async () => {
    if (!targetIso) {
      setError("Pick a target nation.");
      return;
    }
    setBusy("start");
    setError(null);
    const def = KIND_DEFS.find((d) => d.id === kind);
    try {
      const next = await startSpyMission(world, {
        target: targetIso,
        kind,
        tech_target: def?.techRequired ? techTarget : null,
      });
      onWorldUpdate(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const handleDismiss = async (m: SpyMission) => {
    setBusy(m.id);
    setError(null);
    try {
      const next = await dismissSpyMission(world, m.id);
      onWorldUpdate(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const def = KIND_DEFS.find((d) => d.id === kind);

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>Intelligence — {player.name}</div>
      <div style={subtitleStyle}>
        Run spy missions against rival powers. Each mission resolves on its
        deadline with a deterministic success roll.
      </div>

      {error && <div style={errStyle}>{error}</div>}

      <div style={addFormStyle}>
        <div style={formTitleStyle}>New mission</div>
        <div style={formRowStyle}>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SpyMissionKind)}
            className="ahd-select"
            style={selectStyle}
          >
            {KIND_DEFS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.successPct}% · {d.days}d)
              </option>
            ))}
          </select>
          <select
            value={targetIso}
            onChange={(e) => setTargetIso(e.target.value)}
            className="ahd-select"
            style={selectStyle}
          >
            <option value="">Pick target…</option>
            {candidates.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} ({n.iso_a3})
              </option>
            ))}
          </select>
          {def?.techRequired && (
            <select
              value={techTarget}
              onChange={(e) => setTechTarget(e.target.value as TechId)}
              className="ahd-select"
              style={selectStyle}
            >
              {TECH_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => void handleStart()}
            disabled={busy === "start"}
            style={startBtnStyle}
            className="ahd-press"
          >
            Launch
          </button>
        </div>
        {def && <div style={defDescStyle}>{def.description}</div>}
      </div>

      <div style={sectionHeaderStyle}>
        Active missions
        {active.length > 0 && <span style={countBadge}>{active.length}</span>}
      </div>
      {active.length === 0 ? (
        <div style={emptyStyle}>
          No missions in flight. Pick a mission type + target above to deploy
          an agent.
        </div>
      ) : (
        <div style={listStyle}>
          {active.map((m) => {
            const target = nationsById.get(m.target);
            return (
              <div key={m.id} style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <strong>{labelForKind(m.kind)}</strong>
                  <span style={metaStyle}>
                    → {target?.name ?? "(unknown)"} · resolves {m.resolves_on}
                  </span>
                </div>
                <div style={metaStyle}>
                  Base success: {m.success_pct}%
                  {m.tech_target && ` · target tech: ${labelForTech(m.tech_target)}`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={sectionHeaderStyle}>
        Reports
        {reports.length > 0 && <span style={countBadge}>{reports.length}</span>}
      </div>
      {reports.length === 0 ? (
        <div style={emptyStyle}>No completed missions yet.</div>
      ) : (
        <div style={listStyle}>
          {reports
            .slice()
            .reverse()
            .slice(0, 10)
            .map((m) => {
              const target = nationsById.get(m.target);
              const ok = m.outcome?.result === "success";
              return (
                <div
                  key={m.id}
                  style={{
                    ...cardStyle,
                    borderColor: ok
                      ? "rgba(122,162,247,0.45)"
                      : "rgba(226,109,109,0.45)",
                  }}
                >
                  <div style={cardHeaderStyle}>
                    <strong>{labelForKind(m.kind)}</strong>
                    <span
                      style={{
                        ...resultChipStyle,
                        background: ok ? "#7aa2f7" : "#e26d6d",
                      }}
                    >
                      {ok ? "SUCCESS" : "FAILED"}
                    </span>
                  </div>
                  <div style={metaStyle}>
                    → {target?.name ?? "(unknown)"} · {m.resolves_on}
                  </div>
                  <div style={narrativeStyle}>
                    {m.outcome?.narrative ?? "(no report)"}
                  </div>
                  <div style={cardActionsRow}>
                    <button
                      onClick={() => void handleDismiss(m)}
                      disabled={busy === m.id}
                      style={dismissBtnStyle}
                      className="ahd-press"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function labelForKind(k: SpyMissionKind): string {
  return KIND_DEFS.find((d) => d.id === k)?.label ?? k;
}
function labelForTech(t: TechId): string {
  return TECH_OPTIONS.find((x) => x.id === t)?.label ?? t;
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  gap: 10,
};
const titleStyle: React.CSSProperties = {
  fontSize: "var(--fs-md)",
  fontWeight: 700,
};
const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
  lineHeight: 1.45,
};
const errStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
};
const addFormStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const formTitleStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const formRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};
const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 150,
  fontSize: "var(--fs-sm)",
  padding: "4px 6px",
};
const startBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 700,
};
const defDescStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-muted)",
  lineHeight: 1.5,
};
const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const countBadge: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--surface-3)",
  color: "var(--fg-muted)",
  fontSize: 9,
  fontWeight: 700,
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
  gap: 8,
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
const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};
const metaStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
};
const narrativeStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--fg-muted)",
  lineHeight: 1.5,
};
const resultChipStyle: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 999,
  color: "#0c1322",
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.08em",
};
const cardActionsRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};
const dismissBtnStyle: React.CSSProperties = {
  padding: "3px 10px",
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
};
