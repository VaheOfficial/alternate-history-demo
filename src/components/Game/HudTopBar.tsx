import type { Nation, PendingAction } from "../../lib/game/types";
import { colorForMapcolor } from "../../lib/map/renderer";
import { TurnControls } from "./TurnControls";
import {
  CoinIcon,
  PeopleIcon,
  GearIcon,
  HeartbeatIcon,
  FistIcon,
} from "../ui/Icon";

export function HudTopBar({
  date,
  round,
  playerNation,
  pending,
  busy,
  pacingHint,
  onEndTurn,
  onExit,
  onOpenPlayerPanel,
  error,
}: {
  date: string;
  round: number;
  playerNation: Nation | null;
  pending: PendingAction[];
  busy: boolean;
  pacingHint: number | null;
  onEndTurn: (days: number) => void;
  onExit: () => void;
  onOpenPlayerPanel: () => void;
  error: string | null;
}) {
  return (
    <div style={topBarStyle}>
      <div style={leftClusterStyle}>
        <button onClick={onExit} style={menuButtonStyle} className="ahd-press">
          ← Menu
        </button>
        {playerNation && (
          <button
            onClick={onOpenPlayerPanel}
            style={playerBadgeStyle}
            className="ahd-press"
            title="Open your country panel"
          >
            <span
              style={{
                width: 18,
                height: 18,
                background: colorForMapcolor(playerNation.map_color),
                borderRadius: 3,
                boxShadow: "0 0 0 1px rgba(255,255,255,0.18), 0 0 12px rgba(122,162,247,0.35)",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.05 }}>
              <span style={{ fontSize: "var(--fs-md)", fontWeight: 700 }}>{playerNation.name}</span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--fg-dim)", letterSpacing: "0.04em" }}>
                {playerNation.iso_a3}
              </span>
            </div>
          </button>
        )}
      </div>

      {playerNation && (
        <div style={resourcesStyle}>
          <Pill icon={<CoinIcon />} value={`$${fmtBig(playerNation.treasury)}`} label="Treasury" />
          <Pill icon={<PeopleIcon />} value={fmtBig(playerNation.manpower_pool)} label="Manpower" />
          <Pill icon={<GearIcon />} value={String(playerNation.industry_capacity)} label="Industry" />
          <Pill icon={<HeartbeatIcon />} value={String(playerNation.stability)} label="Stability" />
          <Pill icon={<FistIcon />} value={String(playerNation.war_support)} label="War support" />
        </div>
      )}

      <div style={dateBlockStyle}>
        <div style={dateStyle}>{formatDate(date)}</div>
        <div style={roundStyle}>
          Round {round}
          {error && <span style={{ color: "var(--danger)", marginLeft: 10 }}>· {error}</span>}
        </div>
      </div>

      <div style={rightClusterStyle}>
        <TurnControls busy={busy} pacingHint={pacingHint} onEndTurn={onEndTurn} />
      </div>
      {pending.length > 0 && (
        <div style={pendingStripStyle} title={`${pending.length} ongoing operation${pending.length === 1 ? "" : "s"}`}>
          {pending.slice(0, 6).map((p) => (
            <div key={p.id} style={pendingChipStyle} title={`${p.label} — ${p.narrative}`}>
              <span style={{ fontSize: 10, fontWeight: 600 }}>{p.label.slice(0, 18)}</span>
              <span style={pendingBarStyle}>
                <span
                  style={{
                    ...pendingFillStyle,
                    width: `${p.progress_pct}%`,
                  }}
                />
              </span>
              <span style={{ fontSize: 9, color: "var(--fg-dim)" }}>{p.progress_pct}%</span>
            </div>
          ))}
          {pending.length > 6 && (
            <span style={{ color: "var(--fg-dim)", fontSize: 10 }}>+{pending.length - 6}</span>
          )}
        </div>
      )}
    </div>
  );
}

function Pill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div style={pillStyle} title={label}>
      <span style={pillIconStyle}>{icon}</span>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
        <span style={pillValueStyle}>{value}</span>
        <span style={pillLabelStyle}>{label}</span>
      </div>
    </div>
  );
}

function fmtBig(n: number): string {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v >= 1_000_000_000_000) return `${sign}${(v / 1_000_000_000_000).toFixed(1)}T`;
  if (v >= 1_000_000_000) return `${sign}${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${sign}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${sign}${(v / 1_000).toFixed(1)}k`;
  return `${sign}${Math.round(v)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const topBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "10px 16px",
  background:
    "linear-gradient(180deg, rgba(22, 26, 35, 0.96), rgba(15, 17, 21, 0.96))",
  borderBottom: "1px solid var(--border-strong)",
  boxShadow: "0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 6px 16px rgba(0,0,0,0.35)",
  zIndex: 5,
  position: "relative",
};

const leftClusterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flex: "0 0 auto",
};

const menuButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 500,
};

const playerBadgeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 12px",
  background:
    "linear-gradient(160deg, rgba(122,162,247,0.13), rgba(122,162,247,0.04))",
  color: "var(--fg)",
  border: "1px solid rgba(122,162,247,0.45)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  letterSpacing: "-0.005em",
};

const resourcesStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flex: 1,
  justifyContent: "flex-start",
  marginLeft: 8,
};

const pillStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "5px 10px",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--fg)",
};

const pillIconStyle: React.CSSProperties = {
  display: "inline-flex",
  fontSize: "1.05em",
  color: "var(--accent)",
  lineHeight: 0,
};

const pillValueStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "var(--fs-sm)",
  letterSpacing: "-0.005em",
};

const pillLabelStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const dateBlockStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0 14px",
  borderLeft: "1px solid var(--border)",
  borderRight: "1px solid var(--border)",
  flex: "0 0 auto",
};

const dateStyle: React.CSSProperties = {
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.01em",
  lineHeight: 1.1,
};

const roundStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-muted)",
};

const rightClusterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flex: "0 0 auto",
};

const pendingStripStyle: React.CSSProperties = {
  position: "absolute",
  bottom: -28,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  gap: 6,
  padding: "4px 8px",
  background: "rgba(15, 17, 21, 0.85)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

const pendingChipStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: "2px 6px",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 999,
  color: "var(--fg)",
};

const pendingBarStyle: React.CSSProperties = {
  display: "inline-block",
  width: 40,
  height: 4,
  background: "var(--surface-3)",
  borderRadius: 2,
  overflow: "hidden",
};

const pendingFillStyle: React.CSSProperties = {
  display: "block",
  height: "100%",
  background: "var(--accent)",
  transition: "width 240ms ease-out",
};
