import type { Nation } from "../../lib/game/types";
import type { NationTurn, OrchestratorPick } from "../../lib/game/tauri";
import { colorForMapcolor } from "../../lib/map/renderer";

export interface EconomyDelta {
  treasury: number;
  manpower: number;
  stability: number;
  war_support: number;
}

export function TurnSummaryModal({
  playerNation,
  economyDelta,
  picks,
  nationTurns,
  newDate,
  daysElapsed,
  worldByIso,
  npcError,
  onClose,
  onFocusNation,
}: {
  playerNation: Nation | null;
  economyDelta: EconomyDelta | null;
  picks: OrchestratorPick[];
  nationTurns: NationTurn[];
  newDate: string;
  daysElapsed: number;
  worldByIso: Map<string, Nation>;
  npcError: string | null;
  onClose: () => void;
  onFocusNation: (nationId: string) => void;
}) {
  const acted = new Set(nationTurns.map((t) => t.iso));
  const passive = picks.filter((p) => !acted.has(p.iso));

  return (
    <div style={backdropStyle} onClick={onClose} className="ahd-motion-fade-in">
      <div style={modalStyle} onClick={(e) => e.stopPropagation()} className="ahd-motion-fade-up">
        <div style={headerStyle}>
          <div>
            <div style={preTitleStyle}>Turn complete</div>
            <h2 style={titleStyle}>{formatDate(newDate)}</h2>
            <div style={subtitleStyle}>
              {daysElapsed} day{daysElapsed === 1 ? "" : "s"} elapsed · {nationTurns.length}{" "}
              nation{nationTurns.length === 1 ? "" : "s"} acted
            </div>
          </div>
          <button onClick={onClose} style={closeButtonStyle} aria-label="Close">
            ×
          </button>
        </div>

        <div style={bodyStyle}>
          {playerNation && economyDelta && (
            <Section title="Your nation">
              <PlayerCard nation={playerNation} delta={economyDelta} />
            </Section>
          )}

          {npcError && (
            <div style={errorStyle}>
              <strong>NPC turn failed:</strong> {npcError}
            </div>
          )}

          {nationTurns.length > 0 && (
            <Section title="World events">
              <div style={cardListStyle}>
                {nationTurns.map((t) => {
                  const nation = worldByIso.get(t.iso) ?? null;
                  return (
                    <NationCard
                      key={t.iso}
                      turn={t}
                      nation={nation}
                      onClick={() => nation && onFocusNation(nation.id)}
                    />
                  );
                })}
              </div>
            </Section>
          )}

          {passive.length > 0 && (
            <Section title="Considered but quiet">
              <div style={passiveListStyle}>
                {passive.map((p) => {
                  const nation = worldByIso.get(p.iso);
                  return (
                    <div key={p.iso} style={passiveChipStyle}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          background: nation
                            ? colorForMapcolor(nation.map_color)
                            : "var(--surface-3)",
                          borderRadius: 2,
                          display: "inline-block",
                        }}
                      />
                      <span style={{ fontWeight: 600 }}>
                        {nation?.name ?? p.iso}
                      </span>
                      <span style={{ color: "var(--fg-dim)" }}>{p.reason}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {nationTurns.length === 0 && !npcError && (
            <div style={{ color: "var(--fg-muted)", padding: 12, textAlign: "center" }}>
              No nation took action this turn.
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <button onClick={onClose} style={primaryButtonStyle}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </div>
  );
}

function PlayerCard({ nation, delta }: { nation: Nation; delta: EconomyDelta }) {
  const swatch = colorForMapcolor(nation.map_color);
  return (
    <div style={playerCardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 16,
            height: 16,
            background: swatch,
            borderRadius: 3,
            boxShadow: "0 0 0 1px rgba(255,255,255,0.15)",
          }}
        />
        <div style={{ fontWeight: 700, fontSize: "var(--fs-md)" }}>
          {nation.name}
        </div>
      </div>
      <div style={deltaGridStyle}>
        <Delta label="Treasury" value={delta.treasury} format="money" />
        <Delta label="Manpower" value={delta.manpower} format="num" />
        <Delta label="Stability" value={delta.stability} format="signed" />
        <Delta label="War support" value={delta.war_support} format="signed" />
      </div>
    </div>
  );
}

function Delta({
  label,
  value,
  format,
}: {
  label: string;
  value: number;
  format: "money" | "num" | "signed";
}) {
  const positive = value > 0;
  const negative = value < 0;
  const color = positive ? "#7ec97e" : negative ? "var(--danger)" : "var(--fg-muted)";
  const sign = positive ? "+" : "";
  let str: string;
  switch (format) {
    case "money":
      str = `${sign}$${fmtBig(Math.abs(value))}`;
      if (negative) str = `-$${fmtBig(Math.abs(value))}`;
      break;
    case "num":
      str = `${sign}${fmtBig(Math.abs(value))}`;
      if (negative) str = `-${fmtBig(Math.abs(value))}`;
      break;
    case "signed":
      str = `${sign}${value}`;
      break;
  }
  return (
    <div>
      <div style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>{label}</div>
      <div style={{ color, fontWeight: 700, fontSize: "var(--fs-md)" }}>{str}</div>
    </div>
  );
}

function NationCard({
  turn,
  nation,
  onClick,
}: {
  turn: NationTurn;
  nation: Nation | null;
  onClick: () => void;
}) {
  const swatch = nation
    ? colorForMapcolor(nation.map_color)
    : "var(--surface-3)";
  const headline = turn.applied.length > 0
    ? `${turn.applied.length} action${turn.applied.length === 1 ? "" : "s"}`
    : "rhetoric only";
  return (
    <button onClick={onClick} style={nationCardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span
          style={{
            width: 12,
            height: 12,
            background: swatch,
            borderRadius: 2,
            boxShadow: "0 0 0 1px rgba(255,255,255,0.15)",
          }}
        />
        <div style={{ fontWeight: 700, fontSize: "var(--fs-md)", flex: 1 }}>
          {turn.nation_name}
        </div>
        <span style={tagStyle}>{headline}</span>
      </div>
      <div style={narrativeStyle}>{turn.narrative}</div>
      {turn.goal_update && turn.goal_update.length > 0 && (
        <div style={goalUpdateStyle}>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>Goals updated →</span>{" "}
          {turn.goal_update.join("; ")}
        </div>
      )}
      {turn.failures.length > 0 && (
        <div style={failureStyle}>
          {turn.failures.length} action{turn.failures.length === 1 ? "" : "s"} rejected by engine
        </div>
      )}
    </button>
  );
}

function fmtBig(n: number): string {
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(2)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
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

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(8, 10, 14, 0.62)",
  backdropFilter: "blur(2px)",
  WebkitBackdropFilter: "blur(2px)",
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const modalStyle: React.CSSProperties = {
  width: "min(820px, calc(100vw - 32px))",
  maxHeight: "90vh",
  background: "var(--surface-1)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  padding: "20px 24px 12px",
  borderBottom: "1px solid var(--border)",
};

const preTitleStyle: React.CSSProperties = {
  color: "var(--accent)",
  fontSize: "var(--fs-xs)",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  fontWeight: 700,
};

const titleStyle: React.CSSProperties = {
  margin: "2px 0 4px",
  fontSize: "1.8rem",
  fontWeight: 800,
  letterSpacing: "-0.022em",
  lineHeight: 1.1,
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-sm)",
};

const closeButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--fg-muted)",
  fontSize: 28,
  lineHeight: 1,
  cursor: "pointer",
  padding: "0 6px",
};

const bodyStyle: React.CSSProperties = {
  padding: "16px 24px 0",
  overflowY: "auto",
  flex: 1,
};

const sectionTitleStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  fontWeight: 600,
  marginBottom: 8,
};

const playerCardStyle: React.CSSProperties = {
  background: "linear-gradient(160deg, rgba(122,162,247,0.10), rgba(122,162,247,0.02))",
  border: "1px solid rgba(122,162,247,0.35)",
  borderRadius: "var(--radius-md)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const deltaGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 16,
};

const cardListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const nationCardStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 14,
  cursor: "pointer",
  fontFamily: "inherit",
  color: "var(--fg)",
  textAlign: "left",
  display: "flex",
  flexDirection: "column",
  transition: "border-color 120ms ease",
};

const tagStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "2px 8px",
};

const narrativeStyle: React.CSSProperties = {
  color: "var(--fg)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
};

const goalUpdateStyle: React.CSSProperties = {
  marginTop: 8,
  paddingTop: 8,
  borderTop: "1px solid var(--border)",
  fontSize: "var(--fs-xs)",
  color: "var(--fg-muted)",
};

const failureStyle: React.CSSProperties = {
  marginTop: 8,
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
};

const passiveListStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const passiveChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "5px 10px",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 999,
  fontSize: "var(--fs-xs)",
};

const errorStyle: React.CSSProperties = {
  background: "rgba(60,16,16,0.55)",
  border: "1px solid #5a2a2a",
  color: "var(--danger)",
  borderRadius: "var(--radius-md)",
  padding: "10px 12px",
  fontSize: "var(--fs-sm)",
  marginBottom: 14,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  padding: "12px 24px 20px",
  borderTop: "1px solid var(--border)",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "10px 20px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.005em",
};
