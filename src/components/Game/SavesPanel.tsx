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

/** Inline version of SavesDrawer designed to live inside the CommandDock. */
export function SavesPanel({
  world,
  onLoaded,
}: {
  world: World;
  onLoaded: (world: World) => void;
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
        setSnapshots(await listSnapshots(world.save_id, world.branch_id));
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
      onLoaded(await loadSnapshot(s.id, s.initial_branch_id, round));
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
    <div style={containerStyle}>
      <div style={actionRowStyle}>
        <button onClick={handleSaveNow} disabled={busy} className="ahd-button ahd-press">
          {busy ? "…" : "Save snapshot now"}
        </button>
        <button onClick={refresh} className="ahd-button ahd-press" disabled={busy}>
          Refresh
        </button>
        {msg && <span style={msgStyle}>{msg}</span>}
        {error && <span style={errStyle}>{error}</span>}
      </div>

      <div style={columnsStyle}>
        <div style={listStyle}>
          {saves.length === 0 && (
            <div style={{ color: "var(--fg-dim)", padding: 8 }}>No saves yet.</div>
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
                className="ahd-button ahd-press"
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

        <div style={snapshotsColumnStyle}>
          {selectedSave ? (
            <>
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
                        className="ahd-button ahd-press"
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
            </>
          ) : (
            <div style={{ color: "var(--fg-dim)" }}>Select a save to view snapshots.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatStamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.includes("T") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  height: "100%",
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const columnsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 16,
  flex: 1,
  overflow: "hidden",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  overflowY: "auto",
  paddingRight: 8,
};

const snapshotsColumnStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  overflowY: "auto",
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
  letterSpacing: "0.1em",
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

const msgStyle: React.CSSProperties = {
  color: "var(--accent)",
  fontSize: "var(--fs-xs)",
};

const errStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
};
