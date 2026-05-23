import { useMemo, useState } from "react";
import type {
  DiplomaticChannel,
  DiplomaticMessage,
  Nation,
  World,
} from "../../lib/game/types";
import {
  closeDiplomaticChannel,
  enactDiplomaticProposal,
  openDiplomaticChannel,
  sendDiplomaticMessage,
} from "../../lib/game/tauri";
import { colorForMapcolor } from "../../lib/map/renderer";
import { SendIcon } from "../ui/Icon";

/**
 * Diplomacy Chats (Plan 11) — multi-NPC group chat surface. The player
 * opens a channel with one or more nations, types a message, and each
 * NPC participant replies in turn. NPC replies may carry proposed
 * `typed_actions` (sign_treaty, modify_relation, declare_war...) that
 * the player can Enact with one click.
 */
export function DiplomacyPanel({
  world,
  providers,
  providerId,
  model,
  onProviderChange,
  onModelChange,
  onWorldUpdate,
}: {
  world: World;
  providers: { id: string; name: string }[];
  providerId: string;
  model: string;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
  onWorldUpdate: (world: World) => void;
}) {
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickerQuery, setPickerQuery] = useState("");

  const noProvider = providers.length === 0;
  const playerNation = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  const channels = world.diplomatic_channels ?? [];
  const open = channels.filter((c) => c.status === "open");
  const closed = channels.filter((c) => c.status === "closed");
  const expanded = channels.find((c) => c.id === openChannelId) ?? null;

  const nationsById = useMemo(() => {
    const m = new Map<string, Nation>();
    for (const n of world.nations) m.set(n.id, n);
    return m;
  }, [world.nations]);

  // Candidates for "new channel" picker. Every non-player nation, sorted by
  // industry descending so big powers appear first when the search is
  // empty. With a query, we filter by name / ISO3 (case-insensitive
  // substring) AND drop the industry-top-60 cap so deep-cuts surface
  // (e.g. searching "tonga" still finds Tonga).
  const candidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const base = world.nations
      .filter((n) => n.id !== world.player_nation)
      .slice()
      .sort((a, b) => b.industry_capacity - a.industry_capacity);
    if (!q) return base.slice(0, 60);
    return base
      .filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.iso_a3.toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [world.nations, world.player_nation, pickerQuery]);

  const handleOpenChannel = async () => {
    if (!playerNation || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const participants = [playerNation.id, ...picked];
      const newWorld = await openDiplomaticChannel(world, participants);
      onWorldUpdate(newWorld);
      const created =
        newWorld.diplomatic_channels[newWorld.diplomatic_channels.length - 1];
      setOpenChannelId(created?.id ?? null);
      setPicked(new Set());
      setPickerQuery("");
      setPicker(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    if (!expanded || !composer.trim() || !providerId || !model) return;
    setBusy(true);
    setError(null);
    const msg = composer.trim();
    setComposer("");
    try {
      const result = await sendDiplomaticMessage(
        providerId,
        model,
        world,
        expanded.id,
        msg,
      );
      onWorldUpdate(result.world);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleEnact = async (msg: DiplomaticMessage) => {
    if (!expanded) return;
    setBusy(true);
    setError(null);
    try {
      const newWorld = await enactDiplomaticProposal(world, expanded.id, msg.id);
      onWorldUpdate(newWorld);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (channel: DiplomaticChannel) => {
    setBusy(true);
    setError(null);
    try {
      const newWorld = await closeDiplomaticChannel(world, channel.id);
      onWorldUpdate(newWorld);
      if (openChannelId === channel.id) setOpenChannelId(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <div style={titleStyle}>
            {playerNation ? `Diplomacy — ${playerNation.name}` : "Diplomacy"}
          </div>
          <div style={subtitleStyle}>
            Open a channel with one or more nations, then negotiate. Each
            NPC replies in turn; click Enact to apply a proposal.
          </div>
        </div>
        {!noProvider && (
          <div style={selectorRow}>
            <select
              value={providerId}
              onChange={(e) => onProviderChange(e.target.value)}
              className="ahd-select"
              style={miniSelectStyle}
              disabled={busy}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="ahd-input"
              style={miniSelectStyle}
              disabled={busy}
              placeholder="model"
            />
          </div>
        )}
      </div>

      {error && <div style={errStyle}>{error}</div>}

      {!expanded && (
        <>
          <div style={topActionsRow}>
            <button
              onClick={() => setPicker(true)}
              disabled={busy || !playerNation}
              style={primaryBtnStyle}
              className="ahd-press"
            >
              + New channel
            </button>
            {channels.length > 0 && (
              <div style={countLine}>
                {open.length} open · {closed.length} closed
              </div>
            )}
          </div>

          {picker && (
            <div style={pickerBoxStyle}>
              <div style={pickerHeaderStyle}>
                <strong>Invite to the table</strong>
                <button
                  onClick={() => {
                    setPicker(false);
                    setPicked(new Set());
                    setPickerQuery("");
                  }}
                  style={pickerCloseBtn}
                >
                  ×
                </button>
              </div>
              <input
                type="search"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search by name or ISO3 (e.g. “Japan”, “JPN”)…"
                style={pickerSearchStyle}
                autoFocus
              />
              {candidates.length === 0 && (
                <div style={pickerEmptyStyle}>
                  No nations match "{pickerQuery}".
                </div>
              )}
              <div style={candidateListStyle}>
                {candidates.map((n) => {
                  const sel = picked.has(n.id);
                  return (
                    <label
                      key={n.id}
                      style={{
                        ...candidateRow,
                        background: sel
                          ? "rgba(122,162,247,0.18)"
                          : "var(--surface-1)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={(e) => {
                          setPicked((p) => {
                            const next = new Set(p);
                            if (e.target.checked) next.add(n.id);
                            else next.delete(n.id);
                            return next;
                          });
                        }}
                      />
                      <span
                        style={{
                          ...candidateColorChip,
                          background: colorForMapcolor(n.map_color),
                        }}
                      />
                      <span style={{ fontWeight: 600 }}>{n.name}</span>
                      <span style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>
                        ({n.iso_a3})
                      </span>
                    </label>
                  );
                })}
              </div>
              <div style={pickerActionsRow}>
                <button
                  onClick={() => void handleOpenChannel()}
                  disabled={busy || picked.size === 0}
                  style={primaryBtnStyle}
                  className="ahd-press"
                >
                  Open channel with {picked.size}
                </button>
              </div>
            </div>
          )}

          {channels.length === 0 && !picker && (
            <div style={emptyStyle}>
              No diplomatic channels yet. Press "New channel" to sit one or
              more foreign leaders down at the table.
            </div>
          )}

          {channels.length > 0 && (
            <div style={listStyle}>
              {[...open, ...closed].map((c) => {
                const others = c.participants
                  .filter((id) => id !== world.player_nation)
                  .map((id) => nationsById.get(id))
                  .filter((n): n is Nation => !!n);
                const lastMsg = c.messages[c.messages.length - 1];
                return (
                  <button
                    key={c.id}
                    onClick={() => setOpenChannelId(c.id)}
                    style={{
                      ...channelCardStyle,
                      opacity: c.status === "closed" ? 0.65 : 1,
                    }}
                    className="ahd-press"
                  >
                    <div style={channelHeaderRow}>
                      <div style={participantChipsRow}>
                        {others.slice(0, 5).map((n) => (
                          <span
                            key={n.id}
                            style={participantChipStyle(n)}
                            title={n.name}
                          >
                            {n.iso_a3}
                          </span>
                        ))}
                        {others.length > 5 && (
                          <span style={{ color: "var(--fg-dim)" }}>+{others.length - 5}</span>
                        )}
                      </div>
                      <span style={statusChipStyle(c.status)}>{c.status.toUpperCase()}</span>
                    </div>
                    <div style={channelPreviewStyle}>
                      {lastMsg ? (
                        <>
                          <strong>
                            {nationsById.get(lastMsg.speaker)?.name ?? "?"}:
                          </strong>{" "}
                          {lastMsg.content.slice(0, 140)}
                          {lastMsg.content.length > 140 ? "…" : ""}
                        </>
                      ) : (
                        <span style={{ color: "var(--fg-dim)" }}>(no messages yet)</span>
                      )}
                    </div>
                    <div style={channelMetaStyle}>
                      {c.messages.length} message{c.messages.length === 1 ? "" : "s"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {expanded && (
        <div style={chatContainer}>
          <div style={chatHeaderRow}>
            <button
              onClick={() => setOpenChannelId(null)}
              style={backBtnStyle}
              className="ahd-press"
            >
              ← Channels
            </button>
            <div style={chatParticipantsRow}>
              {expanded.participants
                .filter((id) => id !== world.player_nation)
                .map((id) => nationsById.get(id))
                .filter((n): n is Nation => !!n)
                .map((n) => (
                  <span key={n.id} style={participantChipStyle(n)}>
                    {n.name}
                  </span>
                ))}
            </div>
            {expanded.status === "open" && (
              <button
                onClick={() => void handleClose(expanded)}
                style={closeChannelBtnStyle}
                className="ahd-press"
                disabled={busy}
              >
                Close channel
              </button>
            )}
          </div>

          <div style={messagesScrollStyle}>
            {expanded.messages.length === 0 ? (
              <div style={emptyStyle}>
                No messages yet. Type something below to break the silence.
              </div>
            ) : (
              expanded.messages.map((msg) => {
                const speaker = nationsById.get(msg.speaker);
                const isPlayer = msg.speaker === world.player_nation;
                return (
                  <div
                    key={msg.id}
                    style={{
                      ...messageRowStyle,
                      flexDirection: isPlayer ? "row-reverse" : "row",
                    }}
                  >
                    <div
                      style={{
                        ...messageBubbleStyle,
                        background: isPlayer
                          ? "rgba(122,162,247,0.18)"
                          : "var(--surface-1)",
                        borderColor: isPlayer
                          ? "rgba(122,162,247,0.45)"
                          : "var(--border)",
                      }}
                    >
                      <div style={messageSpeakerRow}>
                        {speaker && (
                          <span
                            style={{
                              ...speakerColorChip,
                              background: colorForMapcolor(speaker.map_color),
                            }}
                          />
                        )}
                        <strong>{speaker?.name ?? "?"}</strong>
                        <span style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>
                          {msg.timestamp}
                        </span>
                      </div>
                      <div style={messageContentStyle}>{msg.content}</div>
                      {msg.proposed_actions.length > 0 && (
                        <div style={proposalBoxStyle}>
                          <div style={proposalHeaderStyle}>
                            Proposed: {msg.proposed_actions.length} action
                            {msg.proposed_actions.length === 1 ? "" : "s"}
                          </div>
                          <ul style={proposalListStyle}>
                            {msg.proposed_actions.map((a, i) => (
                              <li key={i}>
                                {(a as { action?: string }).action ?? "unknown"}
                              </li>
                            ))}
                          </ul>
                          {!msg.enacted ? (
                            <button
                              onClick={() => void handleEnact(msg)}
                              style={enactBtnStyle}
                              className="ahd-press"
                              disabled={busy}
                            >
                              Enact
                            </button>
                          ) : (
                            <span style={enactedTagStyle}>✓ Enacted</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {expanded.status === "open" && (
            <div style={composerRowStyle}>
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={handleKey}
                placeholder={
                  noProvider
                    ? "Configure an LLM provider in Settings first."
                    : `Speak as ${playerNation?.name ?? "the player"}. ⌘/Ctrl+Enter to send.`
                }
                style={composerTextareaStyle}
                rows={2}
                disabled={busy || noProvider}
              />
              <button
                onClick={() => void handleSend()}
                disabled={busy || !composer.trim() || noProvider || !model}
                style={sendBtnStyle}
                className="ahd-press"
              >
                <SendIcon /> {busy ? "…" : "Send"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function participantChipStyle(n: Nation): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 999,
    background: colorForMapcolor(n.map_color),
    color: "#0c1322",
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: "0.04em",
  };
}

function statusChipStyle(status: "open" | "closed"): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    background: status === "open" ? "var(--accent)" : "var(--surface-3)",
    color: status === "open" ? "#0c1322" : "var(--fg-muted)",
    fontWeight: 800,
    fontSize: 9,
    letterSpacing: "0.08em",
  };
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  gap: 10,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: "var(--fs-md)",
  letterSpacing: "-0.01em",
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
  marginTop: 2,
  lineHeight: 1.45,
};

const selectorRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
};

const miniSelectStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  padding: "4px 6px",
  maxWidth: 180,
};

const errStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "var(--fs-xs)",
  fontFamily: "var(--font-mono)",
};

const topActionsRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const countLine: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 700,
};

const pickerBoxStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const pickerHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const pickerCloseBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: 18,
};

const pickerSearchStyle: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--fs-sm)",
  background: "var(--surface-2)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 10px",
};

const pickerEmptyStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-xs)",
  padding: "8px 4px 0",
  fontStyle: "italic",
};

const candidateListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 240,
  overflowY: "auto",
};

const candidateRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: "var(--fs-sm)",
};

const candidateColorChip: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 2,
  boxShadow: "0 0 0 1px rgba(255,255,255,0.15)",
};

const pickerActionsRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const emptyStyle: React.CSSProperties = {
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

const channelCardStyle: React.CSSProperties = {
  textAlign: "left",
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  cursor: "pointer",
  color: "var(--fg)",
  fontFamily: "inherit",
};

const channelHeaderRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 6,
};

const participantChipsRow: React.CSSProperties = {
  display: "flex",
  gap: 4,
  flexWrap: "wrap",
};

const channelPreviewStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  color: "var(--fg-muted)",
  lineHeight: 1.45,
  marginBottom: 4,
};

const channelMetaStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
};

const chatContainer: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  gap: 8,
};

const chatHeaderRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const backBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "4px 10px",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: "var(--fs-xs)",
};

const chatParticipantsRow: React.CSSProperties = {
  display: "flex",
  gap: 4,
  flex: 1,
  flexWrap: "wrap",
  justifyContent: "center",
};

const closeChannelBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "4px 10px",
  color: "var(--danger)",
  cursor: "pointer",
  fontSize: "var(--fs-xs)",
};

const messagesScrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "4px 2px",
};

const messageRowStyle: React.CSSProperties = {
  display: "flex",
  width: "100%",
};

const messageBubbleStyle: React.CSSProperties = {
  border: "1px solid",
  borderRadius: "var(--radius-md)",
  padding: 10,
  maxWidth: "80%",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const messageSpeakerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: "var(--fs-xs)",
};

const speakerColorChip: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 2,
  boxShadow: "0 0 0 1px rgba(255,255,255,0.15)",
};

const messageContentStyle: React.CSSProperties = {
  fontSize: "var(--fs-sm)",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

const proposalBoxStyle: React.CSSProperties = {
  marginTop: 6,
  background: "rgba(245, 215, 110, 0.10)",
  border: "1px solid rgba(245, 215, 110, 0.35)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 8px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const proposalHeaderStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  fontWeight: 700,
  color: "var(--fg)",
};

const proposalListStyle: React.CSSProperties = {
  margin: "0",
  paddingLeft: 16,
  fontSize: "var(--fs-xs)",
  color: "var(--fg-muted)",
};

const enactBtnStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "4px 10px",
  background: "#f5d76e",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: "var(--fs-xs)",
  fontWeight: 700,
};

const enactedTagStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  fontSize: "var(--fs-xs)",
  color: "var(--accent)",
  fontWeight: 700,
};

const composerRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "stretch",
};

const composerTextareaStyle: React.CSSProperties = {
  flex: 1,
  boxSizing: "border-box",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--fs-sm)",
  background: "var(--surface-1)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 10,
  resize: "vertical",
  lineHeight: 1.45,
};

const sendBtnStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-sm)",
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
