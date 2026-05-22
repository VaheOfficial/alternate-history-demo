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
        gap: 4,
        borderBottom: "1px solid #333",
        padding: "8px 16px 0",
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            background: active === t.key ? "#2a2a2a" : "transparent",
            color: active === t.key ? "#eee" : "#888",
            border: "1px solid #333",
            borderBottom:
              active === t.key ? "1px solid #2a2a2a" : "1px solid #333",
            padding: "6px 14px",
            cursor: "pointer",
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            marginBottom: -1,
            fontFamily: "inherit",
            fontSize: "0.9rem",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
