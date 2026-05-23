import { useState } from "react";
import type { Nation, War, World } from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { FistIcon } from "../../ui/Icon";
import {
  acceptPeaceProposal,
  rejectPeaceProposal,
} from "../../../lib/game/tauri";
import { colorForMapcolor } from "../../../lib/map/renderer";

/**
 * War screen (Plan 12 Phase 1). Lists every War record on the world.
 * Each card shows aggressor + defender(s), casus belli, occupation %
 * bar, and any pending peace proposals with Accept / Reject buttons.
 */
export function WarScreen({
  world,
  onWorldUpdate,
}: {
  world: World;
  onWorldUpdate: (world: World) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wars = world.wars ?? [];
  const active = wars.filter((w) => w.status === "active");
  const ended = wars.filter((w) => w.status !== "active");

  if (wars.length === 0) {
    return (
      <EmptyState
        icon={<FistIcon />}
        title="Wars"
        description="Active wars, casus belli, occupation, and peace proposals appear here."
        hint="No wars yet. Declare war via Orders to start one — pick a casus belli to shape how it ends."
      />
    );
  }

  const nationsById = new Map(world.nations.map((n) => [n.id, n]));

  const handleAccept = async (warId: string, proposalId: string) => {
    setBusy(proposalId);
    setError(null);
    try {
      const next = await acceptPeaceProposal(world, warId, proposalId);
      onWorldUpdate(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const handleReject = async (warId: string, proposalId: string) => {
    setBusy(proposalId);
    setError(null);
    try {
      const next = await rejectPeaceProposal(world, warId, proposalId);
      onWorldUpdate(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>Wars</div>
      <div style={subtitleStyle}>
        {active.length} active · {ended.length} concluded
      </div>
      {error && <div style={errStyle}>{error}</div>}
      <div style={listStyle}>
        {active.map((w) => (
          <WarCard
            key={w.id}
            war={w}
            nationsById={nationsById}
            busyProposalId={busy}
            onAccept={(pid) => handleAccept(w.id, pid)}
            onReject={(pid) => handleReject(w.id, pid)}
          />
        ))}
        {ended.length > 0 && (
          <div style={endedHeaderStyle}>Past wars</div>
        )}
        {ended.map((w) => (
          <WarCard
            key={w.id}
            war={w}
            nationsById={nationsById}
            historical
          />
        ))}
      </div>
    </div>
  );
}

function WarCard({
  war,
  nationsById,
  busyProposalId,
  onAccept,
  onReject,
  historical,
}: {
  war: War;
  nationsById: Map<string, Nation>;
  busyProposalId?: string | null;
  onAccept?: (proposalId: string) => void;
  onReject?: (proposalId: string) => void;
  historical?: boolean;
}) {
  const aggressor = nationsById.get(war.aggressor);
  const defender = nationsById.get(war.defenders[0] ?? "");
  const livePeace = war.peace_proposals.filter(
    (p) => !p.accepted && !p.rejected,
  );
  return (
    <div
      style={{
        ...cardStyle,
        opacity: historical ? 0.6 : 1,
      }}
    >
      <div style={cardHeaderStyle}>
        <NationChip nation={aggressor} />
        <span style={{ color: "var(--fg-muted)" }}>vs</span>
        <NationChip nation={defender} />
        <div style={statusBadgeStyle(war.status)}>
          {war.status.toUpperCase()}
        </div>
      </div>
      <div style={cbStyle}>
        Casus belli: <strong>{labelForCB(war.casus_belli)}</strong>
        <span style={{ marginLeft: 8, color: "var(--fg-dim)" }}>
          · declared {war.declared_on}
        </span>
      </div>
      <div style={progressRowStyle}>
        <div style={progressLabelStyle}>Occupation</div>
        <div style={progressTrackStyle}>
          <div
            style={{
              ...progressFillStyle,
              width: `${Math.min(100, war.occupation_pct)}%`,
              background:
                war.occupation_pct >= 60
                  ? "#f5d76e"
                  : war.occupation_pct >= 30
                  ? "#7aa2f7"
                  : "var(--surface-3)",
            }}
          />
        </div>
        <div style={progressPctStyle}>{war.occupation_pct}%</div>
      </div>
      {war.conquered_provinces.length > 0 && (
        <div style={detailStyle}>
          {war.conquered_provinces.length} province
          {war.conquered_provinces.length === 1 ? "" : "s"} occupied
        </div>
      )}

      {livePeace.length > 0 && (
        <div style={proposalsBlockStyle}>
          {livePeace.map((p) => (
            <div key={p.id} style={proposalCardStyle}>
              <div style={proposalHeaderStyle}>
                {p.headline}
                <span style={proposalThresholdChip}>{p.threshold}%</span>
              </div>
              <div style={proposalNarrativeStyle}>{p.narrative}</div>
              <div style={proposalActionsRow}>
                <button
                  onClick={() => onAccept?.(p.id)}
                  disabled={busyProposalId === p.id || !onAccept}
                  style={acceptBtnStyle}
                  className="ahd-press"
                >
                  {busyProposalId === p.id ? "Signing…" : "Accept peace"}
                </button>
                <button
                  onClick={() => onReject?.(p.id)}
                  disabled={busyProposalId === p.id || !onReject}
                  style={rejectBtnStyle}
                  className="ahd-press"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NationChip({ nation }: { nation?: Nation }) {
  if (!nation) {
    return <span style={{ color: "var(--fg-dim)" }}>(unknown)</span>;
  }
  return (
    <span style={chipStyle(nation)}>
      <span
        style={{
          width: 9,
          height: 9,
          background: colorForMapcolor(nation.map_color),
          borderRadius: 2,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.18)",
        }}
      />
      <strong>{nation.name}</strong>
    </span>
  );
}

function chipStyle(_n: Nation): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: 999,
    fontSize: "var(--fs-sm)",
  };
}

function statusBadgeStyle(s: War["status"]): React.CSSProperties {
  const bg =
    s === "active"
      ? "#e26d6d"
      : s === "concluded"
      ? "#7aa2f7"
      : "var(--surface-3)";
  return {
    marginLeft: "auto",
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color: "#0c1322",
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: "0.08em",
  };
}

function labelForCB(cb: War["casus_belli"]): string {
  switch (cb) {
    case "annex_provinces":
      return "Annex contested provinces";
    case "install_puppet":
      return "Install friendly government";
    case "force_concession":
      return "Force a concession";
    case "demilitarize":
      return "Demilitarize the loser";
    case "humiliate_rival":
      return "Humiliate the rival";
    case "free_nation":
      return "Liberate a satellite";
  }
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
  letterSpacing: "-0.01em",
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
};

const errStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
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
  gap: 8,
};

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const cbStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-muted)",
};

const progressRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const progressLabelStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  width: 80,
};

const progressTrackStyle: React.CSSProperties = {
  flex: 1,
  height: 6,
  background: "var(--surface-3)",
  borderRadius: 999,
  overflow: "hidden",
};

const progressFillStyle: React.CSSProperties = {
  height: "100%",
  transition: "width 220ms ease-out",
};

const progressPctStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg)",
  width: 36,
  textAlign: "right",
};

const detailStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
};

const proposalsBlockStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 4,
};

const proposalCardStyle: React.CSSProperties = {
  background: "rgba(245, 215, 110, 0.10)",
  border: "1px solid rgba(245, 215, 110, 0.40)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 10px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const proposalHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  fontWeight: 700,
  fontSize: "var(--fs-sm)",
  gap: 8,
};

const proposalThresholdChip: React.CSSProperties = {
  marginLeft: "auto",
  padding: "1px 8px",
  background: "#f5d76e",
  color: "#0c1322",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 800,
};

const proposalNarrativeStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-xs)",
  lineHeight: 1.5,
};

const proposalActionsRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginTop: 4,
};

const acceptBtnStyle: React.CSSProperties = {
  padding: "5px 12px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
  fontWeight: 700,
};

const rejectBtnStyle: React.CSSProperties = {
  padding: "5px 12px",
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
};

const endedHeaderStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginTop: 4,
};
