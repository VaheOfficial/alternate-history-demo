import { useMemo } from "react";
import type { World } from "../../lib/game/types";
import { colorForMapcolor } from "../../lib/map/renderer";

export function CountryDrawer({
  world,
  nationId,
  onClose,
}: {
  world: World;
  nationId: string;
  onClose: () => void;
}) {
  const nation = world.nations.find((n) => n.id === nationId);
  const provinces = useMemo(
    () => world.provinces.filter((p) => p.owner === nationId),
    [world, nationId],
  );

  if (!nation) {
    return (
      <Drawer onClose={onClose}>
        <div>Nation not found.</div>
      </Drawer>
    );
  }

  const swatch = colorForMapcolor(nation.map_color);
  const topProvinces = [...provinces]
    .sort((a, b) => b.population - a.population)
    .slice(0, 8);

  // Treaties this nation is a member of.
  const treaties = useMemo(
    () => world.treaties.filter((t) => t.parties.includes(nationId)),
    [world.treaties, nationId],
  );

  return (
    <Drawer onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span
          style={{
            width: 22,
            height: 22,
            background: swatch,
            borderRadius: 3,
            boxShadow: "0 0 0 1px rgba(255,255,255,0.15)",
            flex: "0 0 auto",
          }}
        />
        <div>
          <div
            style={{
              fontSize: "var(--fs-xl)",
              fontWeight: 700,
              letterSpacing: "-0.015em",
              lineHeight: 1.15,
            }}
          >
            {nation.name}
          </div>
          <div style={{ color: "var(--fg-muted)", fontSize: "var(--fs-xs)" }}>
            {nation.iso_a3} · {titleCase(nation.government)}
          </div>
        </div>
      </div>

      <Section title="Economy">
        <Stat label="Treasury" value={`$${fmtBig(nation.treasury)}`} />
        <Stat label="GDP" value={`$${fmtBig(nation.gdp)}`} />
        <Stat label="Industry" value={String(nation.industry_capacity)} />
        <Stat label="Stability" value={`${nation.stability}`} />
      </Section>

      <Section title="Military">
        <Stat label="Manpower" value={fmtBig(nation.manpower_pool)} />
        <Stat label="Population" value={fmtBig(nation.population)} />
        <Stat label="War support" value={`${nation.war_support}`} />
        <Stat label="Doctrine" value={titleCase(nation.doctrine)} />
      </Section>

      {treaties.length > 0 && (
        <Section title={`Treaties & blocs (${treaties.length})`}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", gridColumn: "1 / -1" }}>
            {treaties.map((t) => {
              const label =
                t.terms.extra_clauses[0] ?? titleCase(t.kind);
              return (
                <li
                  key={t.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "4px 0",
                    borderBottom: "1px solid var(--border)",
                    fontSize: "var(--fs-sm)",
                  }}
                >
                  <span>{label}</span>
                  <span style={{ color: "var(--fg-muted)", fontSize: "var(--fs-xs)" }}>
                    {titleCase(t.kind)} · {t.parties.length} members
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title={`Top provinces (${provinces.length} total)`}>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", gridColumn: "1 / -1" }}>
          {topProvinces.map((p) => (
            <li
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                borderBottom: "1px solid var(--border)",
                fontSize: "var(--fs-sm)",
              }}
            >
              <span>{p.name}</span>
              <span style={{ color: "var(--fg-muted)" }}>{fmtBig(p.population)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </Drawer>
  );
}

function Drawer({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div style={drawerStyle}>
      <div style={drawerHeader}>
        <button onClick={onClose} style={closeButtonStyle} aria-label="Close">
          ×
        </button>
      </div>
      <div style={drawerBody}>{children}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          color: "var(--fg-muted)",
          fontSize: "var(--fs-xs)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 14px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>{value}</div>
    </div>
  );
}

const drawerStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  width: 380,
  background: "rgba(15, 17, 21, 0.92)",
  borderLeft: "1px solid var(--border)",
  boxShadow: "-8px 0 24px rgba(0,0,0,0.45)",
  zIndex: 15,
  display: "flex",
  flexDirection: "column",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

const drawerHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  padding: "10px 12px 0",
};

const drawerBody: React.CSSProperties = {
  padding: "8px 16px 16px",
  overflowY: "auto",
  flex: 1,
};

const closeButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--fg-muted)",
  fontSize: 24,
  lineHeight: 1,
  cursor: "pointer",
  padding: "0 6px",
  fontFamily: "inherit",
};

function fmtBig(n: number): string {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v >= 1_000_000_000_000) return `${sign}${(v / 1_000_000_000_000).toFixed(2)}T`;
  if (v >= 1_000_000_000) return `${sign}${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${sign}${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${sign}${(v / 1_000).toFixed(1)}k`;
  return `${sign}${v}`;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
