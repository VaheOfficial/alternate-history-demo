import { useMemo, useState } from "react";
import { WorldMap, type ProvinceHoverInfo } from "../Map/WorldMap";
import { buildOwnershipColors, findProvinceByShape } from "../../lib/game/colors";
import type { World } from "../../lib/game/types";
import { CountryDrawer } from "./CountryDrawer";
import { ProvinceTooltip } from "./ProvinceTooltip";

export function GameSession({
  world,
  onExit,
}: {
  world: World;
  onExit: () => void;
}) {
  const [hover, setHover] = useState<ProvinceHoverInfo | null>(null);
  const [selectedNation, setSelectedNation] = useState<string | null>(null);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);

  const ownershipColors = useMemo(
    () => buildOwnershipColors(world, { selectedShape }),
    [world, selectedShape],
  );

  const hoveredProvince = useMemo(
    () => (hover ? findProvinceByShape(world, hover.shape_id) : null),
    [world, hover],
  );
  const hoveredOwner = useMemo(() => {
    if (!hoveredProvince) return null;
    return world.nations.find((n) => n.id === hoveredProvince.owner) ?? null;
  }, [world, hoveredProvince]);

  const handleClick = (shape_id: string) => {
    const p = findProvinceByShape(world, shape_id);
    if (!p) return;
    setSelectedNation(p.owner);
    setSelectedShape(shape_id);
  };

  const handleCloseDrawer = () => {
    setSelectedNation(null);
    setSelectedShape(null);
  };

  return (
    <div style={containerStyle}>
      <TopBar
        date={world.clock.current_date}
        round={world.clock.round}
        nationCount={world.nations.length}
        provinceCount={world.provinces.length}
        onExit={onExit}
      />
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <WorldMap
          ownershipColors={ownershipColors}
          onProvinceHover={setHover}
          onProvinceClick={handleClick}
        />
        {hover && hoveredProvince && (
          <ProvinceTooltip
            province={hoveredProvince}
            owner={hoveredOwner}
            x={hover.clientX}
            y={hover.clientY}
          />
        )}
        {selectedNation && (
          <CountryDrawer
            world={world}
            nationId={selectedNation}
            onClose={handleCloseDrawer}
          />
        )}
      </div>
    </div>
  );
}

function TopBar({
  date,
  round,
  nationCount,
  provinceCount,
  onExit,
}: {
  date: string;
  round: number;
  nationCount: number;
  provinceCount: number;
  onExit: () => void;
}) {
  return (
    <div style={topBarStyle}>
      <button onClick={onExit} style={exitButtonStyle}>
        ← Menu
      </button>
      <div style={dateBlockStyle}>
        <div style={dateStyle}>{formatDate(date)}</div>
        <div style={roundStyle}>Round {round}</div>
      </div>
      <div style={statsStyle}>
        <Pill label="Nations" value={String(nationCount)} />
        <Pill label="Provinces" value={String(provinceCount)} />
      </div>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        padding: "2px 10px",
      }}
    >
      <div style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>{value}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const containerStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
};

const topBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "10px 20px",
  background: "var(--surface-1)",
  borderBottom: "1px solid var(--border)",
  zIndex: 5,
};

const exitButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 500,
};

const dateBlockStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const dateStyle: React.CSSProperties = {
  fontSize: "var(--fs-lg)",
  fontWeight: 700,
  letterSpacing: "-0.015em",
  lineHeight: 1.1,
};

const roundStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-muted)",
};

const statsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};
