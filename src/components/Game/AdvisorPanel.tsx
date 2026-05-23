import { useState } from "react";
import type { World } from "../../lib/game/types";
import {
  requestAdvisor,
  requestProduction,
  validateAction,
  type AdvisorSuggestion,
} from "../../lib/game/tauri";
import { SendIcon } from "../ui/Icon";

const PRODUCTION_KEYWORDS = [
  "build", "recruit", "mobilize", "raise", "produce", "manufacture",
  "construct", "assemble", "deploy", "train", "muster", "conscript", "draft",
];
function routeToProduction(text: string): boolean {
  const t = text.toLowerCase();
  return PRODUCTION_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`).test(t));
}

/**
 * Advisor — proactive LLM suggestions tied to the player's goals + world
 * state. Each suggestion has a ready-to-fire `order` string; clicking
 * "Enact" sends it through the same intent router as the Orders tab so the
 * world updates immediately.
 */
export function AdvisorPanel({
  world,
  providerId,
  model,
  onWorldUpdate,
}: {
  world: World;
  providerId: string;
  model: string;
  onWorldUpdate: (world: World) => void;
}) {
  const [suggestions, setSuggestions] = useState<AdvisorSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enacting, setEnacting] = useState<number | null>(null);
  const [enacted, setEnacted] = useState<Map<number, string>>(new Map());

  const playerNation = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  const refresh = async () => {
    if (!providerId || !model) {
      setError("Pick a provider + model first (Orders tab has the selector).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await requestAdvisor(providerId, model, world);
      setSuggestions(r.suggestions);
      setEnacted(new Map());
      if (r.suggestions.length === 0) {
        setError(
          "Advisor returned no suggestions. Try again or check the model is reasoning-capable.",
        );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const enact = async (idx: number, s: AdvisorSuggestion) => {
    if (!providerId || !model) return;
    setEnacting(idx);
    setError(null);
    try {
      let summary: string;
      if (routeToProduction(s.order)) {
        const r = await requestProduction(providerId, model, world, s.order);
        if (r.accepted) onWorldUpdate(r.world);
        summary = r.accepted
          ? `Built ${r.outcome.spawned.length} units · ${r.narrative.slice(0, 140)}`
          : `Production rejected: ${r.narrative.slice(0, 140)}`;
      } else {
        const r = await validateAction(providerId, model, world, s.order);
        if (r.accepted) onWorldUpdate(r.world);
        summary = r.accepted
          ? `Accepted · ${r.narrative.slice(0, 140)}`
          : `Rejected: ${r.narrative.slice(0, 140)}`;
      }
      setEnacted((m) => new Map(m).set(idx, summary));
    } catch (e) {
      setError(String(e));
    } finally {
      setEnacting(null);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={headerRow}>
        <div>
          <div style={titleStyle}>
            {playerNation ? `Advisor — ${playerNation.name}` : "Advisor"}
          </div>
          <div style={subtitleStyle}>
            Council proposes 3–5 moves you can enact in one click.
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading || !providerId || !model}
          style={refreshStyle}
          className="ahd-press"
        >
          {loading ? "Consulting…" : suggestions ? "Reconsult" : "Consult"}
        </button>
      </div>

      {error && <div style={errStyle}>{error}</div>}

      {!suggestions && !loading && !error && (
        <div style={emptyStyle}>
          Press <strong>Consult</strong> to ask your advisory council for
          recommendations based on your current goals and the state of the world.
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div style={listStyle}>
          {suggestions.map((s, i) => (
            <SuggestionCard
              key={i}
              suggestion={s}
              busy={enacting !== null}
              enacting={enacting === i}
              enactedSummary={enacted.get(i)}
              onEnact={() => enact(i, s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  busy,
  enacting,
  enactedSummary,
  onEnact,
}: {
  suggestion: AdvisorSuggestion;
  busy: boolean;
  enacting: boolean;
  enactedSummary?: string;
  onEnact: () => void;
}) {
  const pr = (suggestion.priority ?? "medium").toLowerCase();
  const priColor =
    pr === "high"
      ? "#e07a5f"
      : pr === "low"
      ? "var(--fg-dim)"
      : "var(--accent)";
  const isEnacted = enactedSummary !== undefined;
  return (
    <div
      style={{
        ...cardStyle,
        borderColor: isEnacted
          ? "rgba(122,162,247,0.5)"
          : "var(--border)",
      }}
    >
      <div style={cardHeaderRow}>
        <span style={{ ...priorityChipStyle, background: priColor }}>
          {pr.toUpperCase()}
        </span>
        <div style={cardLabelStyle}>{suggestion.label}</div>
      </div>
      <div style={rationaleStyle}>{suggestion.rationale}</div>
      <div style={orderQuoteStyle}>“{suggestion.order}”</div>
      {isEnacted ? (
        <div style={enactedRowStyle}>{enactedSummary}</div>
      ) : (
        <button
          onClick={onEnact}
          disabled={busy}
          style={enactBtnStyle}
          className="ahd-press"
        >
          <SendIcon /> {enacting ? "Enacting…" : "Enact"}
        </button>
      )}
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

const refreshStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 700,
};

const errStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
};

const emptyStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-sm)",
  background: "var(--surface-1)",
  border: "1px dashed var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 14,
  lineHeight: 1.5,
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
  border: "1px solid",
  borderRadius: "var(--radius-md)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const cardHeaderRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const priorityChipStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  color: "#0c1322",
  fontWeight: 800,
  fontSize: 10,
  letterSpacing: "0.08em",
};

const cardLabelStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "var(--fs-md)",
  letterSpacing: "-0.005em",
};

const rationaleStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.5,
};

const orderQuoteStyle: React.CSSProperties = {
  color: "var(--fg)",
  fontSize: "var(--fs-sm)",
  fontStyle: "italic",
  borderLeft: "2px solid var(--accent)",
  paddingLeft: 8,
  marginTop: 2,
};

const enactBtnStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px",
  background: "var(--surface-2)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginTop: 4,
};

const enactedRowStyle: React.CSSProperties = {
  background: "rgba(122,162,247,0.08)",
  border: "1px solid rgba(122,162,247,0.25)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 8px",
  color: "var(--fg)",
  fontSize: "var(--fs-xs)",
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
};
