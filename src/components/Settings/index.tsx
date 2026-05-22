import { useState } from "react";
import { AddProvider } from "./AddProvider";
import { AutoDetect } from "./AutoDetect";
import { LoadedModels } from "./LoadedModels";
import { ProviderList } from "./ProviderList";
import { TestChat } from "./TestChat";

export function Settings() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadedRefreshToken, setLoadedRefreshToken] = useState(0);

  const bump = () => setRefreshToken((t) => t + 1);
  const bumpLoaded = () => setLoadedRefreshToken((t) => t + 1);
  const bumpAll = () => {
    bump();
    bumpLoaded();
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1>Settings</h1>
      <AutoDetect onAdded={bumpAll} />
      <AddProvider onAdded={bumpAll} />
      <ProviderList refreshToken={refreshToken} onChange={bumpAll} />
      <TestChat refreshToken={refreshToken} onChatComplete={bumpLoaded} />
      <LoadedModels refreshToken={loadedRefreshToken} />
    </div>
  );
}
