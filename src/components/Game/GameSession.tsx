import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoCentroid } from "d3-geo";
import { WorldMap, type ProvinceHoverInfo } from "../Map/WorldMap";
import { useMapData } from "../Map/useMapData";
import { buildOwnershipColors, findProvinceByShape } from "../../lib/game/colors";
import { computeVisibility } from "../../lib/game/visibility";
import type { Nation, World } from "../../lib/game/types";
import {
  concedeRun,
  createBattlePlan,
  endTurn,
  moveUnit,
  runNpcTurn,
  victoryProgress as fetchVictoryProgress,
  type NationTurn,
  type NpcTurnResult,
  type OrchestratorPick,
} from "../../lib/game/tauri";
import type { VictoryProgress } from "../../lib/game/types";
import { listProviderConfigs, listModels } from "../../lib/tauri";
import type { ProviderConfig } from "../../lib/types";
import { AdvisorPanel } from "./AdvisorPanel";
import { BattlePlansPanel } from "./BattlePlansPanel";
import { CountryDrawer } from "./CountryDrawer";
import { DiplomacyPanel } from "./DiplomacyPanel";
import { ProvinceTooltip } from "./ProvinceTooltip";
import { OrderQueuePanel } from "./OrderQueuePanel";
import { SavesPanel } from "./SavesPanel";
import { HistoryPanel } from "./HistoryPanel";
import { TurnSummaryModal, type EconomyDelta } from "./TurnSummaryModal";
import { VictoryModal } from "./VictoryModal";
import { CommandDock, type DockTab } from "./CommandDock";
import { PoliticsScreen } from "./screens/PoliticsScreen";
import { ResearchScreen } from "./screens/ResearchScreen";
import { ProductionScreen } from "./screens/ProductionScreen";
import { WarScreen } from "./screens/WarScreen";
import { CrisesScreen } from "./screens/CrisesScreen";
import { IntelligenceScreen } from "./screens/IntelligenceScreen";
import { computeBadges } from "../../lib/game/badges";
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
  const [victoryDismissed, setVictoryDismissed] = useState(false);
  const [progress, setProgress] = useState<VictoryProgress | null>(null);

  // Recompute victory progress whenever the world changes. Cheap — pure
  // arithmetic over nations + treaties on the Rust side, no LLM.
  useEffect(() => {
    fetchVictoryProgress(world)
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [world]);

  // If a fresh victory just appeared on the world, surface the modal.
  useEffect(() => {
    if (world.victory) setVictoryDismissed(false);
  }, [world.victory]);

  const handleConcede = useCallback(async () => {
    // No confirm dialog yet — design rule says we're not pushy. The Menu
    // dropdown already says "Concede this run…" with the ellipsis, and
    // the player can dismiss the resulting modal with Esc to keep
    // looking at the map. If we add a confirm later, do it via the
    // existing AskUserQuestion modal pattern, not browser confirm().
    try {
      const next = await concedeRun(world);
      setWorld(next);
    } catch (e) {
      setTurnError(String(e));
    }
  }, [world]);

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

  // Plan 10 battle-plan selection workflow:
  //   1. Shift+click a friendly province with units → add it to the
  //      source selection (toggle off if already selected). Multiple
  //      sources allowed; the in-progress draft shows on the map.
  //   2. Right-click any province → create a BattlePlan from the
  //      selected sources to that target. Clear the draft.
  //   3. Escape or plain click → clear the draft.
  //   4. Once a plan exists, the Plans tab in the dock executes / cancels
  //      it. Execute moves units one hop along the adjacency graph.
  const [planSources, setPlanSources] = useState<Set<string>>(new Set());
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

  // Fog of war (Plan 09): which provinces the player is allowed to see in
  // full, plus the set of allied nation IDs whose units are always visible.
  // Filters enemy unit stacks in the unitStacks useMemo below; the WorldMap
  // fog layer dims unscouted territory visually.
  //
  // Until adjacency is loaded, render with NO fog — otherwise the player
  // briefly sees the entire enemy world hidden before the fetch resolves,
  // which reads as a bug. computeVisibility's "observer mode" branch is
  // exactly this (visibleProvinces = all, alliedNations = empty).
  const visibility = useMemo(() => {
    if (!adjacency) {
      return {
        visibleProvinces: new Set(world.provinces.map((p) => p.geometry_ref)),
        alliedNations: new Set<string>(),
      };
    }
    return computeVisibility(world, adjacency);
  }, [world, adjacency]);

  // Reference moveUnit so the import stays "used" — we keep the binding
  // because the validator path can still emit MoveUnit actions even though
  // the player UI now goes through battle plans.
  void moveUnit;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && planSources.size > 0) {
        setPlanSources(new Set());
        setMoveStatus("Battle plan draft cleared.");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [planSources]);

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
      if (friendlyUnits.length === 0 && !planSources.has(shape_id)) {
        setMoveStatus(
          `${p.name} has no friendly divisions. Shift-click a province with your units.`,
        );
        return;
      }
      setPlanSources((prev) => {
        const next = new Set(prev);
        if (next.has(shape_id)) {
          next.delete(shape_id);
          setMoveStatus(
            next.size === 0
              ? "Battle plan draft cleared."
              : `Deselected ${p.name}. ${next.size} source(s) still selected.`,
          );
        } else {
          next.add(shape_id);
          setMoveStatus(
            `${next.size} source province${next.size === 1 ? "" : "s"} selected — right-click any province on the map to set the target.`,
          );
        }
        return next;
      });
      return;
    }

    // Plain click → clear any draft and open the country drawer.
    if (planSources.size > 0) {
      setPlanSources(new Set());
      setMoveStatus(null);
    }
    setSelectedNation(p.owner);
    setSelectedShape(shape_id);
  };

  // Right-click on a province while a draft selection exists → create a
  // battle plan.
  const handleRightClick = async (shape_id: string) => {
    if (!world.player_nation) return;
    if (planSources.size === 0) {
      setMoveStatus(
        "Shift-click friendly provinces first to set sources, THEN right-click to set the target.",
      );
      return;
    }
    const target = findProvinceByShape(world, shape_id);
    if (!target) return;
    if (planSources.has(shape_id)) {
      setMoveStatus(
        "Target can't be one of the sources. Right-click a different province.",
      );
      return;
    }
    // Resolve source shape_ids → province ids.
    const sources: string[] = [];
    for (const sid of planSources) {
      const sp = findProvinceByShape(world, sid);
      if (sp) sources.push(sp.id);
    }
    if (sources.length === 0) return;
    setMoveStatus(`Drafting battle plan to ${target.name}…`);
    try {
      const newWorld = await createBattlePlan(world, {
        owner: world.player_nation,
        target: target.id,
        sources,
      });
      setWorld(newWorld);
      setPlanSources(new Set());
      setMoveStatus(
        `Battle plan drawn: ${sources.length} source${sources.length === 1 ? "" : "s"} → ${target.name}. Open the Plans tab to execute.`,
      );
      // Auto-switch to Plans tab so the player sees the new plan.
      setActiveTab("plans");
      if (dockCollapsed) setDockCollapsed(false);
    } catch (e) {
      setMoveStatus(`Could not create plan: ${String(e)}`);
    }
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

  // Plan 10: arrows drawn on the map. Two sources of arrows:
  //   - Active world.battle_plans owned by the player (status != cancelled).
  //   - The in-progress draft (planSources → not yet finalized) is NOT
  //     drawn as arrows here because there's no target yet; the status
  //     banner shows it instead.
  const planArrows = useMemo(() => {
    if (!world.player_nation) return [];
    const provinceById = new Map(world.provinces.map((p) => [p.id, p]));
    const out: Array<{
      sourceLon: number;
      sourceLat: number;
      targetLon: number;
      targetLat: number;
      color: string;
    }> = [];
    for (const plan of world.battle_plans ?? []) {
      if (plan.owner !== world.player_nation) continue;
      if (plan.status === "cancelled") continue;
      const target = provinceById.get(plan.target);
      if (!target) continue;
      const tc = provinceCentroids.get(target.geometry_ref);
      if (!tc) continue;
      for (const sid of plan.sources) {
        const src = provinceById.get(sid);
        if (!src) continue;
        const sc = provinceCentroids.get(src.geometry_ref);
        if (!sc) continue;
        out.push({
          sourceLon: sc[0],
          sourceLat: sc[1],
          targetLon: tc[0],
          targetLat: tc[1],
          color: plan.status === "executed" ? "#7aa2f7" : "#f5d76e",
        });
      }
    }
    return out;
  }, [world.battle_plans, world.player_nation, world.provinces, provinceCentroids]);

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

      // Fog of war: skip stacks whose owner is NOT allied AND whose
      // province is NOT in the player's visible set. Allied units stay
      // visible everywhere (own + ally expeditionary forces). Pre-pick
      // observer mode has alliedNations empty but visibleProvinces filled
      // with everything, so the second condition still passes.
      if (
        !visibility.alliedNations.has(u.owner) &&
        !visibility.visibleProvinces.has(province.geometry_ref)
      ) {
        continue;
      }

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
  }, [world.units, world.provinces, world.nations, provinceCentroids, visibility]);

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
    diplomacy: (
      <DiplomacyPanel
        world={world}
        providers={providers}
        providerId={providerId}
        model={model}
        onProviderChange={setProviderId}
        onModelChange={setModel}
        onWorldUpdate={setWorld}
      />
    ),
    plans: (
      <BattlePlansPanel
        world={world}
        adjacency={adjacency}
        onWorldUpdate={setWorld}
        draftSourceCount={planSources.size}
        onClearDraft={() => {
          setPlanSources(new Set());
          setMoveStatus("Battle plan draft cleared.");
        }}
      />
    ),
    politics: <PoliticsScreen world={world} />,
    research: <ResearchScreen world={world} onWorldUpdate={setWorld} />,
    production: <ProductionScreen world={world} onWorldUpdate={setWorld} />,
    war: <WarScreen world={world} onWorldUpdate={setWorld} />,
    crises: <CrisesScreen world={world} onWorldUpdate={setWorld} />,
    intelligence: <IntelligenceScreen world={world} onWorldUpdate={setWorld} />,
    saves: <SavesPanel world={world} onLoaded={setWorld} />,
    history: <HistoryPanel world={world} />,
  } satisfies Record<DockTab, React.ReactNode>;

  const dockBadges = useMemo(() => computeBadges(world), [world]);

  return (
    <div style={containerStyle}>
      <HudTopBar
        date={world.clock.current_date}
        round={world.clock.round}
        playerNation={playerNation}
        pending={world.pending ?? []}
        busy={busy}
        pacingHint={pacingHint}
        victoryProgress={progress}
        hasVictory={!!world.victory}
        onEndTurn={handleEndTurn}
        onExit={onExit}
        onConcede={handleConcede}
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
          visibleProvinces={visibility.visibleProvinces}
          planArrows={planArrows}
          onProvinceRightClick={handleRightClick}
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
              background:
                planSources.size > 0
                  ? "rgba(245,215,110,0.92)"
                  : "rgba(15, 17, 21, 0.92)",
              color:
                planSources.size > 0 ? "#0c1322" : "var(--fg)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-md)",
              padding: "8px 14px",
              fontSize: "var(--fs-sm)",
              fontWeight: 600,
              zIndex: 8,
              maxWidth: 620,
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              cursor: "pointer",
            }}
            onClick={() => {
              setPlanSources(new Set());
              setMoveStatus(null);
            }}
            title="Click to dismiss"
          >
            {moveStatus}
            {planSources.size > 0 && (
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
          badges={dockBadges}
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
        {world.victory && !victoryDismissed && (
          <VictoryModal
            victory={world.victory}
            onClose={() => setVictoryDismissed(true)}
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
