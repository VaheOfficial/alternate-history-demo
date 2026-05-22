import { useState, FormEvent } from "react";
import { addProvider } from "../../lib/tauri";
import type { ProviderConfig, ProviderKind } from "../../lib/types";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";
import { Input } from "../shared/Input";
import { Select } from "../shared/Select";

const KIND_DEFAULTS: Record<ProviderKind, { base_url: string; needs_key: boolean }> = {
  ollama: { base_url: "http://localhost:11434", needs_key: false },
  openai_compatible: { base_url: "", needs_key: false },
  openai: { base_url: "https://api.openai.com", needs_key: true },
  anthropic: { base_url: "https://api.anthropic.com", needs_key: true },
  lm_studio: { base_url: "http://localhost:1234", needs_key: false },
  llama_cpp: { base_url: "http://localhost:8080", needs_key: false },
  kobold_cpp: { base_url: "http://localhost:5001", needs_key: false },
};

export function AddProvider({ onAdded }: { onAdded: () => void }) {
  const [kind, setKind] = useState<ProviderKind>("ollama");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(KIND_DEFAULTS["ollama"].base_url);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleKind = (k: ProviderKind) => {
    setKind(k);
    setBaseUrl(KIND_DEFAULTS[k].base_url);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const cfg: Omit<ProviderConfig, "id"> = {
        kind,
        name: name || kind,
        base_url: baseUrl,
        uses_api_key: KIND_DEFAULTS[kind].needs_key,
      };
      await addProvider(cfg, KIND_DEFAULTS[kind].needs_key ? apiKey : undefined);
      setName("");
      setApiKey("");
      onAdded();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add provider">
      <form onSubmit={handleSubmit} className="ahd-stack">
        <div className="ahd-row">
          <label>Type</label>
          <Select value={kind} onChange={(e) => handleKind(e.target.value as ProviderKind)}>
            <option value="ollama">Ollama</option>
            <option value="openai_compatible">OpenAI-compatible</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="lm_studio">LM Studio</option>
            <option value="llama_cpp">llama.cpp</option>
            <option value="kobold_cpp">KoboldCpp</option>
          </Select>
        </div>
        <div className="ahd-row">
          <label>Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind}
            className="ahd-grow"
          />
        </div>
        <div className="ahd-row">
          <label>Base URL</label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="ahd-grow" />
        </div>
        {KIND_DEFAULTS[kind].needs_key && (
          <div className="ahd-row">
            <label>API key</label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="ahd-grow"
            />
          </div>
        )}
        {error && <div style={{ color: "salmon" }}>{error}</div>}
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Add"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
