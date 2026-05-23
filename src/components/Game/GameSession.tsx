import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoCentroid } from "d3-geo";
import { WorldMap, type ProvinceHoverInfo } from "../Map/WorldMap";
import { useMapData } from "../Map/useMapData";
import { buildOwnershipColors, findProvinceByShape } from "../../lib/game/colors";
import type { Nation, World } from "../../lib/game/types";
import {
  endTurn,
  moveUnit,
  runNpcTurn,
  type NationTurn,
  type NpcTurnResult,
  type OrchestratorPick,
} from "../../lib/game/tauri";
import { listProviderConfigs, listModels } from "../../lib/tauri";
import type { ProviderConfig } from "../../lib/types";
import { AdvisorPanel } from "./AdvisorPanel";
import { CountryDrawer } from "./CountryDrawer";
import { ProvinceTooltip } from "./ProvinceTooltip";
import { OrderQueuePanel } from "./OrderQueuePanel";
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

  // ISO3 → set of currently-owned shape_ids. Drives the live country-outline
  // highlight in WorldMap so conquests extend the ring immediately. Includes
  // only ISOs we actually highlight (player + selected) — no point computing
  // owned-sets for every nation in the world on every render.
  const ownedByIso = useMemo(() => {
    const nationById = new Map<string, string>(); // nation_id → iso_a3
    for (const n of world.nations) nationById.set(n.id, n.iso_a3);
    const map = new Map<string, Set<string>>();
    for (const p of world.provinces) {
      const iso = nationById.get(p.owner);
      if (!iso) continue;
      let set = map.get(iso);
      if (!set) {
        set = new Set<string>();
        map.set(iso, set);
      }
      set.add(p.geometry_ref);
    }
    return map;
  }, [world.provinces, world.nations]);

  const hoveredProvince = useMemo(
    () => (hover ? findProvinceByShape(world, hover.shape_id) : null),
    [world, hover],
  );
  const hoveredOwner = useMemo(() => {
    if (!hoveredProvince) return null;
    return world.nations.find((n) => n.id === hoveredProvince.owner) ?? null;
  }, [world, hoveredProvince]);

  // Units stationed in the hovered province, grouped by owning nation so the
  // tooltip shows the garrison composition.
  const hoveredGarrison = useMemo(() => {
    if (!hoveredProvince) return [];
    const groups = new Map<string, { nation: Nation; units: typeof world.units }>();
    for (const u of world.units) {
      if (u.location !== hoveredProvince.id) continue;
      const nation = world.nations.find((n) => n.id === u.owner);
      if (!nation) continue;
      let g = groups.get(u.owner);
      if (!g) {
        g = { nation, units: [] };
        groups.set(u.owner, g);
      }
      g.units.push(u);
    }
    return [...groups.values()];
  }, [hoveredProvince, world.units, world.nations]);

  // Shift+click movement workflow:
  //   1. Shift+click a province that contains your divisions → selects it.
  //      The next non-shift click anywhere clears the selection; the next
  //      shift+click on an ADJACENT province with the selection set moves
  //      every player division from source to target.
  //   2. Plain click still opens the CountryDrawer for the owning nation,
  //      so non-movement workflows are unchanged.
  const [moveSource, setMoveSource] = useState<{
    shapeId: string;
    provinceId: string;
    unitCount: number;
  } | null>(null);
  const [adjacency, setAdjacency] = useState<Record<string, string[]> | null>(null);
  const [moveStatus, setMoveStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/province-adjacency.json")
      .then((r) => r.json())
      .then((data: { adjacency: Record<string, string[]> }) => {
        if (!cancelled) setAdjacency(data.adjacency);
      })
      .catch(() => {
        // Non-fatal — movement just falls back to the embedded server-side map.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && moveSource) {
        setMoveSource(null);
        setMoveStatus("Movement cancelled.");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveSource]);

  const handleClick = async (
    shape_id: string,
    modifiers: { shift: boolean },
  ) => {
    const p = findProvinceByShape(world, shape_id);
    if (!p) return;

    if (modifiers.shift && world.player_nation) {
      const friendlyUnits = world.units.filter(
        (u) => u.location === p.id && u.owner === world.player_nation,
      );
      if (!moveSource) {
        // First shift+click: must have player units in this province.
        if (friendlyUnits.length === 0) {
          setMoveStatus(
            `${p.name} has no friendly divisions to move. Shift-click a province with your units first.`,
          );
          return;
        }
        setMoveSource({
          shapeId: shape_id,
          provinceId: p.id,
          unitCount: friendlyUnits.length,
        });
        setMoveStatus(
          `Selected ${friendlyUnits.length} division(s) in ${p.name}. Shift-click an adjacent province to move.`,
        );
        return;
      }
      // Second shift+click: validate adjacency, then move every player unit.
      if (moveSource.shapeId === shape_id) {
        setMoveSource(null);
        setMoveStatus("Movement cancelled.");
        return;
      }
      const adj = adjacency?.[moveSource.shapeId] ?? [];
      if (!adj.includes(shape_id)) {
        setMoveStatus(
          `${p.name} is not adjacent to the source. Pick a neighbouring province (highlighted on the map).`,
        );
        return;
      }
      const movingUnits = world.units.filter(
        (u) =>
          u.location === moveSource.provinceId &&
          u.owner === world.player_nation,
      );
      if (movingUnits.length === 0) {
        setMoveSource(null);
        return;
      }
      setMoveStatus(`Moving ${movingUnits.length} division(s) to ${p.name}…`);
      let workingWorld = world;
      let lastOutcome = "";
      for (const u of movingUnits) {
        try {
          const r = await moveUnit(
            workingWorld,
            u.id,
            p.id,
            adjacency ?? {},
          );
          workingWorld = r.world;
          lastOutcome = r.outcome.outcome;
        } catch (e) {
          setMoveStatus(`Move failed: ${String(e)}`);
          setMoveSource(null);
          return;
        }
      }
      setWorld(workingWorld);
      setMoveSource(null);
      setMoveStatus(
        `${movingUnits.length} division(s) arrived in ${p.name} (${lastOutcome}).`,
      );
      return;
    }

    // Plain click → cancel any pending move and open the country drawer.
    if (moveSource) {
      setMoveSource(null);
      setMoveStatus(null);
    }
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

  // OrderQueuePanel updates the world directly via onWorldUpdate; pacing
  // hint comes from the validator's response there. Pacing is plumbed
  // through the world side-effect for now.

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
      <OrderQueuePanel
        world={world}
        providers={providers}
        providerId={providerId}
        model={model}
        onProviderChange={setProviderId}
        onModelChange={setModel}
        onWorldUpdate={setWorld}
      />
    ),
    advisor: (
      <AdvisorPanel
        world={world}
        providerId={providerId}
        model={model}
        onWorldUpdate={setWorld}
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
        pending={world.pending ?? []}
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
          ownedByIso={ownedByIso}
          onProvinceHover={setHover}
          onProvinceClick={handleClick}
          unitStacks={unitStacks}
        />
        <div className="ahd-map-vignette" />
        {moveStatus && (
          <div
            style={{
              position: "absolute",
              top: 14,
              left: "50%",
              transform: "translateX(-50%)",
              background: moveSource
                ? "rgba(122,162,247,0.92)"
                : "rgba(15, 17, 21, 0.92)",
              color: moveSource ? "#0c1322" : "var(--fg)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-md)",
              padding: "8px 14px",
              fontSize: "var(--fs-sm)",
              fontWeight: 600,
              zIndex: 8,
              maxWidth: 560,
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              cursor: "pointer",
            }}
            onClick={() => {
              setMoveSource(null);
              setMoveStatus(null);
            }}
            title="Click to dismiss"
          >
            {moveStatus}
            {moveSource && (
              <span style={{ marginLeft: 12, fontWeight: 500, opacity: 0.85 }}>
                (Esc or click here to cancel)
              </span>
            )}
          </div>
        )}
        {hover && hoveredProvince && (
          <ProvinceTooltip
            province={hoveredProvince}
            owner={hoveredOwner}
            unitsHere={hoveredGarrison}
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
              // Keep the modal open so the player can read multiple nation
              // turns without it dismissing — they explicitly close with ×
              // or Escape when done.
              setSelectedNation(nationId);
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
