import type { World } from "../../lib/game/types";

interface EventLike {
  id: string;
  round: number;
  timestamp: string;
  category: string;
  headline: string;
  narrative: string;
}

/** Action / event log for the player. Reads `world.events` (most-recent
 *  first) and renders a scroll. */
export function HistoryPanel({ world }: { world: World }) {
  const events = ((world.events ?? []) as unknown as EventLike[])
    .slice()
    .reverse();
  if (events.length === 0) {
    return (
      <div style={{ color: "var(--fg-muted)", padding: "20px 4px", textAlign: "center" }}>
        Nothing has happened yet. Issue an order or end a turn to start the
        record.
      </div>
    );
  }
  return (
    <div style={listStyle}>
      {events.map((e) => (
        <div key={e.id} style={cardStyle}>
          <div style={metaStyle}>
            <span style={roundTagStyle}>Round {e.round}</span>
            <span style={dateStyle}>{e.timestamp}</span>
            <span style={categoryStyle}>{e.category}</span>
          </div>
          <div style={headlineStyle}>{e.headline}</div>
          {e.narrative && e.narrative !== "(no narrative)" && (
            <div style={narrativeStyle}>{e.narrative}</div>
          )}
        </div>
      ))}
    </div>
  );
}

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 12,
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginBottom: 6,
};

const roundTagStyle: React.CSSProperties = {
  background: "var(--surface-3)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "2px 7px",
  fontSize: "var(--fs-xs)",
  fontWeight: 600,
  letterSpacing: "0.04em",
};

const dateStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-xs)",
};

const categoryStyle: React.CSSProperties = {
  color: "var(--accent)",
  fontSize: "var(--fs-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
};

const headlineStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "var(--fs-md)",
  letterSpacing: "-0.01em",
  marginBottom: 4,
};

const narrativeStyle: React.CSSProperties = {
  color: "var(--fg)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
};
