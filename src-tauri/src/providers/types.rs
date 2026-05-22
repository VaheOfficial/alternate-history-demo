use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Ollama,
    OpenAiCompatible,
    OpenAi,
    Anthropic,
    LmStudio,
    LlamaCpp,
    KoboldCpp,
}

impl ProviderKind {
    pub fn display_name(&self) -> &'static str {
        match self {
            ProviderKind::Ollama => "Ollama",
            ProviderKind::OpenAiCompatible => "OpenAI-Compatible",
            ProviderKind::OpenAi => "OpenAI",
            ProviderKind::Anthropic => "Anthropic",
            ProviderKind::LmStudio => "LM Studio",
            ProviderKind::LlamaCpp => "llama.cpp",
            ProviderKind::KoboldCpp => "KoboldCpp",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub stream: bool,
    /// Provider-specific keep-alive directive. Ollama: "5m", "0" (unload now),
    /// "-1" (never unload), or duration string. Ignored by providers that
    /// don't support the concept (cloud providers, etc.).
    #[serde(default)]
    pub keep_alive: Option<String>,
    /// When set to `"json"`, the provider is instructed to force JSON output.
    /// Ollama: sets `format: "json"`. OpenAI: `response_format: {type: "json_object"}`.
    /// Anthropic + others without strict JSON mode rely on prompt + parser
    /// resilience.
    #[serde(default)]
    pub response_format: Option<String>,
    /// Ollama only: context window size (`num_ctx`). Use to keep enough
    /// room for reasoning models to think AND emit an answer. When None,
    /// provider uses its own default (usually 2048 — too small).
    #[serde(default)]
    pub num_ctx: Option<u32>,
    /// Ollama only: whether to allow the model's thinking/reasoning mode.
    /// On thinking models (gemma4, deepseek-r1, qwen-r1) this hides the
    /// trace and forces the model to emit straight content. Disable when
    /// the GPU can't fit enough context for both reasoning + answer.
    #[serde(default)]
    pub allow_thinking: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
    pub usage: Option<UsageStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageStats {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChunk {
    /// Delta text for this chunk.
    pub delta: String,
    /// True on the final chunk.
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: Option<String>,
    pub context_length: Option<u32>,
}

/// A model currently held in VRAM/RAM by the provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadedModel {
    pub model: String,
    pub size_bytes: u64,
    /// ISO-8601 timestamp at which the provider plans to unload this model.
    /// `None` means "no expiry" (kept indefinitely) or "unknown".
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: Uuid,
    pub kind: ProviderKind,
    pub name: String,
    pub base_url: String,
    /// True when an API key is required and stored in keyring under this id.
    pub uses_api_key: bool,
}
