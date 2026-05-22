import { useState } from "react";
import type { World } from "../../lib/game/types";
import {
  requestProduction,
  validateAction,
  type ProductionResult,
  type ValidatorResult,
} from "../../lib/game/tauri";
import { SendIcon } from "../ui/Icon";

/**
 * Unified order entry: one text box, type any kind of order (diplomatic,
 * military, production). Orders are submitted one at a time to the LLM and
 * applied immediately — but the panel maintains a HISTORY of what's been
 * issued this turn so the player sees the running queue of commitments.
 *
 * The LLM intent-routes: if the text looks like a build / recruit / mobilize
 * request, it goes to `request_production_cmd`; otherwise to
 * `validate_action_cmd`. The router is keyword-based on the frontend so we
 * don't burn an extra LLM call just to decide which endpoint to hit.
 */
type QueueEntry =
  | { kind: "diplomatic"; text: string; result: ValidatorResult }
  | { kind: "production"; text: string; result: ProductionResult }
  | { kind: "error"; text: string; error: string };

const PRODUCTION_KEYWORDS = [
  "build",
  "recruit",
  "mobilize",
  "raise",
  "produce",
  "manufacture",
  "construct",
  "assemble",
  "deploy",
  "train",
  "muster",
  "conscript",
  "draft",
];

function routeToProduction(text: string): boolean {
  const t = text.toLowerCase();
  return PRODUCTION_KEYWORDS.some((kw) =>
    new RegExp(`\\b${kw}\\b`).test(t),
  );
}

export function OrderQueuePanel({
  world,
  providers,
  providerId,
  model,
  onProviderChange,
  onModelChange,
  onWorldUpdate,
}: {
  world: World;
  providers: { id: string; name: string }[];
  providerId: string;
  model: string;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
  onWorldUpdate: (world: World) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);

  const noProvider = providers.length === 0;
  const playerNation = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  const send = async () => {
    if (!providerId || !model || !text.trim()) return;
    setBusy(true);
    setError(null);
    const orderText = text.trim();
    try {
      if (routeToProduction(orderText)) {
        const r = await requestProduction(providerId, model, world, orderText);
        if (r.accepted) {
          onWorldUpdate(r.world);
        }
        setQueue((q) => [{ kind: "production", text: orderText, result: r }, ...q]);
      } else {
        const r = await validateAction(providerId, model, world, orderText);
        if (r.accepted) {
          onWorldUpdate(r.world);
        }
        setQueue((q) => [{ kind: "diplomatic", text: orderText, result: r }, ...q]);
      }
      setText("");
    } catch (e) {
      const msg = String(e);
      setError(msg);
      setQueue((q) => [{ kind: "error", text: orderText, error: msg }, ...q]);
    } finally {
      setBusy(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div style={containerStyle}>
      <div style={headerRow}>
        <div>
          <div style={titleStyle}>
            {playerNation ? `Orders — ${playerNation.name}` : "Issue orders"}
          </div>
          {playerNation && (
            <div style={subtitleStyle}>
              Speak in first person. Diplomatic + military intent routed
              automatically. ⌘/Ctrl+Enter to send.
            </div>
          )}
        </div>
        {!noProvider && (
          <div style={selectorRow}>
            <select
              value={providerId}
              onChange={(e) => onProviderChange(e.target.value)}
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
            <input
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="ahd-input"
              style={miniSelectStyle}
              disabled={busy}
              placeholder="model"
            />
          </div>
        )}
      </div>

      {noProvider && (
        <div style={hintStyle}>
          No LLM provider configured. Open Settings to add one.
        </div>
      )}

      <div style={inputRow}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder={
            playerNation
              ? `e.g. "Sign defensive pact with Japan" or "Recruit 5 armored divisions"`
              : `e.g. "Open trade talks between France and Germany"`
          }
          style={textareaStyle}
          rows={2}
          disabled={busy || noProvider}
        />
        <button
          onClick={send}
          disabled={busy || noProvider || !model || !text.trim()}
          style={sendStyle}
          className="ahd-press"
          title="Send (Ctrl/⌘+Enter)"
        >
          <SendIcon /> {busy ? "…" : "Send"}
        </button>
      </div>

      {error && <div style={errStyle}>{error}</div>}

      {queue.length > 0 && (
        <>
          <div style={queueHeaderStyle}>
            This turn ({queue.length} order{queue.length === 1 ? "" : "s"})
          </div>
          <div style={queueStyle}>
            {queue.map((entry, i) => (
              <QueueCard key={i} entry={entry} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function QueueCard({ entry }: { entry: QueueEntry }) {
  if (entry.kind === "error") {
    return (
      <div style={{ ...cardStyle, borderColor: "var(--danger)" }}>
        <div style={cardMetaStyle}>FAILED</div>
        <div style={cardOrderStyle}>{entry.text}</div>
        <div style={{ color: "var(--danger)", fontSize: "var(--fs-xs)", marginTop: 6 }}>
          {entry.error}
        </div>
      </div>
    );
  }
  if (entry.kind === "production") {
    const r = entry.result;
    return (
      <div
        style={{
          ...cardStyle,
          borderColor: r.accepted
            ? "rgba(122,162,247,0.5)"
            : "var(--border)",
        }}
      >
        <div style={{ ...cardMetaStyle, color: r.accepted ? "var(--accent)" : "var(--fg-muted)" }}>
          {r.accepted ? "PRODUCTION" : "PRODUCTION REJECTED"}
          {r.outcome.spawned.length > 0 && (
            <span style={{ marginLeft: 8, color: "var(--fg-dim)" }}>
              · {r.outcome.spawned.length} units built
            </span>
          )}
        </div>
        <div style={cardOrderStyle}>{entry.text}</div>
        <div style={cardNarrativeStyle}>{r.narrative}</div>
      </div>
    );
  }
  // diplomatic
  const r = entry.result;
  return (
    <div
      style={{
        ...cardStyle,
        borderColor: r.accepted ? "rgba(122,162,247,0.5)" : "var(--border)",
      }}
    >
      <div style={{ ...cardMetaStyle, color: r.accepted ? "var(--accent)" : "var(--fg-muted)" }}>
        {r.accepted ? "ACCEPTED" : "REJECTED"}
        {r.applied.length > 0 && (
          <span style={{ marginLeft: 8, color: "var(--fg-dim)" }}>
            · {r.applied.length} action{r.applied.length === 1 ? "" : "s"} applied
          </span>
        )}
      </div>
      <div style={cardOrderStyle}>{entry.text}</div>
      <div style={cardNarrativeStyle}>{r.narrative}</div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  gap: 10,
};

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

const titleStyle: React.CSSProperties = {
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
  maxWidth: 180,
};

const inputRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "stretch",
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
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

const sendStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 700,
  letterSpacing: "-0.005em",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const errStyle: React.CSSProperties = {
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
  lineHeight: 1.5,
};

const queueHeaderStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  fontWeight: 600,
};

const queueStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  flex: 1,
  overflowY: "auto",
  paddingRight: 6,
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid",
  borderRadius: "var(--radius-md)",
  padding: 10,
};

const cardMetaStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  marginBottom: 4,
};

const cardOrderStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  color: "var(--fg)",
  marginBottom: 4,
  fontStyle: "italic",
};

const cardNarrativeStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--fg-muted)",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};
