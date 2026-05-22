import { useState } from "react";
import "./App.css";
import { MapPage } from "./components/Map/MapPage";
import { Settings } from "./components/Settings";
import { Tabs } from "./components/shared/Tabs";

type TabKey = "settings" | "map";

function App() {
  const [tab, setTab] = useState<TabKey>("settings");
  return (
    <main>
      <Tabs<TabKey>
        tabs={[
          { key: "settings", label: "Settings" },
          { key: "map", label: "Map" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "settings" ? <Settings /> : <MapPage />}
    </main>
  );
}

export default App;
