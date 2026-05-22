import { useEffect, useState } from "react";
import { listProviderConfigs, removeProvider } from "../../lib/tauri";
import type { ProviderConfig } from "../../lib/types";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";

export function ProviderList({
  refreshToken,
  onChange,
}: {
  refreshToken: number;
  onChange: () => void;
}) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProviderConfigs()
      .then(setProviders)
      .catch((e) => setError(String(e)));
  }, [refreshToken]);

  const handleRemove = async (id: string) => {
    await removeProvider(id);
    onChange();
  };

  if (error)
    return (
      <Card title="Configured providers">
        <div style={{ color: "salmon" }}>{error}</div>
      </Card>
    );

  return (
    <Card title="Configured providers">
      {providers.length === 0 && <div>No providers configured yet.</div>}
      <div className="ahd-stack">
        {providers.map((p) => (
          <div key={p.id} className="ahd-row">
            <div className="ahd-grow">
              <strong>{p.name}</strong> <small>({p.kind})</small>
              <br />
              <small>{p.base_url}</small>
            </div>
            <Button onClick={() => handleRemove(p.id)}>Remove</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
