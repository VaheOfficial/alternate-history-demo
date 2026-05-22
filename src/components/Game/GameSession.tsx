import { useMemo, useState } from "react";
import { WorldMap, type ProvinceHoverInfo } from "../Map/WorldMap";
import { buildOwnershipColors, findProvinceByShape } from "../../lib/game/colors";
import type { World } from "../../lib/game/types";
import { endTurn, type ValidatorResult } from "../../lib/game/tauri";
import { CountryDrawer } from "./CountryDrawer";
import { ProvinceTooltip } from "./ProvinceTooltip";
import { TurnControls } from "./TurnControls";
import { ActionPanel } from "./ActionPanel";
import { SavesDrawer } from "./SavesDrawer";

export function GameSession({
  world: initialWorld,
  onExit,
}: {
  world: World;
  onExit: () => void;
}) {
  const [world, setWorld] = useState<World>(initialWorld);
  const [hover, setHover] = useState<ProvinceHoverInfo | null>(null);
  const [selectedNation, setSelectedNation] = useState<string | null>(null);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pacingHint, setPacingHint] = useState<number | null>(null);
  const [showSaves, setShowSaves] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);

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

  const handleEndTurn = async (days: number) => {
    setBusy(true);
    setTurnError(null);
    try {
      const next = await endTurn(world, days);
      setWorld(next);
      setPacingHint(null);
    } catch (e) {
      setTurnError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleValidatorResult = (r: ValidatorResult) => {
    // The backend already applied any accepted actions + saved a snapshot.
    // Reflect the new world locally and pick up the AI's pacing suggestion.
    if (r.accepted) setWorld(r.world);
    if (r.next_tick_days != null) setPacingHint(r.next_tick_days);
  };

  return (
    <div style={containerStyle}>
      <TopBar
        date={world.clock.current_date}
        round={world.clock.round}
        nationCount={world.nations.length}
        provinceCount={world.provinces.length}
        busy={busy}
        pacingHint={pacingHint}
        onEndTurn={handleEndTurn}
        onExit={onExit}
        onShowSaves={() => setShowSaves(true)}
        error={turnError}
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
        <ActionPanel world={world} onResult={handleValidatorResult} />
        {selectedNation && (
          <CountryDrawer
            world={world}
            nationId={selectedNation}
            onClose={handleCloseDrawer}
          />
        )}
        {showSaves && (
          <SavesDrawer
            world={world}
            onLoaded={(w) => {
              setWorld(w);
              setShowSaves(false);
            }}
            onClose={() => setShowSaves(false)}
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
  busy,
  pacingHint,
  onEndTurn,
  onExit,
  onShowSaves,
  error,
}: {
  date: string;
  round: number;
  nationCount: number;
  provinceCount: number;
  busy: boolean;
  pacingHint: number | null;
  onEndTurn: (days: number) => void;
  onExit: () => void;
  onShowSaves: () => void;
  error: string | null;
}) {
  return (
    <div style={topBarStyle}>
      <button onClick={onExit} style={exitButtonStyle}>
        ← Menu
      </button>
      <div style={dateBlockStyle}>
        <div style={dateStyle}>{formatDate(date)}</div>
        <div style={roundStyle}>
          Round {round}
          {error && <span style={{ color: "var(--danger)", marginLeft: 10 }}>· {error}</span>}
        </div>
      </div>
      <div style={statsStyle}>
        <Pill label="Nations" value={String(nationCount)} />
        <Pill label="Provinces" value={String(provinceCount)} />
      </div>
      <button onClick={onShowSaves} style={exitButtonStyle} title="Saves">
        Saves
      </button>
      <TurnControls busy={busy} pacingHint={pacingHint} onEndTurn={onEndTurn} />
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
