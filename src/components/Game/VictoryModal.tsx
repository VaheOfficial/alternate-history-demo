import { useEffect } from "react";
import type { Victory } from "../../lib/game/types";
import { CrownIcon } from "../ui/Icon";

/**
 * Victory / run-ended modal (Plan 12 Phase 6). Shown when
 * `world.victory` is set. Headline + summary come from the engine.
 *
 * Escape closes (so the player can keep looking at the world map
 * post-game). Backdrop click does NOT close — same rule as the
 * turn-summary modal — so a stray click doesn't dismiss it.
 */
export function VictoryModal({
  victory,
  onClose,
}: {
  victory: Victory;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const accent = ACCENT_BY_KIND[victory.kind];

  return (
    <div style={backdropStyle} className="ahd-motion-fade-in">
      <div style={modalStyle} className="ahd-motion-fade-up">
        <div style={iconStyle}>
          <CrownIcon size="3em" />
        </div>
        <div
          style={{
            ...kindTagStyle,
            background: accent.bg,
            color: accent.fg,
          }}
        >
          {KIND_LABEL[victory.kind]}
        </div>
        <h2 style={headlineStyle}>{victory.headline}</h2>
        <div style={dateStyle}>{victory.triggered_on}</div>
        <div style={summaryStyle}>{victory.summary}</div>
        <div style={hintStyle}>
          Press Esc to dismiss and continue exploring the final world state.
          The chronicle generator lands in a later plan.
        </div>
        <button onClick={onClose} style={closeStyle} className="ahd-press">
          Dismiss
        </button>
      </div>
    </div>
  );
}

const ACCENT_BY_KIND: Record<
  Victory["kind"],
  { bg: string; fg: string }
> = {
  hegemon: { bg: "#7aa2f7", fg: "#0c1322" },
  universal_empire: { bg: "#f5d76e", fg: "#0c1322" },
  survivor: { bg: "#9aae8a", fg: "#0c1322" },
  concluded: { bg: "var(--surface-3)", fg: "var(--fg-muted)" },
};

const KIND_LABEL: Record<Victory["kind"], string> = {
  hegemon: "GLOBAL HEGEMON",
  universal_empire: "UNIVERSAL EMPIRE",
  survivor: "ENDURED TO 2050",
  concluded: "RUN CONCLUDED",
};

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 4, 8, 0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
};

const modalStyle: React.CSSProperties = {
  width: "min(560px, 92vw)",
  background:
    "linear-gradient(180deg, rgba(20, 23, 30, 0.98), rgba(15, 17, 21, 0.98))",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-lg)",
  padding: "32px 32px 26px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 12,
  boxShadow: "0 24px 64px rgba(0, 0, 0, 0.6)",
};

const iconStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 80,
  height: 80,
  borderRadius: 999,
  background: "rgba(245, 215, 110, 0.12)",
  border: "1px solid rgba(245, 215, 110, 0.45)",
  color: "#f5d76e",
  marginBottom: 6,
};

const kindTagStyle: React.CSSProperties = {
  padding: "4px 12px",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.12em",
};

const headlineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--fs-xl)",
  fontWeight: 800,
  letterSpacing: "-0.015em",
};

const dateStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-sm)",
};

const summaryStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.55,
  maxWidth: 420,
  marginTop: 8,
};

const hintStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
  marginTop: 4,
  maxWidth: 420,
  fontStyle: "italic",
};

const closeStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 18px",
  background: "var(--surface-3)",
  color: "var(--fg)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
};
