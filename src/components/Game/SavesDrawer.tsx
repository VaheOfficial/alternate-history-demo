import { useCallback, useEffect, useState } from "react";
import {
  listSaves,
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
  deleteSave,
} from "../../lib/game/tauri";
import type {
  SaveSummary,
  World,
} from "../../lib/game/types";
import type { SnapshotMeta } from "../../lib/game/tauri";

export function SavesDrawer({
  world,
  onLoaded,
  onClose,
}: {
  world: World;
  onLoaded: (world: World) => void;
  onClose: () => void;
}) {
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const all = await listSaves();
      setSaves(all);
      if (selected == null && all.length > 0) setSelected(all[0].id);
    } catch (e) {
      setError(String(e));
    }
  }, [selected]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setSnapshots([]);
      return;
    }
    const s = saves.find((x) => x.id === selected);
    if (!s) return;
    listSnapshots(s.id, s.initial_branch_id)
      .then(setSnapshots)
      .catch((e) => setError(String(e)));
  }, [selected, saves]);

  const handleSaveNow = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await saveSnapshot(world);
      setMsg(
        `Snapshot saved at round ${world.clock.round} (${world.clock.current_date}).`,
      );
      await refresh();
      if (world.save_id) {
        const meta = await listSnapshots(world.save_id, world.branch_id);
        setSnapshots(meta);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = async (s: SaveSummary, round: number) => {
    setBusy(true);
    setError(null);
    try {
      const w = await loadSnapshot(s.id, s.initial_branch_id, round);
      onLoaded(w);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (s: SaveSummary) => {
    if (!confirm(`Delete save "${s.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSave(s.id);
      if (selected === s.id) setSelected(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const selectedSave = saves.find((s) => s.id === selected) ?? null;

  return (
    <div style={drawerStyle}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>Saves</h3>
        <button onClick={onClose} style={closeStyle} aria-label="Close">
          ×
        </button>
      </div>

      <div style={actionRowStyle}>
        <button
          onClick={handleSaveNow}
          disabled={busy}
          className="ahd-button"
        >
          {busy ? "…" : "Save snapshot now"}
        </button>
        <button onClick={refresh} className="ahd-button" disabled={busy}>
          Refresh
        </button>
      </div>

      {msg && <div style={msgStyle}>{msg}</div>}
      {error && <div style={errStyle}>{error}</div>}

      <div style={listStyle}>
        {saves.length === 0 && (
          <div style={{ color: "var(--fg-dim)", padding: 8 }}>No saves.</div>
        )}
        {saves.map((s) => (
          <div
            key={s.id}
            style={{
              ...saveItemStyle,
              ...(selected === s.id ? saveItemActiveStyle : {}),
            }}
            onClick={() => setSelected(s.id)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "var(--fs-sm)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.name}
              </div>
              <div style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>
                {s.scenario_id ?? "custom"} · {formatStamp(s.last_played_at)}
              </div>
            </div>
            <button
              className="ahd-button"
              style={{ padding: "3px 8px", fontSize: "var(--fs-xs)" }}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(s);
              }}
              disabled={busy}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {selectedSave && (
        <div style={{ marginTop: 14 }}>
          <div style={subHeaderStyle}>
            Snapshots in {selectedSave.name}
          </div>
          {snapshots.length === 0 ? (
            <div style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>
              No snapshots yet.
            </div>
          ) : (
            <ul style={snapshotListStyle}>
              {snapshots.map((s) => (
                <li key={s.round} style={snapshotItemStyle}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>
                      Round {s.round}
                    </div>
                    <div style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>
                      {s.game_date}
                    </div>
                  </div>
                  <button
                    className="ahd-button"
                    style={{ padding: "4px 10px", fontSize: "var(--fs-xs)" }}
                    onClick={() => handleLoad(selectedSave, s.round)}
                    disabled={busy}
                  >
                    Load
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatStamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.includes("T") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const drawerStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  width: 380,
  background: "rgba(15, 17, 21, 0.94)",
  borderLeft: "1px solid var(--border)",
  boxShadow: "-8px 0 24px rgba(0,0,0,0.45)",
  zIndex: 18,
  display: "flex",
  flexDirection: "column",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  padding: "12px 14px 16px",
  overflowY: "auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--fs-lg)",
  fontWeight: 700,
  letterSpacing: "-0.015em",
};

const closeStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--fg-muted)",
  fontSize: 24,
  lineHeight: 1,
  cursor: "pointer",
  padding: "0 6px",
  fontFamily: "inherit",
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 10,
};

const msgStyle: React.CSSProperties = {
  background: "rgba(122,162,247,0.10)",
  border: "1px solid rgba(122,162,247,0.35)",
  color: "var(--accent)",
  borderRadius: "var(--radius-md)",
  padding: "8px 10px",
  fontSize: "var(--fs-xs)",
  marginBottom: 8,
};

const errStyle: React.CSSProperties = {
  background: "rgba(60,16,16,0.55)",
  border: "1px solid #5a2a2a",
  color: "var(--danger)",
  borderRadius: "var(--radius-md)",
  padding: "8px 10px",
  fontSize: "var(--fs-xs)",
  marginBottom: 8,
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const saveItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  background: "var(--surface-1)",
};

const saveItemActiveStyle: React.CSSProperties = {
  background: "var(--surface-3)",
  borderColor: "var(--border-strong)",
};

const subHeaderStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  marginBottom: 6,
};

const snapshotListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const snapshotItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--surface-1)",
};
