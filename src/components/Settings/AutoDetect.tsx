import { useState } from "react";
import { addProvider, detectLocalProviders } from "../../lib/tauri";
import type { DetectedProvider } from "../../lib/types";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";

export function AutoDetect({ onAdded }: { onAdded: () => void }) {
  const [detected, setDetected] = useState<DetectedProvider[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    setBusy(true);
    setError(null);
    try {
      setDetected(await detectLocalProviders());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (d: DetectedProvider) => {
    await addProvider({
      kind: d.kind,
      name: d.display_name,
      base_url: d.base_url,
      uses_api_key: false,
    });
    onAdded();
  };

  return (
    <Card title="Auto-detect local providers">
      <div className="ahd-row">
        <Button onClick={handleScan} disabled={busy}>
          {busy ? "Scanning…" : "Scan localhost"}
        </Button>
        {detected !== null && <small>{detected.length} found</small>}
      </div>
      {error && <div style={{ color: "salmon" }}>{error}</div>}
      {detected && detected.length > 0 && (
        <div className="ahd-stack" style={{ marginTop: 8 }}>
          {detected.map((d) => (
            <div key={d.base_url} className="ahd-row">
              <div className="ahd-grow">
                <strong>{d.display_name}</strong> <small>{d.base_url}</small>
              </div>
              <Button onClick={() => handleAdd(d)}>Add</Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
