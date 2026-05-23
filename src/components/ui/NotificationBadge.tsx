import type { CSSProperties, ReactNode } from "react";

/**
 * Notification badge — a small colored dot with optional count, used to
 * surface "you have something to attend to here" on dock tab icons.
 * Three levels:
 *   - "info"   (blue)   — non-blocking information available
 *   - "amber"  (amber)  — optional / payoff available
 *   - "red"    (red)    — required, blocking attention
 *
 * Renders nothing when count is 0 / undefined (the absence of a badge
 * is itself information — that's the discovery design point).
 */
export type BadgeLevel = "info" | "amber" | "red";

export function NotificationBadge({
  count,
  level = "info",
  showZero = false,
  style,
  children,
}: {
  count?: number;
  level?: BadgeLevel;
  showZero?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const n = count ?? 0;
  if (n === 0 && !showZero && !children) return null;
  const bg = LEVEL_BG[level];
  const fg = LEVEL_FG[level];
  return (
    <span
      style={{
        ...badgeStyle,
        background: bg,
        color: fg,
        ...style,
      }}
      aria-label={`${n} notification${n === 1 ? "" : "s"}`}
    >
      {children ?? (n > 9 ? "9+" : String(n))}
    </span>
  );
}

const LEVEL_BG: Record<BadgeLevel, string> = {
  info: "#7aa2f7",
  amber: "#f5d76e",
  red: "#e26d6d",
};

const LEVEL_FG: Record<BadgeLevel, string> = {
  info: "#0c1322",
  amber: "#0c1322",
  red: "#0c1322",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 16,
  height: 16,
  padding: "0 4px",
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.02em",
  lineHeight: 1,
  boxShadow: "0 0 0 1.5px rgba(15,17,21,0.95)",
};
