import type { CSSProperties, ReactNode } from "react";

/**
 * Per-screen empty state. The design principle from Plan 12 is that
 * screens teach themselves: a glance at the empty state should tell
 * you what the screen IS and what will live there, without prose
 * instructions. Keep `description` to one sentence.
 *
 * `hint` is optional, intentionally subtle, and shown smaller. Use it
 * sparingly — most screens shouldn't need it.
 */
export function EmptyState({
  icon,
  title,
  description,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div style={containerStyle}>
      <div style={iconWrapStyle}>{icon}</div>
      <div style={titleStyle}>{title}</div>
      <div style={descStyle}>{description}</div>
      {hint && <div style={hintStyle}>{hint}</div>}
      {children && <div style={childrenWrapStyle}>{children}</div>}
    </div>
  );
}

const containerStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "32px 24px",
  gap: 10,
  color: "var(--fg-muted)",
};

const iconWrapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 56,
  height: 56,
  borderRadius: 999,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--fg-muted)",
  fontSize: "1.8em",
  lineHeight: 0,
  marginBottom: 6,
};

const titleStyle: CSSProperties = {
  color: "var(--fg)",
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.005em",
};

const descStyle: CSSProperties = {
  maxWidth: 320,
  fontSize: "var(--fs-sm)",
  lineHeight: 1.55,
};

const hintStyle: CSSProperties = {
  maxWidth: 280,
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  fontStyle: "italic",
};

const childrenWrapStyle: CSSProperties = {
  marginTop: 8,
};
