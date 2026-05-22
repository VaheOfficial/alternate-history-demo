import { useCallback, useEffect, useState } from "react";
import { listLoadedModels, listProviderConfigs, unloadModel } from "../../lib/tauri";
import type { LoadedModel, ProviderConfig } from "../../lib/types";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";

interface ProviderLoadedSet {
  provider: ProviderConfig;
  loaded: LoadedModel[] | null; // null = provider doesn't support introspection
  error: string | null;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatExpires(iso: string | null): string {
  if (!iso) return "no auto-unload";
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.round((t - now) / 1000);
  if (diff <= 0) return "expiring now";
  if (diff < 60) return `unloads in ${diff}s`;
  if (diff < 3600) return `unloads in ${Math.round(diff / 60)}m`;
  return `unloads in ${Math.round(diff / 3600)}h`;
}

export function LoadedModels({ refreshToken }: { refreshToken: number }) {
  const [sets, setSets] = useState<ProviderLoadedSet[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const providers = await listProviderConfigs();
      const results = await Promise.all(
        providers.map(async (p): Promise<ProviderLoadedSet> => {
          try {
            const loaded = await listLoadedModels(p.id);
            return { provider: p, loaded, error: null };
          } catch (e) {
            return { provider: p, loaded: [], error: String(e) };
          }
        }),
      );
      setSets(results);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshToken]);

  const handleUnload = async (providerId: string, model: string) => {
    setBusy(true);
    try {
      await unloadModel(providerId, model);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // Only show this card when at least one provider supports introspection.
  const supported = sets.filter((s) => s.loaded !== null);
  if (supported.length === 0) return null;

  return (
    <Card title="Loaded models (VRAM)">
      <div className="ahd-row" style={{ marginBottom: 8 }}>
        <Button onClick={refresh} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </Button>
        <small style={{ color: "#888" }}>
          Shows models currently held in memory. Click Unload to free VRAM.
        </small>
      </div>
      <div className="ahd-stack">
        {supported.map((s) => (
          <div key={s.provider.id} className="ahd-card">
            <strong>{s.provider.name}</strong>{" "}
            <small style={{ color: "#888" }}>({s.provider.kind})</small>
            {s.error && (
              <div style={{ color: "salmon", marginTop: 4 }}>{s.error}</div>
            )}
            {!s.error && s.loaded && s.loaded.length === 0 && (
              <div style={{ color: "#888", marginTop: 4 }}>None loaded.</div>
            )}
            {!s.error && s.loaded && s.loaded.length > 0 && (
              <div className="ahd-stack" style={{ marginTop: 6 }}>
                {s.loaded.map((m) => (
                  <div key={m.model} className="ahd-row">
                    <div className="ahd-grow">
                      <strong>{m.model}</strong>{" "}
                      <small style={{ color: "#888" }}>
                        {formatBytes(m.size_bytes)} · {formatExpires(m.expires_at)}
                      </small>
                    </div>
                    <Button
                      onClick={() => handleUnload(s.provider.id, m.model)}
                      disabled={busy}
                    >
                      Unload
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
