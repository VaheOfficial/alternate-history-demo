import { useEffect, useState } from "react";
import { listModels, listProviderConfigs, testChat } from "../../lib/tauri";
import type { ProviderConfig, ModelInfo } from "../../lib/types";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";
import { Input } from "../shared/Input";
import { Select } from "../shared/Select";

export function TestChat({ refreshToken }: { refreshToken: number }) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<string>("");
  const [prompt, setPrompt] = useState("Say hi in 5 words.");
  const [response, setResponse] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProviderConfigs().then((p) => {
      setProviders(p);
      if (p.length && !providerId) {
        setProviderId(p[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    if (!providerId) {
      setModels([]);
      setModel("");
      return;
    }
    setError(null);
    listModels(providerId)
      .then((m) => {
        setModels(m);
        if (m.length) setModel(m[0].id);
        else setModel("");
      })
      .catch((e) => setError(String(e)));
  }, [providerId]);

  const handleSend = async () => {
    if (!providerId || !model) return;
    setBusy(true);
    setError(null);
    setResponse(null);
    try {
      const resp = await testChat(providerId, model, prompt);
      setResponse(resp.content);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Test chat">
      <div className="ahd-stack">
        <div className="ahd-row">
          <label>Provider</label>
          <Select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="ahd-grow"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="ahd-row">
          <label>Model</label>
          <Select value={model} onChange={(e) => setModel(e.target.value)} className="ahd-grow">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name ?? m.id}
              </option>
            ))}
          </Select>
        </div>
        <div className="ahd-row">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="ahd-grow"
          />
          <Button onClick={handleSend} disabled={busy || !providerId || !model}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
        {error && <div style={{ color: "salmon" }}>{error}</div>}
        {response && (
          <div className="ahd-card">
            <strong>Response:</strong>
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{response}</pre>
          </div>
        )}
      </div>
    </Card>
  );
}
