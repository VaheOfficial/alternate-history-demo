import { useState } from "react";
import "./App.css";
import { GameSession } from "./components/Game/GameSession";
import { LandingPage } from "./components/Landing/LandingPage";
import { Settings } from "./components/Settings";
import type { World } from "./lib/game/types";

type Screen =
  | { kind: "landing" }
  | { kind: "settings" }
  | { kind: "session"; world: World };

function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "landing" });

  if (screen.kind === "landing") {
    return (
      <main>
        <LandingPage
          onLoaded={(world) => setScreen({ kind: "session", world })}
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
