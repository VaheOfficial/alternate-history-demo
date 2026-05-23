import { useMemo, useState } from "react";
import type {
  ProductionOrder,
  UnitTypeKey,
  World,
} from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { FactoryIcon } from "../../ui/Icon";
import { cancelBuild, queueBuild } from "../../../lib/game/tauri";

const UNIT_COST: Record<
  UnitTypeKey,
  { ic: number; treasury: number; manpower: number; label: string }
> = {
  infantry: { ic: 1, treasury: 80_000_000, manpower: 8_000, label: "Infantry" },
  mechanized: {
    ic: 2,
    treasury: 220_000_000,
    manpower: 6_500,
    label: "Mechanized",
  },
  armor: { ic: 4, treasury: 600_000_000, manpower: 5_000, label: "Armor" },
  artillery: {
    ic: 2,
    treasury: 180_000_000,
    manpower: 4_500,
    label: "Artillery",
  },
};

/**
 * Production screen (Plan 12 Phase 4). Multi-turn queue with progress
 * bars. Player adds new orders via the "+ Add build" form. Each
 * end_turn the engine drains industry capacity into the orders and
 * spawns finished units at the requested location.
 */
export function ProductionScreen({
  world,
  onWorldUpdate,
}: {
  world: World;
  onWorldUpdate: (world: World) => void;
}) {
  const [unitType, setUnitType] = useState<UnitTypeKey>("infantry");
  const [count, setCount] = useState(5);
  const [locationId, setLocationId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const player = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;
  if (!player) {
    return (
      <EmptyState
        icon={<FactoryIcon />}
        title="Production"
        description="Multi-turn build queue. Pick a player nation to see what you can produce."
      />
    );
  }

  const myOrders = (world.production_orders ?? []).filter(
    (o) => o.owner === player.id,
  );

  const playerProvinces = useMemo(() => {
    return world.provinces
      .filter((p) => p.owner === player.id)
      .sort((a, b) => b.population - a.population)
      .slice(0, 100);
  }, [world.provinces, player.id]);

  const handleAdd = async () => {
    setBusy("queue");
    setError(null);
    try {
      const next = await queueBuild(world, {
        unit_type: unitType,
        count,
        location: locationId || null,
      });
      onWorldUpdate(next);
      setCount(5);
      setLocationId("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const handleCancel = async (order: ProductionOrder) => {
    setBusy(order.id);
    setError(null);
    try {
      const next = await cancelBuild(world, order.id);
      onWorldUpdate(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={headerRow}>
        <div>
          <div style={titleStyle}>Production — {player.name}</div>
          <div style={subtitleStyle}>
            Industry <strong>{player.industry_capacity}</strong> · Treasury{" "}
            <strong>${(player.treasury / 1_000_000).toFixed(0)}M</strong> ·
            Manpower <strong>{(player.manpower_pool / 1_000_000).toFixed(1)}M</strong>
          </div>
        </div>
      </div>

      {error && <div style={errStyle}>{error}</div>}

      <div style={addFormStyle}>
        <div style={formTitleStyle}>New build order</div>
        <div style={formRowStyle}>
          <select
            value={unitType}
            onChange={(e) => setUnitType(e.target.value as UnitTypeKey)}
            className="ahd-select"
            style={selectStyle}
          >
            {(Object.keys(UNIT_COST) as UnitTypeKey[]).map((u) => (
              <option key={u} value={u}>
                {UNIT_COST[u].label} ({UNIT_COST[u].ic} IC ·{" "}
                ${(UNIT_COST[u].treasury / 1_000_000).toFixed(0)}M)
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={60}
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
            className="ahd-input"
            style={countInputStyle}
            placeholder="Count"
          />
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="ahd-select"
            style={selectStyle}
          >
            <option value="">Auto (largest pop)</option>
            {playerProvinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void handleAdd()}
            disabled={busy === "queue"}
            style={addBtnStyle}
            className="ahd-press"
          >
            + Add
          </button>
        </div>
      </div>

      <div style={listHeaderStyle}>
        Active queue
        {myOrders.length > 0 && (
          <span style={countBadge}>{myOrders.length}</span>
        )}
      </div>

      {myOrders.length === 0 ? (
        <div style={emptyQueueStyle}>
          Queue is empty. Add an order above and the next end-turn will start
          accruing industry into it.
        </div>
      ) : (
        <div style={listStyle}>
          {myOrders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              busy={busy === o.id}
              onCancel={() => handleCancel(o)}
              provinces={playerProvinces}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  busy,
  onCancel,
  provinces,
}: {
  order: ProductionOrder;
  busy: boolean;
  onCancel: () => void;
  provinces: { id: string; name: string }[];
}) {
  const remaining = Math.max(0, order.count - order.built);
  const unitCostPct =
    order.industry_cost_per > 0
      ? (order.industry_paid / order.industry_cost_per) * 100
      : 0;
  const overallPct = (order.built / order.count) * 100;
  const provName = order.location
    ? provinces.find((p) => p.id === order.location)?.name ?? "(unknown)"
    : "Auto";
  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>
        <strong>
          {order.count}× {UNIT_COST[order.unit_type].label}
        </strong>
        <span style={metaStyle}>
          → {provName} · {order.built}/{order.count} built
        </span>
      </div>
      <div style={barRowStyle}>
        <div style={barLabelStyle}>Overall</div>
        <div style={barTrackStyle}>
          <div
            style={{
              ...barFillStyle,
              width: `${overallPct}%`,
              background: "#7aa2f7",
            }}
          />
        </div>
        <div style={barValueStyle}>
          {Math.round(overallPct)}%
        </div>
      </div>
      {remaining > 0 && (
        <div style={barRowStyle}>
          <div style={barLabelStyle}>Next unit</div>
          <div style={barTrackStyle}>
            <div
              style={{
                ...barFillStyle,
                width: `${Math.min(100, unitCostPct)}%`,
                background: "#f5d76e",
              }}
            />
          </div>
          <div style={barValueStyle}>
            {order.industry_paid}/{order.industry_cost_per} IC
          </div>
        </div>
      )}
      <div style={cardActionsRow}>
        <button
          onClick={onCancel}
          disabled={busy}
          style={cancelBtnStyle}
          className="ahd-press"
        >
          {busy ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  gap: 10,
};

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
};

const titleStyle: React.CSSProperties = {
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.01em",
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
  marginTop: 2,
};

const errStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
};

const addFormStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const formTitleStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const formRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 140,
  fontSize: "var(--fs-sm)",
  padding: "4px 6px",
};

const countInputStyle: React.CSSProperties = {
  width: 72,
  fontSize: "var(--fs-sm)",
  padding: "4px 6px",
};

const addBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 700,
};

const listHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const countBadge: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--surface-3)",
  color: "var(--fg-muted)",
  fontSize: 9,
  fontWeight: 700,
};

const emptyQueueStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-sm)",
  background: "var(--surface-1)",
  border: "1px dashed var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 14,
  lineHeight: 1.5,
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  flex: 1,
  overflowY: "auto",
  paddingRight: 6,
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const metaStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
};

const barRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const barLabelStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  width: 70,
};

const barTrackStyle: React.CSSProperties = {
  flex: 1,
  height: 6,
  background: "var(--surface-3)",
  borderRadius: 999,
  overflow: "hidden",
};

const barFillStyle: React.CSSProperties = {
  height: "100%",
  transition: "width 220ms ease-out",
};

const barValueStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg)",
  width: 72,
  textAlign: "right",
};

const cardActionsRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 6,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-xs)",
};
