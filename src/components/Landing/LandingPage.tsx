import { useEffect, useState } from "react";
import { createModernDaySave, listSaves, loadSnapshot } from "../../lib/game/tauri";
import type { SaveSummary, World } from "../../lib/game/types";

export function LandingPage({
  onLoaded,
  onOpenSettings,
}: {
  onLoaded: (world: World) => void;
  onOpenSettings: () => void;
}) {
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSaves()
      .then(setSaves)
      .catch((e) => setError(String(e)));
  }, []);

  const handleNewGame = async () => {
    setBusy(true);
    setError(null);
    try {
      const boot = await createModernDaySave(
        `Modern Day — ${new Date().toLocaleDateString()}`,
      );
      onLoaded(boot.world);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = async (s: SaveSummary) => {
    setBusy(true);
    setError(null);
    try {
      // Load the latest snapshot we know about — round 0 for now; the turn
      // ticker (Phase B) will write later rounds we'd preferentially load.
      const world = await loadSnapshot(s.id, s.initial_branch_id, 0);
      onLoaded(world);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={pageStyle}>
      <div style={heroStyle}>
        <h1 style={titleStyle}>Alternate History</h1>
        <div style={subtitleStyle}>
          A history sandbox driven by your own language model.
        </div>
      </div>

      <div style={gridStyle}>
        <PrimaryCard
          title="New Modern Day Game"
          body="Spin up the world as it stands today — every country, every province, ready for you to bend the timeline."
          buttonLabel={busy ? "Creating…" : "Start"}
          onClick={handleNewGame}
          disabled={busy}
        />

        <Card
          title="Continue"
          body={
            saves.length === 0
              ? "No saves yet."
              : `${saves.length} saved ${saves.length === 1 ? "game" : "games"}.`
          }
        >
          {saves.length > 0 && (
            <ul style={savesListStyle}>
              {saves.slice(0, 5).map((s) => (
                <li key={s.id} style={savesListItemStyle}>
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
                    onClick={() => handleContinue(s)}
                    disabled={busy}
                    className="ahd-button"
                    style={{ flex: "0 0 auto" }}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Settings"
          body="Configure your providers (Ollama, OpenAI, Anthropic) and pick a default model."
        >
          <button
            onClick={onOpenSettings}
            disabled={busy}
            className="ahd-button"
            style={{ marginTop: 8 }}
          >
            Open settings
          </button>
        </Card>
      </div>

      {error && (
        <div style={errorStyle}>
          <strong>Could not start:</strong> {error}
        </div>
      )}

      <div style={footerStyle}>
        Bring your own LLM · Offline-first · Public-domain map data
      </div>
    </div>
  );
}

function PrimaryCard({
  title,
  body,
  buttonLabel,
  onClick,
  disabled,
}: {
  title: string;
  body: string;
  buttonLabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={primaryCardStyle}>
      <div>
        <h3 style={cardTitleStyle}>{title}</h3>
        <div style={cardBodyStyle}>{body}</div>
      </div>
      <button onClick={onClick} disabled={disabled} style={primaryButtonStyle}>
        {buttonLabel}
      </button>
    </div>
  );
}

function Card({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>{title}</h3>
      <div style={cardBodyStyle}>{body}</div>
      {children}
    </div>
  );
}

function formatStamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.includes("T") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "60px 24px 24px",
  gap: 28,
  background:
    "radial-gradient(circle at 30% -10%, rgba(122,162,247,0.10), transparent 50%)," +
    "radial-gradient(circle at 70% 100%, rgba(159,122,247,0.06), transparent 50%)," +
    "var(--bg)",
};

const heroStyle: React.CSSProperties = {
  textAlign: "center",
  maxWidth: 720,
};

const titleStyle: React.CSSProperties = {
  fontSize: "3rem",
  fontWeight: 800,
  letterSpacing: "-0.035em",
  margin: 0,
  lineHeight: 1.05,
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-lg)",
  marginTop: 10,
  letterSpacing: "-0.005em",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.4fr 1fr 1fr",
  gap: 20,
  width: "100%",
  maxWidth: 1100,
};

const primaryCardStyle: React.CSSProperties = {
  background:
    "linear-gradient(160deg, rgba(122,162,247,0.16), rgba(122,162,247,0.04))",
  border: "1px solid rgba(122,162,247,0.35)",
  borderRadius: "var(--radius-lg)",
  padding: 22,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: 18,
  boxShadow: "0 6px 22px rgba(0,0,0,0.35)",
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 22,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: "var(--fs-xl)",
  fontWeight: 700,
  letterSpacing: "-0.015em",
  margin: 0,
};

const cardBodyStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--fs-sm)",
  lineHeight: 1.5,
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "var(--accent)",
  color: "#0c1322",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.005em",
  alignSelf: "flex-start",
};

const savesListStyle: React.CSSProperties = {
  margin: "6px 0 0",
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const savesListItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 0",
  borderBottom: "1px solid var(--border)",
};

const errorStyle: React.CSSProperties = {
  color: "var(--danger)",
  background: "rgba(60,16,16,0.55)",
  border: "1px solid #5a2a2a",
  borderRadius: "var(--radius-md)",
  padding: "10px 14px",
  maxWidth: 720,
  fontSize: "var(--fs-sm)",
};

const footerStyle: React.CSSProperties = {
  marginTop: "auto",
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
  letterSpacing: "0.04em",
};
