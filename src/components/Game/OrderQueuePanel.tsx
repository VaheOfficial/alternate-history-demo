import { useState } from "react";
import type { World } from "../../lib/game/types";
import {
  requestProduction,
  validateAction,
  type PriorExchange,
  type ProductionResult,
  type ValidatorResult,
} from "../../lib/game/tauri";
import { SendIcon } from "../ui/Icon";

/**
 * Unified order entry: one text box, type any kind of order (diplomatic,
 * military, production). Each order opens a THREAD — if the engine rejects
 * it (or even when accepted), the player can reply to refine the request
 * ("OK we can't do 10 — do as many per turn until we hit 10"). Replies see
 * the previous exchanges as conversation context so the LLM can adjust.
 */

interface ThreadTurn {
  /** What the player said. */
  player: string;
  /** Result returned for that message. */
  result:
    | { kind: "diplomatic"; result: ValidatorResult }
    | { kind: "production"; result: ProductionResult }
    | { kind: "error"; error: string };
}

interface Thread {
  /** First message of the thread — keeps the thread identifiable. */
  opener: string;
  /** All exchanges in order; the first one's player text equals opener. */
  turns: ThreadTurn[];
  /** Each thread sticks to its first routing decision so replies stay in lane. */
  routing: "diplomatic" | "production";
}

const PRODUCTION_KEYWORDS = [
  "build", "recruit", "mobilize", "raise", "produce", "manufacture",
  "construct", "assemble", "deploy", "train", "muster", "conscript", "draft",
];
function routeToProduction(text: string): boolean {
  const t = text.toLowerCase();
  return PRODUCTION_KEYWORDS.some((kw) =>
    new RegExp(`\\b${kw}\\b`).test(t),
  );
}

/**
 * Extract the assistant's reply text from a turn for replay to the LLM.
 * We send back exactly what came in `narrative` since that's the in-world
 * voice the LLM emits, regardless of accept/reject.
 */
