import { useEffect, useState } from "react";
import { listProviderConfigs, listModels } from "../../lib/tauri";
import type { ProviderConfig, ModelInfo } from "../../lib/types";
import { validateAction, type ValidatorResult } from "../../lib/game/tauri";
import type { World } from "../../lib/game/types";

export function ActionPanel({
  world,
  onResult,
}: {
  world: World;
  onResult: (r: ValidatorResult) => void;
}) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<string>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ValidatorResult | null>(null);

  useEffect(() => {
    listProviderConfigs().then((ps) => {
      setProviders(ps);
      if (ps.length && !providerId) setProviderId(ps[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!providerId) {
      setModels([]);
      setModel("");
      return;
    }
    listModels(providerId)
      .then((m) => {
        setModels(m);
        if (m.length) setModel(m[0].id);
      })
      .catch(() => {
        setModels([]);
        setModel("");
      });
  }, [providerId]);

  const handleSend = async () => {
    if (!providerId || !model || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await validateAction(providerId, model, world, text);
      setLastResult(r);
      onResult(r);
      if (r.accepted) setText("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const noProvider = providers.length === 0;
  const playerNation = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  return (
    <div style={panelStyle}>
      <div style={headerRow}>
        <div>
          <div style={headerTitle}>
            {playerNation ? `Orders — ${playerNation.name}` : "Issue an order"}
          </div>
          {playerNation && (
            <div style={subtitleStyle}>
              You are the head of state. Speak in first person.
            </div>
          )}
        </div>
        {!noProvider && (
          <div style={selectorRow}>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className="ahd-select"
              style={miniSelectStyle}
              disabled={busy}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="ahd-select"
              style={miniSelectStyle}
              disabled={busy || models.length === 0}
            >
              {models.length === 0 && <option value="">(no models)</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name ?? m.id}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {noProvider && (
        <div style={hintStyle}>
          No LLM provider configured. Open Settings → add Ollama or another
          provider, then come back.
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          playerNation
            ? `e.g. "Open trade talks with our largest neighbor" or "Quietly build up steel reserves"`
            : `e.g. "Open trade talks between France and Germany"`
        }
        style={textareaStyle}
        rows={3}
        disabled={busy || noProvider}
      />

      <div style={actionRow}>
        <button
          onClick={handleSend}
          disabled={busy || noProvider || !model || !text.trim()}
          style={sendStyle}
        >
          {busy ? "Adjudicating…" : "Submit"}
        </button>
        {error && <div style={errorStyle}>{error}</div>}
      </div>

      {lastResult && (
        <div
          style={{
            ...resultStyle,
            borderColor: lastResult.accepted
              ? "rgba(122,162,247,0.6)"
              : "var(--border)",
          }}
        >
          <div
            style={{
              ...resultHeader,
              color: lastResult.accepted ? "var(--accent)" : "var(--fg-muted)",
            }}
          >
            {lastResult.accepted ? "ACCEPTED" : "REJECTED"}
            {lastResult.next_tick_days != null && (
              <span style={{ color: "var(--fg-dim)", marginLeft: 8 }}>
                · suggested +{lastResult.next_tick_days}d
              </span>
            )}
          </div>
          <div style={narrativeStyle}>{lastResult.narrative}</div>
          {lastResult.applied.length > 0 && (
            <div style={metaStyle}>
              {lastResult.applied.length} action
              {lastResult.applied.length === 1 ? "" : "s"} applied
              {lastResult.failures.length > 0 &&
                ` · ${lastResult.failures.length} failed`}
            </div>
          )}
          {lastResult.failures.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ color: "var(--danger)", cursor: "pointer", fontSize: "var(--fs-xs)" }}>
                Failed actions
              </summary>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: "var(--fs-xs)" }}>
                {lastResult.failures.map((f, i) => (
                  <li key={i}>{f.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 16,
  left: 16,
  width: 420,
  maxWidth: "calc(100vw - 32px)",
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

const selectorRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
};

const miniSelectStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  padding: "4px 6px",
  maxWidth: 140,
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
  border: "1px solid",
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

const metaStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
};
