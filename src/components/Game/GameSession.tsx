import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorldMap, type ProvinceHoverInfo } from "../Map/WorldMap";
import { buildOwnershipColors, findProvinceByShape } from "../../lib/game/colors";
import type { Nation, World } from "../../lib/game/types";
import {
  endTurn,
  runNpcTurn,
  type NationTurn,
  type NpcTurnResult,
  type OrchestratorPick,
  type ValidatorResult,
} from "../../lib/game/tauri";
import { listProviderConfigs, listModels } from "../../lib/tauri";
import type { ProviderConfig } from "../../lib/types";
import { CountryDrawer } from "./CountryDrawer";
import { ProvinceTooltip } from "./ProvinceTooltip";
import { TurnControls } from "./TurnControls";
import { ActionPanel } from "./ActionPanel";
import { SavesDrawer } from "./SavesDrawer";
import { TurnSummaryModal, type EconomyDelta } from "./TurnSummaryModal";
import { colorForMapcolor } from "../../lib/map/renderer";

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

  // Provider/model owned at the session level so both the player ActionPanel
  // AND the End-Turn NPC turn flow share one selection.
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const lastSummaryRef = useRef<{
    picks: OrchestratorPick[];
    nation_turns: NationTurn[];
    new_date: string;
    days: number;
    economy_delta: EconomyDelta | null;
    npc_error: string | null;
  } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    listProviderConfigs().then((ps) => {
      setProviders(ps);
      if (ps.length > 0) setProviderId((cur) => (cur ? cur : ps[0].id));
    });
  }, []);

  useEffect(() => {
    if (!providerId) {
      setModel("");
      return;
    }
    listModels(providerId)
      .then((m) => {
        if (m.length === 0) {
          setModel("");
          return;
        }
        setModel((cur) => {
          if (cur && m.some((mm) => mm.id === cur)) return cur;
          return m[0].id;
        });
      })
      .catch(() => setModel(""));
  }, [providerId]);

  const ownershipColors = useMemo(
    () => buildOwnershipColors(world, { selectedShape }),
    [world, selectedShape],
  );

  const playerIso = useMemo(() => {
    if (!world.player_nation) return null;
    return (
      world.nations.find((n) => n.id === world.player_nation)?.iso_a3 ?? null
    );
  }, [world.player_nation, world.nations]);

  const selectedIso = useMemo(() => {
    if (!selectedNation) return null;
    return world.nations.find((n) => n.id === selectedNation)?.iso_a3 ?? null;
  }, [selectedNation, world.nations]);

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

  const computeEconomyDelta = useCallback(
    (before: World, after: World): EconomyDelta | null => {
      if (!before.player_nation) return null;
      const a = before.nations.find((n) => n.id === before.player_nation);
      const b = after.nations.find((n) => n.id === before.player_nation);
      if (!a || !b) return null;
      return {
        treasury: b.treasury - a.treasury,
        manpower: b.manpower_pool - a.manpower_pool,
        stability: b.stability - a.stability,
        war_support: b.war_support - a.war_support,
      };
    },
    [],
  );

  const handleEndTurn = async (days: number) => {
    setBusy(true);
    setTurnError(null);
    const before = world;
    try {
      // Step 1: deterministic clock + economy.
      const afterEconomy = await endTurn(before, days);
      const delta = computeEconomyDelta(before, afterEconomy);

      // Step 2: NPC turn (LLM-orchestrated). Best-effort; if it fails we still
      // surface the economy delta.
      let npc: NpcTurnResult | null = null;
      let npcError: string | null = null;
      if (providerId && model) {
        try {
          npc = await runNpcTurn(providerId, model, afterEconomy, days);
        } catch (e) {
          npcError = String(e);
        }
      } else {
        npcError = "No LLM provider configured — NPC turn skipped.";
      }

      const finalWorld = npc?.world ?? afterEconomy;
      setWorld(finalWorld);
      setPacingHint(null);

      lastSummaryRef.current = {
        picks: npc?.orchestrator_picks ?? [],
        nation_turns: npc?.nation_turns ?? [],
        new_date: finalWorld.clock.current_date,
        days,
        economy_delta: delta,
        npc_error: npcError,
      };
      setSummaryOpen(true);
    } catch (e) {
      setTurnError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleValidatorResult = (r: ValidatorResult) => {
    if (r.accepted) setWorld(r.world);
    if (r.next_tick_days != null) setPacingHint(r.next_tick_days);
  };

  const playerNation = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  const nationsByIso = useMemo(() => {
    const m = new Map<string, Nation>();
    for (const n of world.nations) m.set(n.iso_a3, n);
    return m;
  }, [world.nations]);

  return (
    <div style={containerStyle}>
      <TopBar
        date={world.clock.current_date}
        round={world.clock.round}
        nationCount={world.nations.length}
        provinceCount={world.provinces.length}
        playerNation={playerNation}
        busy={busy}
        pacingHint={pacingHint}
        onEndTurn={handleEndTurn}
        onExit={onExit}
        onShowSaves={() => setShowSaves(true)}
        onOpenPlayerPanel={() => {
          if (playerNation) setSelectedNation(playerNation.id);
        }}
        error={turnError}
      />
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <WorldMap
          ownershipColors={ownershipColors}
          playerIso={playerIso}
          selectedIso={selectedIso}
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
        <ActionPanel
          world={world}
          providers={providers}
          providerId={providerId}
          model={model}
          onProviderChange={setProviderId}
          onModelChange={setModel}
          onResult={handleValidatorResult}
        />
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
        {summaryOpen && lastSummaryRef.current && (
          <TurnSummaryModal
            playerNation={playerNation}
            economyDelta={lastSummaryRef.current.economy_delta}
            picks={lastSummaryRef.current.picks}
            nationTurns={lastSummaryRef.current.nation_turns}
            newDate={lastSummaryRef.current.new_date}
            daysElapsed={lastSummaryRef.current.days}
            worldByIso={nationsByIso}
            npcError={lastSummaryRef.current.npc_error}
            onClose={() => setSummaryOpen(false)}
            onFocusNation={(nationId) => {
              setSelectedNation(nationId);
              setSummaryOpen(false);
            }}
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
  playerNation,
  busy,
  pacingHint,
  onEndTurn,
  onExit,
  onShowSaves,
  onOpenPlayerPanel,
  error,
}: {
  date: string;
  round: number;
  nationCount: number;
  provinceCount: number;
  playerNation: import("../../lib/game/types").Nation | null;
  busy: boolean;
  pacingHint: number | null;
  onEndTurn: (days: number) => void;
  onExit: () => void;
  onShowSaves: () => void;
  onOpenPlayerPanel: () => void;
  error: string | null;
}) {
  return (
    <div style={topBarStyle}>
      <button onClick={onExit} style={exitButtonStyle}>
        ← Menu
      </button>
      {playerNation && (
        <button onClick={onOpenPlayerPanel} style={playerBadgeStyle} title="Open your country panel">
          <span
            style={{
              width: 12,
              height: 12,
              background: colorForMapcolor(playerNation.map_color),
              borderRadius: 2,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.18)",
            }}
          />
          <span>{playerNation.name}</span>
        </button>
      )}
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

const playerBadgeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  background: "var(--surface-2)",
  color: "var(--fg)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  letterSpacing: "-0.005em",
};
