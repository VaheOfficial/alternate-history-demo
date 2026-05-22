import { useState } from "react";
import { requestProduction, type ProductionResult } from "../../lib/game/tauri";
import type { World } from "../../lib/game/types";

export function ProductionPanel({
  world,
  providerId,
  model,
  noProvider,
  onResult,
}: {
  world: World;
  providerId: string;
  model: string;
  noProvider: boolean;
  onResult: (r: ProductionResult) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ProductionResult | null>(null);

  const playerNation = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  const handleSend = async () => {
    if (!providerId || !model || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await requestProduction(providerId, model, world, text);
      setLast(r);
      onResult(r);
      if (r.accepted) setText("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={panelStyle}>
      <div style={headerRow}>
        <div>
          <div style={headerTitle}>
            {playerNation
              ? `Production — ${playerNation.name}`
              : "Production"}
          </div>
          {playerNation && (
            <div style={subtitleStyle}>
              IC {playerNation.industry_capacity} · ${fmtBig(playerNation.treasury / 1_000_000)}M
              · {fmtBig(playerNation.manpower_pool)} manpower
            </div>
          )}
        </div>
      </div>

      {noProvider && (
        <div style={hintStyle}>
          No LLM provider configured. Settings → add provider.
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='e.g. "Recruit 5 armored divisions and 10 infantry brigades"'
        style={textareaStyle}
        rows={2}
        disabled={busy || noProvider}
      />

      <div style={actionRow}>
        <button
          onClick={handleSend}
          disabled={busy || noProvider || !model || !text.trim()}
          style={sendStyle}
        >
          {busy ? "Planning…" : "Build"}
        </button>
        {error && <div style={errorStyle}>{error}</div>}
      </div>

      {last && (
        <div style={resultStyle}>
          <div
            style={{
              ...resultHeader,
              color: last.accepted ? "var(--accent)" : "var(--fg-muted)",
            }}
          >
            {last.accepted ? "ACCEPTED" : "REJECTED"}
            {last.outcome.spawned.length > 0 && (
              <span style={{ marginLeft: 10, color: "var(--fg-dim)" }}>
                · {last.outcome.spawned.length} unit
                {last.outcome.spawned.length === 1 ? "" : "s"} built
              </span>
            )}
          </div>
          <div style={narrativeStyle}>{last.narrative}</div>
          {last.outcome.denied.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary
                style={{
                  color: "var(--danger)",
                  cursor: "pointer",
                  fontSize: "var(--fs-xs)",
                }}
              >
                {last.outcome.denied.length} request{last.outcome.denied.length === 1 ? "" : "s"} partially fulfilled
              </summary>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: "var(--fs-xs)" }}>
                {last.outcome.denied.map((d, i) => (
                  <li key={i}>
                    {d.unit_type}: {d.granted}/{d.requested} — {d.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function fmtBig(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

const panelStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: 456,
  width: 360,
  maxWidth: "calc(100vw - 480px)",
  background: "rgba(15, 17, 21, 0.92)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 14,
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  zIndex: 12,
};

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 8,
};

const headerTitle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "var(--fs-md)",
  letterSpacing: "-0.01em",
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
  marginTop: 2,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--fs-sm)",
  background: "var(--surface-1)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  resize: "vertical",
  lineHeight: 1.45,
};

const actionRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginTop: 8,
};

const sendStyle: React.CSSProperties = {
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

const errorStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
};

const hintStyle: React.CSSProperties = {
  background: "rgba(255, 200, 60, 0.08)",
  border: "1px solid rgba(255, 200, 60, 0.25)",
  color: "var(--fg-muted)",
  borderRadius: "var(--radius-md)",
  padding: "8px 10px",
  fontSize: "var(--fs-xs)",
  marginBottom: 10,
  lineHeight: 1.5,
};

const resultStyle: React.CSSProperties = {
  marginTop: 10,
  padding: 10,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--surface-1)",
};

const resultHeader: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  fontWeight: 700,
  letterSpacing: "0.08em",
  marginBottom: 6,
};

const narrativeStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  lineHeight: 1.55,
  color: "var(--fg)",
  whiteSpace: "pre-wrap",
};
