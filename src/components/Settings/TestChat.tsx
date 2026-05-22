import { useCallback, useEffect, useState } from "react";
import { listModels, listProviderConfigs, testChat } from "../../lib/tauri";
import type { ProviderConfig, ModelInfo } from "../../lib/types";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";
import { Input } from "../shared/Input";
import { Select } from "../shared/Select";

export function TestChat({
  refreshToken,
  onChatComplete,
}: {
  refreshToken: number;
  onChatComplete?: () => void;
}) {
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
  const [autoUnload, setAutoUnload] = useState(false);

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
      const keepAlive = autoUnload ? "0" : undefined;
      const resp = await testChat(providerId, model, prompt, keepAlive);
      setResponse(resp.content);
      onChatComplete?.();
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
              <div
                style={{
                  color: "var(--fg-dim)",
                  fontSize: "var(--fs-xs)",
                  marginLeft: 90,
                  fontFamily: "var(--font-mono)",
                }}
              >
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

            <div
              style={{
                color: "var(--fg-dim)",
                fontSize: "var(--fs-xs)",
                marginLeft: 90,
              }}
            >
              {modelsLoading
                ? "Listing models…"
                : modelsError
                ? null
                : `${models.length} model${models.length === 1 ? "" : "s"} available`}
            </div>

            {modelsError && (
              <div
                style={{
                  color: "var(--danger)",
                  fontSize: "var(--fs-sm)",
                  background: "#2a1414",
                  padding: 10,
                  borderRadius: "var(--radius-md)",
                  border: "1px solid #5a2a2a",
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-mono)",
                  lineHeight: 1.45,
                }}
              >
                <strong style={{ fontFamily: "var(--font-sans)" }}>
                  list_models failed:
                </strong>
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

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: "var(--fs-sm)",
                color: "var(--fg-muted)",
                cursor: "pointer",
                minWidth: "auto",
              }}
            >
              <input
                type="checkbox"
                checked={autoUnload}
                onChange={(e) => setAutoUnload(e.target.checked)}
              />
              Auto-unload model after each chat (frees VRAM immediately; next chat will re-load)
            </label>

            {!model && !modelsLoading && !modelsError && providerId && (
              <div style={{ color: "var(--fg-dim)", fontSize: "var(--fs-xs)" }}>
                Send is disabled because no model is selected. Pull a model with
                <code>ollama pull &lt;name&gt;</code>
                then click Refresh.
              </div>
            )}

            {error && (
              <div
                style={{
                  color: "var(--danger)",
                  background: "#2a1414",
                  padding: 10,
                  borderRadius: "var(--radius-md)",
                  border: "1px solid #5a2a2a",
                  whiteSpace: "pre-wrap",
                  fontSize: "var(--fs-sm)",
                  fontFamily: "var(--font-mono)",
                  lineHeight: 1.45,
                }}
              >
                <strong style={{ fontFamily: "var(--font-sans)" }}>
                  chat failed:
                </strong>
                <br />
                {error}
              </div>
            )}

            {response && (
              <div className="ahd-card">
                <strong>Response:</strong>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    marginTop: 8,
                    fontFamily: "var(--font-sans)",
                    fontSize: "var(--fs-md)",
                    lineHeight: 1.55,
                  }}
                >
                  {response}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
