import { useState } from "react";
import type { Crisis, World } from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { BellIcon } from "../../ui/Icon";
import { resolveCrisis } from "../../../lib/game/tauri";

/**
 * Crises screen (Plan 12 Phase 2). Decision cards stacked by recency.
 * Each unresolved crisis shows category, escalation level, the stakes
 * paragraph, and 2-3 option buttons. Picking an option calls the
 * engine; the world updates immediately. Past the deadline_round,
 * option 0 auto-applies on the next end-turn.
 *
 * Resolved crises stay on the world for history — shown in a
 * collapsed "past crises" section underneath.
 */
export function CrisesScreen({
  world,
  onWorldUpdate,
}: {
  world: World;
  onWorldUpdate: (world: World) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const crises = world.crises ?? [];
  const active = crises.filter((c) => !c.resolved);
  const resolved = crises.filter((c) => c.resolved);

  if (active.length === 0 && resolved.length === 0) {
    return (
      <EmptyState
        icon={<BellIcon />}
        title="Crises"
        description="Interrupting decisions appear here — moments where the world demands an answer with branching outcomes."
        hint="Nothing pressing right now. Crises spawn from pending operations, hostile NPC moves, and rare world events."
      />
    );
  }

  const handlePick = async (crisis: Crisis, optionIdx: number) => {
    setBusy(crisis.id);
    setError(null);
    try {
      const next = await resolveCrisis(world, crisis.id, optionIdx);
      onWorldUpdate(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>
        Crises
        {active.length > 0 && (
          <span style={countBadge}>
            {active.length} pending
          </span>
        )}
      </div>
      {error && <div style={errStyle}>{error}</div>}
      <div style={listStyle}>
        {active.map((c) => (
          <CrisisCard
            key={c.id}
            crisis={c}
            currentRound={world.clock.round}
            busy={busy === c.id}
            onPick={(idx) => handlePick(c, idx)}
          />
        ))}
        {resolved.length > 0 && (
          <div style={pastHeaderStyle}>Past crises</div>
        )}
        {resolved.slice(-8).reverse().map((c) => (
          <CrisisCard
            key={c.id}
            crisis={c}
            currentRound={world.clock.round}
            historical
          />
        ))}
      </div>
    </div>
  );
}

function CrisisCard({
  crisis,
  currentRound,
  busy,
  onPick,
  historical,
}: {
  crisis: Crisis;
  currentRound: number;
  busy?: boolean;
  onPick?: (optionIdx: number) => void;
  historical?: boolean;
}) {
  const turnsLeft =
    crisis.deadline_round != null
      ? Math.max(0, crisis.deadline_round - currentRound)
      : null;
  const escalation = crisis.escalation?.[0] ?? 0;
  return (
    <div
      style={{
        ...cardStyle,
        opacity: historical ? 0.55 : 1,
        borderColor: CATEGORY_BORDER[crisis.category],
      }}
    >
      <div style={cardHeaderStyle}>
        <span style={categoryChipStyle(crisis.category)}>
          {crisis.category.toUpperCase()}
        </span>
        {!historical && turnsLeft != null && (
          <span
            style={{
              ...deadlineChipStyle,
              background:
                turnsLeft === 0
                  ? "#e26d6d"
                  : turnsLeft === 1
                  ? "#f5d76e"
                  : "var(--surface-3)",
              color: turnsLeft <= 1 ? "#0c1322" : "var(--fg-muted)",
            }}
          >
            {turnsLeft === 0
              ? "DEADLINE PASSED"
              : `${turnsLeft} turn${turnsLeft === 1 ? "" : "s"} left`}
          </span>
        )}
        {historical && (
          <span style={resolvedChipStyle}>
            {crisis.resolved_option != null
              ? `Resolved · option ${crisis.resolved_option + 1}`
              : "Resolved"}
          </span>
        )}
      </div>
      <div style={headlineStyle}>{crisis.headline}</div>
      <div style={escalationRowStyle}>
        <div style={escLabelStyle}>Escalation</div>
        <div style={escTrackStyle}>
          <div
            style={{
              ...escFillStyle,
              width: `${escalation}%`,
              background:
                escalation >= 70
                  ? "#e26d6d"
                  : escalation >= 30
                  ? "#f5d76e"
                  : "#7aa2f7",
            }}
          />
        </div>
        <div style={escPctStyle}>{escalation}</div>
      </div>
      <div style={stakesStyle}>{crisis.stakes}</div>
      {!historical && crisis.options.length > 0 && (
        <div style={optionsBlockStyle}>
          {crisis.options.map((opt, idx) => (
            <button
              key={idx}
              onClick={() => onPick?.(idx)}
              disabled={busy || !onPick}
              style={optionBtnStyle}
              className="ahd-press"
            >
              <div style={optionLabelStyle}>{opt.label}</div>
              <div style={optionNarrativeStyle}>{opt.narrative}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CATEGORY_BORDER: Record<Crisis["category"], string> = {
  diplomatic: "rgba(122,162,247,0.45)",
  military: "rgba(226,109,109,0.45)",
  economic: "rgba(245,215,110,0.45)",
  political: "rgba(154,174,138,0.45)",
  humanitarian: "rgba(159,122,247,0.45)",
};

const CATEGORY_BG: Record<Crisis["category"], string> = {
  diplomatic: "#7aa2f7",
  military: "#e26d6d",
  economic: "#f5d76e",
  political: "#9aae8a",
  humanitarian: "#9f7af7",
};

function categoryChipStyle(cat: Crisis["category"]): React.CSSProperties {
  return {
    padding: "2px 8px",
    borderRadius: 999,
    background: CATEGORY_BG[cat],
    color: "#0c1322",
    fontWeight: 800,
    fontSize: 9,
    letterSpacing: "0.08em",
  };
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  gap: 10,
};

const titleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.01em",
};

const countBadge: React.CSSProperties = {
  padding: "2px 10px",
  borderRadius: 999,
  background: "#e26d6d",
  color: "#0c1322",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.06em",
};

const errStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
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

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const deadlineChipStyle: React.CSSProperties = {
  padding: "2px 10px",
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.06em",
};

const resolvedChipStyle: React.CSSProperties = {
  padding: "2px 10px",
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.06em",
  color: "var(--fg-dim)",
  background: "var(--surface-3)",
};

const headlineStyle: React.CSSProperties = {
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.005em",
};

const escalationRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const escLabelStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  width: 80,
};

const escTrackStyle: React.CSSProperties = {
  flex: 1,
  height: 6,
  background: "var(--surface-3)",
  borderRadius: 999,
  overflow: "hidden",
};

const escFillStyle: React.CSSProperties = {
  height: "100%",
  transition: "width 220ms ease-out",
};

const escPctStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg)",
  width: 32,
  textAlign: "right",
};

const stakesStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--fg-muted)",
  lineHeight: 1.5,
};

const optionsBlockStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 4,
};

const optionBtnStyle: React.CSSProperties = {
  textAlign: "left",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 10px",
  color: "var(--fg)",
  cursor: "pointer",
  fontFamily: "inherit",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const optionLabelStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "var(--fs-sm)",
};

const optionNarrativeStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-muted)",
  lineHeight: 1.5,
};

const pastHeaderStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginTop: 4,
};
