import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoCentroid } from "d3-geo";
import { WorldMap, type ProvinceHoverInfo } from "../Map/WorldMap";
import { useMapData } from "../Map/useMapData";
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
import { ActionPanel } from "./ActionPanel";
import { ProductionPanel } from "./ProductionPanel";
import { SavesPanel } from "./SavesPanel";
import { HistoryPanel } from "./HistoryPanel";
import { TurnSummaryModal, type EconomyDelta } from "./TurnSummaryModal";
import { CommandDock, type DockTab } from "./CommandDock";
import { HudTopBar } from "./HudTopBar";
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
  const [turnError, setTurnError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DockTab>("orders");
  const [dockCollapsed, setDockCollapsed] = useState(false);

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
        setModel((cur) => (cur && m.some((mm) => mm.id === cur) ? cur : m[0].id));
      })
      .catch(() => setModel(""));
  }, [providerId]);

  const ownershipColors = useMemo(
    () => buildOwnershipColors(world, { selectedShape }),
    [world, selectedShape],
  );

  const playerIso = useMemo(() => {
    if (!world.player_nation) return null;
    return world.nations.find((n) => n.id === world.player_nation)?.iso_a3 ?? null;
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
      const afterEconomy = await endTurn(before, days);
      const delta = computeEconomyDelta(before, afterEconomy);

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

  // Province → geo-centroid lookup for unit placement.
  const mapData = useMapData();
  const provinceCentroids = useMemo(() => {
    const m = new Map<string, [number, number]>();
    if (mapData.status !== "ready") return m;
    for (const f of mapData.data.features) {
      const sid = String((f.properties as { shape_id?: string }).shape_id ?? "");
      if (!sid) continue;
      try {
        const c = geoCentroid(f);
        m.set(sid, c as [number, number]);
      } catch {
        // skip
      }
    }
    return m;
  }, [mapData]);

  const unitStacks = useMemo(() => {
    if (!world.units || world.units.length === 0) return [];
    const byProvince = new Map<
      string,
      {
        ownerColor: string;
        altOwnerColor?: string;
        count: number;
        owners: Set<string>;
      }
    >();
    for (const u of world.units) {
      const province = world.provinces.find((p) => p.id === u.location);
      if (!province) continue;
      const owner = world.nations.find((n) => n.id === u.owner);
      if (!owner) continue;
      const key = province.geometry_ref;
      let bucket = byProvince.get(key);
      if (!bucket) {
        bucket = {
          ownerColor: colorForMapcolor(owner.map_color),
          count: 0,
          owners: new Set(),
        };
        byProvince.set(key, bucket);
      }
      bucket.count += 1;
      bucket.owners.add(u.owner);
      if (bucket.owners.size > 1 && !bucket.altOwnerColor) {
        const otherOwner = world.nations.find(
          (n) => n.id !== owner.id && bucket!.owners.has(n.id),
        );
        if (otherOwner) bucket.altOwnerColor = colorForMapcolor(otherOwner.map_color);
      }
    }
    const stacks: Array<{
      lon: number;
      lat: number;
      ownerColor: string;
      altOwnerColor?: string;
      count: number;
    }> = [];
    for (const [shapeRef, bucket] of byProvince) {
      const centroid = provinceCentroids.get(shapeRef);
      if (!centroid) continue;
      stacks.push({
        lon: centroid[0],
        lat: centroid[1],
        ownerColor: bucket.ownerColor,
        altOwnerColor: bucket.altOwnerColor,
        count: bucket.count,
      });
    }
    return stacks;
  }, [world.units, world.provinces, world.nations, provinceCentroids]);

  const dockPanels = {
    orders: (
      <ActionPanel
        world={world}
        providers={providers}
        providerId={providerId}
        model={model}
        onProviderChange={setProviderId}
        onModelChange={setModel}
        onResult={handleValidatorResult}
      />
    ),
    production: (
      <ProductionPanel
        world={world}
        providerId={providerId}
        model={model}
        noProvider={providers.length === 0}
        onResult={(r) => {
          if (r.accepted) setWorld(r.world);
        }}
      />
    ),
    saves: <SavesPanel world={world} onLoaded={setWorld} />,
    history: <HistoryPanel world={world} />,
  } satisfies Record<DockTab, React.ReactNode>;

  return (
    <div style={containerStyle}>
      <HudTopBar
        date={world.clock.current_date}
        round={world.clock.round}
        playerNation={playerNation}
        busy={busy}
        pacingHint={pacingHint}
        onEndTurn={handleEndTurn}
        onExit={onExit}
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
          unitStacks={unitStacks}
        />
        <div className="ahd-map-vignette" />
        {hover && hoveredProvince && (
          <ProvinceTooltip
            province={hoveredProvince}
            owner={hoveredOwner}
            x={hover.clientX}
            y={hover.clientY}
          />
        )}
        <CommandDock
          active={activeTab}
          onActiveChange={setActiveTab}
          collapsed={dockCollapsed}
          onCollapsedChange={setDockCollapsed}
          panels={dockPanels}
          rightInset={selectedNation ? 380 : 0}
        />
        {selectedNation && (
          <CountryDrawer
            world={world}
            nationId={selectedNation}
            onClose={handleCloseDrawer}
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

const containerStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
};
