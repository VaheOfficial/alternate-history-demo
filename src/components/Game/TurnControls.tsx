import { useState } from "react";

export type TimeIncrement = "1w" | "1m" | "3m" | "6m" | "1y" | "ai";

const INCREMENT_DAYS: Record<Exclude<TimeIncrement, "ai">, number> = {
  "1w": 7,
  "1m": 30,
  "3m": 91,
  "6m": 183,
  "1y": 365,
};

export function incrementToDays(
  inc: TimeIncrement,
  fallbackDays: number,
): number {
  if (inc === "ai") return fallbackDays;
  return INCREMENT_DAYS[inc];
}

export function TurnControls({
  busy,
  pacingHint,
  onEndTurn,
}: {
  busy: boolean;
  /** If set, AI suggested this many days to advance. Used when "AI" is selected. */
  pacingHint: number | null;
  onEndTurn: (days: number) => void;
}) {
  // Default to AI-paced advance: the LLM's last `next_tick_days`
  // suggestion drives how far the clock moves. Players can still pick
  // a fixed length via the chip strip.
  const [inc, setInc] = useState<TimeIncrement>("ai");

  const handle = () => {
    const aiFallback = pacingHint ?? 7;
    onEndTurn(incrementToDays(inc, aiFallback));
  };

  return (
    <div style={wrapStyle}>
      <div style={pickerStyle}>
        {(["1w", "1m", "3m", "6m", "1y", "ai"] as TimeIncrement[]).map((k) => (
          <button
            key={k}
            onClick={() => setInc(k)}
            style={{
              ...chipStyle,
              ...(inc === k ? chipActiveStyle : {}),
            }}
            disabled={busy}
            title={
              k === "ai"
                ? `AI-paced (${pacingHint ?? "no suggestion yet, will use 1w"})`
                : `Advance ${INCREMENT_DAYS[k]} days`
            }
          >
            {k === "ai" ? "AI" : k}
          </button>
        ))}
      </div>
      <button
        onClick={handle}
        disabled={busy}
        style={endTurnStyle}
        title="Advance the clock and persist a snapshot"
      >
        {busy ? "…" : "End turn ▸"}
      </button>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const pickerStyle: React.CSSProperties = {
  display: "flex",
  gap: 3,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 2,
};

const chipStyle: React.CSSProperties = {
  padding: "5px 11px",
  background: "transparent",
  color: "var(--fg-muted)",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
  fontWeight: 550,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const chipActiveStyle: React.CSSProperties = {
  background: "var(--surface-3)",
  color: "var(--fg)",
};

const endTurnStyle: React.CSSProperties = {
  padding: "7px 16px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 700,
  letterSpacing: "-0.005em",
};
