import { useState } from "react";
import "./App.css";
import { CountryPicker } from "./components/Game/CountryPicker";
import { GameSession } from "./components/Game/GameSession";
import { LandingPage } from "./components/Landing/LandingPage";
import { Settings } from "./components/Settings";
import { saveSnapshot } from "./lib/game/tauri";
import type { World } from "./lib/game/types";

type Screen =
  | { kind: "landing" }
  | { kind: "settings" }
  | { kind: "picking"; world: World }
  | { kind: "session"; world: World };

function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "landing" });

  const handleLoaded = (world: World) => {
    // If the world already has a player nation (e.g. resumed save), go
    // straight into the session. Otherwise show the country picker.
    if (world.player_nation) {
      setScreen({ kind: "session", world });
    } else {
      setScreen({ kind: "picking", world });
    }
  };

  if (screen.kind === "landing") {
    return (
      <main>
        <LandingPage
          onLoaded={handleLoaded}
          onOpenSettings={() => setScreen({ kind: "settings" })}
        />
      </main>
    );
  }

  if (screen.kind === "settings") {
    return (
      <main>
        <div style={{ padding: "16px 20px 0" }}>
          <button
            onClick={() => setScreen({ kind: "landing" })}
            className="ahd-button"
          >
            ← Back
          </button>
        </div>
        <Settings />
      </main>
    );
  }

  if (screen.kind === "picking") {
    return (
      <main>
        <CountryPicker
          world={screen.world}
          onCancel={() => setScreen({ kind: "landing" })}
          onConfirm={(nationId) => {
            const next: World = { ...screen.world, player_nation: nationId };
            // Persist the choice so resumes skip the picker.
            saveSnapshot(next).catch(() => {
              // Non-fatal — the in-memory choice still drives this session.
            });
            setScreen({ kind: "session", world: next });
          }}
        />
      </main>
    );
  }

  return (
    <main>
      <GameSession
        world={screen.world}
        onExit={() => setScreen({ kind: "landing" })}
      />
    </main>
  );
}

export default App;