function priorFromThread(thread: Thread): PriorExchange[] {
  const out: PriorExchange[] = [];
  for (const t of thread.turns) {
    let assistant = "(no response)";
    if (t.result.kind === "diplomatic") {
      assistant = t.result.result.raw_response || t.result.result.narrative;
    } else if (t.result.kind === "production") {
      assistant = t.result.result.raw_response || t.result.result.narrative;
    } else if (t.result.kind === "error") {
      assistant = `(error: ${t.result.error})`;
    }
    out.push({ player: t.player, assistant });
  }
  return out;
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
  const [threads, setThreads] = useState<Thread[]>([]);

  const noProvider = providers.length === 0;
  const playerNation = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  const sendNewOrder = async () => {
    if (!providerId || !model || !text.trim()) return;
    setBusy(true);
    setError(null);
    const orderText = text.trim();
    const routing: "diplomatic" | "production" = routeToProduction(orderText)
      ? "production"
      : "diplomatic";
    const turn: ThreadTurn = await runTurn(orderText, routing, []);
    if (turn.result.kind !== "error") {
      const r =
        turn.result.kind === "production"
          ? turn.result.result
          : turn.result.result;
      if ("accepted" in r && r.accepted) onWorldUpdate(r.world);
    }
    setThreads((ts) => [{ opener: orderText, turns: [turn], routing }, ...ts]);
    setText("");
    setBusy(false);
  };

  const sendReply = async (threadIdx: number, replyText: string) => {
    const thread = threads[threadIdx];
    if (!thread || !replyText.trim()) return;
    setBusy(true);
    setError(null);
    const prior = priorFromThread(thread);
    const turn: ThreadTurn = await runTurn(replyText.trim(), thread.routing, prior);
    if (turn.result.kind !== "error") {
      const r =
        turn.result.kind === "production"
          ? turn.result.result
          : turn.result.result;
      if ("accepted" in r && r.accepted) onWorldUpdate(r.world);
    }
    setThreads((ts) =>
      ts.map((t, i) =>
        i === threadIdx ? { ...t, turns: [...t.turns, turn] } : t,
      ),
    );
    setBusy(false);
  };

  const runTurn = async (
    playerText: string,
    routing: "diplomatic" | "production",
    prior: PriorExchange[],
  ): Promise<ThreadTurn> => {
    try {
      if (routing === "production") {
        const r = await requestProduction(providerId, model, world, playerText, prior);
        return { player: playerText, result: { kind: "production", result: r } };
      } else {
        const r = await validateAction(
          providerId,
          model,
          world,
          playerText,
          undefined,
          prior,
        );
        return { player: playerText, result: { kind: "diplomatic", result: r } };
      }
    } catch (e) {
      const msg = String(e);
      setError(msg);
      return { player: playerText, result: { kind: "error", error: msg } };
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void sendNewOrder();
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
              Speak in first person. Reply inside a thread to refine a rejected
              order. ⌘/Ctrl+Enter to send.
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
          onClick={() => void sendNewOrder()}
          disabled={busy || noProvider || !model || !text.trim()}
          style={sendStyle}
          className="ahd-press"
          title="Send (Ctrl/⌘+Enter)"
        >
          <SendIcon /> {busy ? "…" : "Send"}
        </button>
      </div>

      {error && <div style={errStyle}>{error}</div>}

      {threads.length > 0 && (
        <>
          <div style={queueHeaderStyle}>
            This turn ({threads.length} thread{threads.length === 1 ? "" : "s"})
          </div>
          <div style={queueStyle}>
            {threads.map((thread, i) => (
              <ThreadCard
                key={i}
                thread={thread}
                busy={busy}
                onReply={(reply) => void sendReply(i, reply)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ThreadCard({
  thread,
  busy,
  onReply,
}: {
  thread: Thread;
  busy: boolean;
  onReply: (reply: string) => void;
}) {
  const [replyText, setReplyText] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const lastTurn = thread.turns[thread.turns.length - 1];
  const lastAccepted =
    lastTurn.result.kind === "diplomatic"
      ? lastTurn.result.result.accepted
      : lastTurn.result.kind === "production"
      ? lastTurn.result.result.accepted
      : false;

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (replyText.trim()) {
        onReply(replyText.trim());
        setReplyText("");
      }
    }
  };

  return (
    <div
      style={{
        ...threadCardStyle,
        borderColor: lastAccepted
          ? "rgba(122,162,247,0.5)"
          : "var(--border)",
      }}
    >
      <div style={threadHeaderStyle}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={collapseBtn}
          aria-label={collapsed ? "Expand thread" : "Collapse thread"}
        >
          {collapsed ? "▶" : "▼"}
        </button>
        <div style={threadTitleStyle}>
          <span style={threadCountChip}>
            {thread.turns.length} msg{thread.turns.length === 1 ? "" : "s"}
          </span>
          <span style={threadOpenerStyle}>{thread.opener}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          <div style={turnsStyle}>
            {thread.turns.map((t, idx) => (
              <TurnRow key={idx} turn={t} />
            ))}
          </div>
          <div style={replyRowStyle}>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKey}
              placeholder={
                lastAccepted
                  ? "Refine or follow up on this thread…"
                  : "Reply (e.g. \"how many CAN we build per turn — schedule until 10?\")"
              }
              style={replyTextareaStyle}
              rows={2}
              disabled={busy}
            />
            <button
              onClick={() => {
                if (replyText.trim()) {
                  onReply(replyText.trim());
                  setReplyText("");
                }
              }}
              disabled={busy || !replyText.trim()}
              style={replyBtnStyle}
              className="ahd-press"
            >
              <SendIcon />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TurnRow({ turn }: { turn: ThreadTurn }) {
  return (
    <div style={turnRowStyle}>
      <div style={playerLineStyle}>
        <span style={youChip}>You</span>
        <span>{turn.player}</span>
      </div>
      <div style={assistantLineStyle}>
        {turn.result.kind === "error" ? (
          <div style={{ color: "var(--danger)", fontSize: "var(--fs-xs)" }}>
            FAILED — {turn.result.error}
          </div>
        ) : (
          <ResultBody
            kind={turn.result.kind}
            result={
              turn.result.kind === "production"
                ? turn.result.result
                : turn.result.result
            }
          />
        )}
      </div>
    </div>
  );
}

function ResultBody({
  kind,
  result,
}: {
  kind: "diplomatic" | "production";
  result: ValidatorResult | ProductionResult;
}) {
  const accepted = result.accepted;
  return (
    <div>
      <div style={cardMetaStyle}>
        <span
          style={{
            color: accepted ? "var(--accent)" : "var(--fg-muted)",
            fontWeight: 700,
            letterSpacing: "0.08em",
          }}
        >
          {kind === "production"
            ? accepted
              ? "PRODUCTION ACCEPTED"
              : "PRODUCTION REJECTED"
            : accepted
            ? "ACCEPTED"
            : "REJECTED"}
        </span>
        {kind === "production" && (result as ProductionResult).outcome.spawned.length > 0 && (
          <span style={{ marginLeft: 8, color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>
            · {(result as ProductionResult).outcome.spawned.length} units built
          </span>
        )}
        {kind === "diplomatic" && (result as ValidatorResult).applied.length > 0 && (
          <span style={{ marginLeft: 8, color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>
            · {(result as ValidatorResult).applied.length} action
            {(result as ValidatorResult).applied.length === 1 ? "" : "s"} applied
          </span>
        )}
        {kind === "diplomatic" && (result as ValidatorResult).failures.length > 0 && (
          <span
            style={{
              marginLeft: 8,
              color: "var(--danger)",
              fontSize: "var(--fs-xs)",
              fontWeight: 700,
            }}
          >
            · {(result as ValidatorResult).failures.length} failed
          </span>
        )}
      </div>
      <div style={cardNarrativeStyle}>{result.narrative}</div>
      {kind === "diplomatic" &&
        (result as ValidatorResult).failures.length > 0 && (
          <details style={failuresStyle}>
            <summary style={failuresSummaryStyle}>
              {(result as ValidatorResult).failures.length} action
              {(result as ValidatorResult).failures.length === 1 ? "" : "s"}{" "}
              the engine could not apply
            </summary>
            <ul style={failuresListStyle}>
              {(result as ValidatorResult).failures.map((f, i) => (
                <li key={i}>{f.reason}</li>
              ))}
            </ul>
          </details>
        )}
    </div>
  );
}

const failuresStyle: React.CSSProperties = {
  marginTop: 6,
  background: "rgba(220, 80, 80, 0.06)",
  border: "1px solid rgba(220, 80, 80, 0.25)",
  borderRadius: "var(--radius-sm)",
  padding: "4px 8px",
};

const failuresSummaryStyle: React.CSSProperties = {
  cursor: "pointer",
  fontSize: "var(--fs-xs)",
  color: "var(--danger)",
  fontWeight: 600,
};

const failuresListStyle: React.CSSProperties = {
  margin: "6px 0 0",
  paddingLeft: 18,
  color: "var(--fg-muted)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
  lineHeight: 1.5,
};

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
  gap: 10,
  flex: 1,
  overflowY: "auto",
  paddingRight: 6,
};

const threadCardStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid",
  borderRadius: "var(--radius-md)",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const threadHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
};

const collapseBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: "var(--fs-xs)",
  padding: 0,
  width: 16,
};

const threadTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flex: 1,
  minWidth: 0,
};

const threadCountChip: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--fg-dim)",
  letterSpacing: "0.08em",
  padding: "2px 6px",
  background: "var(--surface-2)",
  borderRadius: 999,
};

const threadOpenerStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: "var(--fs-sm)",
  fontStyle: "italic",
  color: "var(--fg)",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  overflow: "hidden",
  minWidth: 0,
  flex: 1,
};

const turnsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "10px",
};

const turnRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const playerLineStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  fontSize: "var(--fs-sm)",
  color: "var(--fg)",
  fontStyle: "italic",
};

const youChip: React.CSSProperties = {
  flex: "0 0 auto",
  padding: "2px 8px",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 999,
  color: "var(--fg-muted)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  fontStyle: "normal",
  height: "fit-content",
};

const assistantLineStyle: React.CSSProperties = {
  paddingLeft: 12,
  borderLeft: "2px solid var(--accent)",
};

const cardMetaStyle: React.CSSProperties = {
  fontSize: 10,
  marginBottom: 4,
};

const cardNarrativeStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--fg-muted)",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

const replyRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  padding: "8px 10px 10px",
  borderTop: "1px solid var(--border)",
  background: "var(--surface-2)",
};

const replyTextareaStyle: React.CSSProperties = {
  flex: 1,
  boxSizing: "border-box",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--fs-sm)",
  background: "var(--surface-1)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 8,
  resize: "vertical",
  lineHeight: 1.4,
};

const replyBtnStyle: React.CSSProperties = {
  padding: "0 12px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
};
