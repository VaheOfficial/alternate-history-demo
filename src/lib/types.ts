export type ProviderKind =
  | "ollama"
  | "openai_compatible"
  | "openai"
  | "anthropic"
  | "lm_studio"
  | "llama_cpp"
  | "kobold_cpp";

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  base_url: string;
  uses_api_key: boolean;
}

export interface ModelInfo {
  id: string;
  display_name: string | null;
  context_length: number | null;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

export interface DetectedProvider {
  kind: ProviderKind;
  display_name: string;
  base_url: string;
  probe_path: string;
}
