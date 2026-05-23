import type { Nation, Province, Unit } from "../../lib/game/types";
import { colorForMapcolor } from "../../lib/map/renderer";

export function ProvinceTooltip({
  province,
  owner,
  unitsHere,
  x,
  y,
}: {
  province: Province;
  owner: Nation | null;
  /** Units stationed in this province. Grouped by owner downstream. */
  unitsHere: Array<{ nation: Nation; units: Unit[] }>;
  x: number;
  y: number;
}) {
  const style: React.CSSProperties = {
    position: "fixed",
    left: x + 16,
    top: y + 16,
    minWidth: 240,
    maxWidth: 340,
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
        <Stat label="Population" value={fmtNum(province.population)} />
        <Stat label="Industry" value={String(province.base_industry)} />
        <Stat label="Supply" value={String(province.supply_value)} />
      </div>

      {unitsHere.length > 0 && (
        <div style={unitsBlockStyle}>
          <div style={subHeaderStyle}>Garrison</div>
          {unitsHere.map(({ nation, units }) => {
            const counts = countByType(units);
            const avgStrength =
              units.reduce((s, u) => s + u.strength, 0) / units.length;
            return (
              <div key={nation.id} style={garrisonRowStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: colorForMapcolor(nation.map_color),
                      borderRadius: 2,
                      boxShadow: "0 0 0 1px rgba(255,255,255,0.15)",
                    }}
                  />
                  <span style={{ fontWeight: 600 }}>{nation.name}</span>
                  <span style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>
                    {units.length} div · avg {Math.round(avgStrength)} str
                  </span>
                </div>
                <div style={typeRowStyle}>
                  {counts.infantry > 0 && <TypeChip label="Inf" count={counts.infantry} />}
                  {counts.mechanized > 0 && <TypeChip label="Mech" count={counts.mechanized} />}
                  {counts.armor > 0 && <TypeChip label="Armor" count={counts.armor} />}
                  {counts.artillery > 0 && <TypeChip label="Art" count={counts.artillery} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function countByType(units: Unit[]) {
  const c = { infantry: 0, mechanized: 0, armor: 0, artillery: 0 };
  for (const u of units) {
    c[u.unit_type] += 1;
  }
  return c;
}

function TypeChip({ label, count }: { label: string; count: number }) {
  return (
    <span style={typeChipStyle}>
      <span style={{ color: "var(--fg-dim)" }}>{label}</span> {count}
    </span>
  );
}

const statGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "6px 12px",
};

const unitsBlockStyle: React.CSSProperties = {
  marginTop: 10,
  paddingTop: 8,
  borderTop: "1px solid var(--border)",
};

const subHeaderStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  marginBottom: 6,
};

const garrisonRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 6,
};

const typeRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};

const typeChipStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  padding: "1px 6px",
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 999,
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
