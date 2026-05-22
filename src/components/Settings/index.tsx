import { useState } from "react";
import { AddProvider } from "./AddProvider";
import { AutoDetect } from "./AutoDetect";
import { ProviderList } from "./ProviderList";
import { TestChat } from "./TestChat";

export function Settings() {
  const [refreshToken, setRefreshToken] = useState(0);
  const bump = () => setRefreshToken((t) => t + 1);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1>Settings</h1>
      <AutoDetect onAdded={bump} />
      <AddProvider onAdded={bump} />
      <ProviderList refreshToken={refreshToken} onChange={bump} />
      <TestChat refreshToken={refreshToken} />
    </div>
  );
}
