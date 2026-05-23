import { useState } from "react";
import type { TechId, World } from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { BeakerIcon } from "../../ui/Icon";
import { setResearchTarget } from "../../../lib/game/tauri";

interface TechDef {
  id: TechId;
  label: string;
  description: string;
  cost: number;
}

const TECHS: TechDef[] = [
  {
    id: "improved_infantry",
    label: "Improved Infantry",
    description: "Better small arms + training. +10% infantry strength.",
    cost: 500,
  },
  {
    id: "mechanized_doctrine",
    label: "Mechanized Doctrine",
    description: "Mechanized infantry doctrine. +15% organization on mech.",
    cost: 800,
  },
  {
    id: "armored_warfare",
    label: "Armored Warfare",
    description: "Modern armored warfare. +20% armor combat power.",
    cost: 1200,
  },
  {
    id: "encryption",
    label: "Encryption",
    description: "Secure communications. Resists hostile espionage.",
    cost: 600,
  },
  {
    id: "advanced_logistics",
    label: "Advanced Logistics",
    description: "Improved supply network. Units stay supplied at range.",
    cost: 700,
  },
  {
    id: "communications",
    label: "Communications",
    description: "Network-centric warfare. +5% organization recovery.",
    cost: 900,
  },
];

export function ResearchScreen({
  world,
  onWorldUpdate,
}: {
  world: World;
  onWorldUpdate: (world: World) => void;
}) {
  const [busy, setBusy] = useState<TechId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  if (!player) {
    return (
      <EmptyState
        icon={<BeakerIcon />}
        title="Research"
        description="Pick a player nation to set a research target."
      />
    );
  }

  const research = player.research ?? { target: null, progress: {} };
  const currentTarget = research.target ?? null;
  const progress = research.progress ?? {};

  const handlePick = async (tech: TechId | null) => {
    setBusy(tech ?? "improved_infantry");
    setError(null);
    try {
      const next = await setResearchTarget(world, tech);
      onWorldUpdate(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const perTick = Math.max(1, Math.floor(player.industry_capacity / 10));

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>Research — {player.name}</div>
      <div style={subtitleStyle}>
        Generates <strong>{perTick}</strong> research points per turn from
        industry capacity. Pick one project at a time.
      </div>
      {currentTarget && (
        <div style={currentBannerStyle}>
          <strong>Current project:</strong> {labelFor(currentTarget)} ·{" "}
          {progress[currentTarget] ?? 0}/{costFor(currentTarget)} pts
          <button
            onClick={() => void handlePick(null)}
            style={pauseBtnStyle}
            className="ahd-press"
          >
            Pause
          </button>
        </div>
      )}
      {error && <div style={errStyle}>{error}</div>}
      <div style={gridStyle}>
        {TECHS.map((t) => {
          const done = (progress[t.id] ?? 0) >= t.cost;
          const isActive = currentTarget === t.id;
          const cur = progress[t.id] ?? 0;
          const pct = (cur / t.cost) * 100;
          return (
            <div
              key={t.id}
              style={{
                ...cardStyle,
                borderColor: done
                  ? "rgba(122,162,247,0.7)"
                  : isActive
                  ? "rgba(245,215,110,0.6)"
                  : "var(--border)",
              }}
            >
              <div style={cardHeader}>
                <strong>{t.label}</strong>
                {done && <span style={doneChipStyle}>UNLOCKED</span>}
                {isActive && !done && (
                  <span style={activeChipStyle}>IN PROGRESS</span>
                )}
              </div>
              <div style={descStyle}>{t.description}</div>
              <div style={barRow}>
                <div style={barTrack}>
                  <div
                    style={{
                      ...barFill,
                      width: `${Math.min(100, pct)}%`,
                      background: done
                        ? "#7aa2f7"
                        : isActive
                        ? "#f5d76e"
                        : "var(--surface-3)",
                    }}
                  />
                </div>
                <div style={barValue}>
                  {cur}/{t.cost}
                </div>
              </div>
              {!done && (
                <button
                  onClick={() => void handlePick(t.id)}
                  disabled={isActive || busy === t.id}
                  style={pickBtnStyle}
                  className="ahd-press"
                >
                  {isActive ? "Researching" : "Set as project"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function labelFor(id: TechId): string {
  return TECHS.find((t) => t.id === id)?.label ?? id;
}
function costFor(id: TechId): number {
  return TECHS.find((t) => t.id === id)?.cost ?? 0;
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
};
const currentBannerStyle: React.CSSProperties = {
  background: "rgba(245,215,110,0.12)",
  border: "1px solid rgba(245,215,110,0.45)",
  borderRadius: "var(--radius-md)",
  padding: "8px 12px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: "var(--fs-sm)",
};
const pauseBtnStyle: React.CSSProperties = {
  marginLeft: "auto",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "3px 10px",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: "var(--fs-xs)",
};
const errStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
};
const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 10,
  flex: 1,
  overflowY: "auto",
  paddingRight: 6,
};
const cardStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid",
  borderRadius: "var(--radius-md)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const cardHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const doneChipStyle: React.CSSProperties = {
  marginLeft: "auto",
  padding: "2px 8px",
  borderRadius: 999,
  background: "#7aa2f7",
  color: "#0c1322",
  fontSize: 9,
  fontWeight: 800,
};
const activeChipStyle: React.CSSProperties = {
  marginLeft: "auto",
  padding: "2px 8px",
  borderRadius: 999,
  background: "#f5d76e",
  color: "#0c1322",
  fontSize: 9,
  fontWeight: 800,
};
const descStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-muted)",
  lineHeight: 1.5,
};
const barRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};
const barTrack: React.CSSProperties = {
  flex: 1,
  height: 6,
  background: "var(--surface-3)",
  borderRadius: 999,
  overflow: "hidden",
};
const barFill: React.CSSProperties = {
  height: "100%",
  transition: "width 220ms ease-out",
};
const barValue: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  width: 80,
  textAlign: "right",
};
const pickBtnStyle: React.CSSProperties = {
  padding: "5px 10px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
  fontWeight: 700,
};
