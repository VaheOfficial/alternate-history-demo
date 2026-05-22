import type { Nation, Province } from "../../lib/game/types";
import { colorForMapcolor } from "../../lib/map/renderer";

export function ProvinceTooltip({
  province,
  owner,
  x,
  y,
}: {
  province: Province;
  owner: Nation | null;
  x: number;
  y: number;
}) {
  // Place tooltip with a small offset, but keep it on-screen.
  const style: React.CSSProperties = {
    position: "fixed",
    left: x + 16,
    top: y + 16,
    minWidth: 220,
    maxWidth: 320,
    background: "rgba(15, 17, 21, 0.92)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "10px 12px",
    color: "var(--fg)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--fs-sm)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
    pointerEvents: "none",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    zIndex: 20,
  };

  const swatch = owner ? colorForMapcolor(owner.map_color) : "var(--surface-3)";
  return (
    <div style={style}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 700,
          fontSize: "var(--fs-md)",
          marginBottom: 4,
          letterSpacing: "-0.01em",
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            background: swatch,
            borderRadius: 2,
            display: "inline-block",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.18)",
          }}
        />
        {province.name}
      </div>
      <div style={{ color: "var(--fg-muted)", fontSize: "var(--fs-xs)", marginBottom: 8 }}>
        {owner ? owner.name : "Unclaimed"}
      </div>
      <div style={statGrid}>
        <Stat label="Terrain" value={titleCase(province.terrain)} />
        <Stat
          label="Population"
          value={fmtNum(province.population)}
        />
        <Stat label="Industry" value={String(province.base_industry)} />
        <Stat label="Supply" value={String(province.supply_value)} />
      </div>
    </div>
  );
}

const statGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "6px 12px",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>{label}</div>
      <div style={{ fontWeight: 550 }}>{value}</div>
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
