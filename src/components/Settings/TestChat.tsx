import { useCallback, useEffect, useState } from "react";
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
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    listProviderConfigs().then((p) => {
      setProviders(p);
      if (p.length && !providerId) {
        setProviderId(p[0].id);
      } else if (!p.length) {
        setProviderId("");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const fetchModels = useCallback((pid: string) => {
    if (!pid) {
      setModels([]);
      setModel("");
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    listModels(pid)
      .then((m) => {
        setModels(m);
        if (m.length) setModel(m[0].id);
        else setModel("");
      })
      .catch((e) => {
        setModels([]);
        setModel("");
        setModelsError(String(e));
      })
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    fetchModels(providerId);
  }, [providerId, fetchModels]);

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

  const selectedProvider = providers.find((p) => p.id === providerId);

  return (
    <Card title="Test chat">
      <div className="ahd-stack">
        {providers.length === 0 && (
          <div style={{ color: "#aaa" }}>
            No providers configured yet. Add one above first.
          </div>
        )}

        {providers.length > 0 && (
          <>
            <div className="ahd-row">
              <label>Provider</label>
              <Select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="ahd-grow"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.kind})
                  </option>
                ))}
              </Select>
            </div>

            {selectedProvider && (
              <div style={{ color: "#888", fontSize: "0.8rem", marginLeft: 80 }}>
                {selectedProvider.base_url}
              </div>
            )}

            <div className="ahd-row">
              <label>Model</label>
              <Select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="ahd-grow"
                disabled={modelsLoading || models.length === 0}
              >
                {models.length === 0 && (
                  <option value="">
                    {modelsLoading ? "Loading…" : "(no models)"}
                  </option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name ?? m.id}
                  </option>
                ))}
              </Select>
              <Button onClick={() => fetchModels(providerId)} disabled={modelsLoading}>
                {modelsLoading ? "…" : "Refresh"}
              </Button>
            </div>

            <div style={{ color: "#888", fontSize: "0.8rem", marginLeft: 80 }}>
              {modelsLoading
                ? "Listing models…"
                : modelsError
                ? null
                : `${models.length} model${models.length === 1 ? "" : "s"} available`}
            </div>

            {modelsError && (
              <div
                style={{
                  color: "salmon",
                  fontSize: "0.85rem",
                  background: "#2a1414",
                  padding: 8,
                  borderRadius: 4,
                  border: "1px solid #5a2a2a",
                  whiteSpace: "pre-wrap",
                }}
              >
                <strong>list_models failed:</strong>
                <br />
                {modelsError}
              </div>
            )}

            <div className="ahd-row">
              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="ahd-grow"
              />
              <Button
                onClick={handleSend}
                disabled={busy || !providerId || !model}
              >
                {busy ? "Sending…" : "Send"}
              </Button>
            </div>

            {!model && !modelsLoading && !modelsError && providerId && (
              <div style={{ color: "#888", fontSize: "0.8rem" }}>
                Send is disabled because no model is selected. Pull a model with
                <code style={{ background: "#222", padding: "1px 4px", margin: "0 4px" }}>
                  ollama pull &lt;name&gt;
                </code>
                then click Refresh.
              </div>
            )}

            {error && (
              <div
                style={{
                  color: "salmon",
                  background: "#2a1414",
                  padding: 8,
                  borderRadius: 4,
                  border: "1px solid #5a2a2a",
                  whiteSpace: "pre-wrap",
                }}
              >
                <strong>chat failed:</strong>
                <br />
                {error}
              </div>
            )}

            {response && (
              <div className="ahd-card">
                <strong>Response:</strong>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{response}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
