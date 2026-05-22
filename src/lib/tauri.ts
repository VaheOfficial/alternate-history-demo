import { invoke } from "@tauri-apps/api/core";
import type {
  ProviderConfig,
  ModelInfo,
  ChatResponse,
  DetectedProvider,
} from "./types";

export function listProviderConfigs() {
  return invoke<ProviderConfig[]>("list_provider_configs");
}

export function addProvider(
  config: Omit<ProviderConfig, "id"> & { id?: string },
  api_key?: string,
) {
  const c: ProviderConfig = {
    id: config.id ?? "00000000-0000-0000-0000-000000000000",
    kind: config.kind,
    name: config.name,
    base_url: config.base_url,
    uses_api_key: !!api_key || config.uses_api_key,
  };
  return invoke<ProviderConfig>("add_provider", {
    config: c,
    apiKey: api_key ?? null,
  });
}

export function removeProvider(id: string) {
  return invoke<void>("remove_provider", { id });
}

export function listModels(provider_id: string) {
  return invoke<ModelInfo[]>("list_models", { providerId: provider_id });
}

export function testChat(provider_id: string, model: string, prompt: string) {
  return invoke<ChatResponse>("test_chat", {
    providerId: provider_id,
    model,
    prompt,
  });
}

export function detectLocalProviders() {
  return invoke<DetectedProvider[]>("detect_local_providers");
}

export function getDefaultProvider() {
  return invoke<[string, string | null] | null>("get_default_provider");
}

export function setDefaultProvider(id: string, model: string | null) {
  return invoke<void>("set_default_provider", { id, model });
}
