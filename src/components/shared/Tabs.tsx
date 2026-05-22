import { ReactNode } from "react";

export interface Tab<K extends string> {
  key: K;
  label: string;
}

export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab<K>[];
  active: K;
  onChange: (k: K) => void;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        borderBottom: "1px solid var(--border)",
        padding: "10px 20px 0",
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            background: active === t.key ? "var(--surface-2)" : "transparent",
            color: active === t.key ? "var(--fg)" : "var(--fg-muted)",
            border: "1px solid var(--border)",
            borderBottom:
              active === t.key
                ? "1px solid var(--surface-2)"
                : "1px solid var(--border)",
            padding: "8px 18px",
            cursor: "pointer",
            borderTopLeftRadius: 6,
            borderTopRightRadius: 6,
            marginBottom: -1,
            fontFamily: "inherit",
            fontSize: "var(--fs-sm)",
            fontWeight: active === t.key ? 600 : 500,
            letterSpacing: "-0.005em",
            transition: "color 120ms ease, background 120ms ease",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
