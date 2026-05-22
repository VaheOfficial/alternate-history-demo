import { useMemo, useState } from "react";
import type { Nation, World } from "../../lib/game/types";
import { WorldMap } from "../Map/WorldMap";
import { buildOwnershipColors } from "../../lib/game/colors";
import { colorForMapcolor } from "../../lib/map/renderer";

/**
 * Pre-session screen: lets the player pick which nation they'll control.
 * The world map sits behind, fully interactive (pan/zoom/click) — clicking
 * any province selects the owning nation. A searchable nation list lives
 * on the left as the fast-path.
 */
export function CountryPicker({
  world,
  onCancel,
  onConfirm,
}: {
  world: World;
  onCancel: () => void;
  onConfirm: (nationId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Pre-sort by "scale" (industry × pop) so the major powers float to the
  // top of the default list view. Tiebreaker: alphabetical.
  const sortedNations: Nation[] = useMemo(() => {
    return [...world.nations].sort((a, b) => {
      const sa = (a.industry_capacity + 1) * Math.log(a.population + 2);
      const sb = (b.industry_capacity + 1) * Math.log(b.population + 2);
      if (sa !== sb) return sb - sa;
      return a.name.localeCompare(b.name);
    });
  }, [world]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedNations;
    return sortedNations.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.iso_a3.toLowerCase().includes(q),
    );
  }, [sortedNations, search]);

  const picked = pickedId
    ? world.nations.find((n) => n.id === pickedId) ?? null
    : null;
  const pickedShapes = useMemo(() => {
    if (!pickedId) return null;
    const shapes = world.provinces
      .filter((p) => p.owner === pickedId)
      .map((p) => p.geometry_ref);
    return new Set(shapes);
  }, [pickedId, world]);

  // Color map: every country at lower opacity, with the picked country
  // highlighted in warm gold.
  const ownershipColors = useMemo(() => {
    const base = buildOwnershipColors(world);
    if (!pickedShapes) return base;
    const out = new Map<string, string>(base);
    for (const s of pickedShapes) out.set(s, "#f5d76e");
    return out;
  }, [world, pickedShapes]);

  return (
    <div style={pageStyle}>
      <div style={mapStyle}>
        <WorldMap
          ownershipColors={ownershipColors}
          onProvinceHover={undefined}
          onProvinceClick={(shape_id) => {
            const p = world.provinces.find((p) => p.geometry_ref === shape_id);
            if (p) setPickedId(p.owner);
          }}
        />
      </div>

      <div style={leftPanelStyle}>
        <div style={headerStyle}>
          <div style={preTitleStyle}>Choose your nation</div>
          <h1 style={titleStyle}>Where will your story begin?</h1>
          <div style={subtitleStyle}>
            You'll control one country. Click a row, or click any province on
            the map to pick its owner.
          </div>
        </div>

        <input
          autoFocus
          placeholder="Search by name or ISO3 code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ahd-input"
          style={searchStyle}
        />

        <div style={listStyle}>
          {filtered.map((n) => (
            <NationRow
              key={n.id}
              nation={n}
              provinceCount={
                world.provinces.filter((p) => p.owner === n.id).length
              }
              active={n.id === pickedId}
              onClick={() => setPickedId(n.id)}
            />
          ))}
          {filtered.length === 0 && (
            <div style={{ color: "var(--fg-dim)", padding: "12px 4px" }}>
              No nations match “{search}”.
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <button onClick={onCancel} className="ahd-button" style={{ flex: 1 }}>
            ← Back
          </button>
          <button
            disabled={!picked}
            onClick={() => picked && onConfirm(picked.id)}
            style={{
              ...primaryButtonStyle,
              ...(picked ? {} : disabledStyle),
              flex: 2,
            }}
          >
            {picked ? `Begin as ${picked.name}` : "Pick a nation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NationRow({
  nation,
  provinceCount,
  active,
  onClick,
}: {
  nation: Nation;
  provinceCount: number;
  active: boolean;
  onClick: () => void;
}) {
  const swatch = colorForMapcolor(nation.map_color);
  return (
    <button
      onClick={onClick}
      style={{
        ...rowStyle,
        ...(active ? rowActiveStyle : {}),
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          background: swatch,
          borderRadius: 3,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.18)",
          flex: "0 0 auto",
        }}
      />
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "var(--fs-sm)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {nation.name}
        </div>
        <div
          style={{
            color: "var(--fg-dim)",
            fontSize: "var(--fs-xs)",
            display: "flex",
            gap: 8,
          }}
        >
          <span>{nation.iso_a3}</span>
          <span>·</span>
          <span>{titleCase(nation.government)}</span>
          <span>·</span>
          <span>{provinceCount} prov</span>
        </div>
      </div>
    </button>
  );
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const pageStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
};

const mapStyle: React.CSSProperties = {
  flex: 1,
  position: "relative",
};

const leftPanelStyle: React.CSSProperties = {
  width: 400,
  flex: "0 0 400px",
  background: "rgba(15, 17, 21, 0.94)",
  borderRight: "1px solid var(--border)",
  padding: "24px 22px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  boxShadow: "8px 0 24px rgba(0,0,0,0.4)",
  zIndex: 5,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const preTitleStyle: React.CSSProperties = {
  color: "var(--accent)",
  fontSize: "var(--fs-xs)",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  fontWeight: 700,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "1.75rem",
  fontWeight: 800,
  letterSpacing: "-0.025em",
  lineHeight: 1.1,
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.5,
};

const searchStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginRight: -6,
  paddingRight: 6,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  color: "var(--fg)",
  transition: "background 100ms ease, border-color 100ms ease",
};

const rowActiveStyle: React.CSSProperties = {
  background: "var(--surface-3)",
  borderColor: "rgba(122,162,247,0.55)",
  boxShadow: "0 0 0 2px rgba(122,162,247,0.18)",
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  paddingTop: 8,
  borderTop: "1px solid var(--border)",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "11px 18px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.005em",
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.45,
  cursor: "not-allowed",
};
