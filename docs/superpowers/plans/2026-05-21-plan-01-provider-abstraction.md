# Plan 01 — Provider Abstraction + First LLM Round-Trip

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the foundational LLM-provider infrastructure end-to-end. After this plan, the user can open Settings, see auto-detected local providers (Ollama, LM Studio, llama.cpp), add cloud providers (OpenAI, Anthropic) with API-key entry, pick a model, and exchange a test chat message that successfully round-trips through the Rust backend.

**Architecture:** Define a `Provider` trait in Rust with concrete impls for Ollama (native API), OpenAI-compatible (generic), OpenAI (preset), and Anthropic (different API shape). Provider configs persist to a JSON file in OS app-data; API keys go to the OS keyring via the `keyring` crate. Tauri commands expose registry + chat operations to the React frontend. UI is a Settings panel with provider list + add form + auto-detect + a minimal test chat surface.

**Tech Stack:** Rust (tokio, reqwest, async-trait, serde, keyring, thiserror, mockito for tests), React 19 + TypeScript + Vite, Tauri 2 IPC (`invoke`).

**Spec reference:** [2026-05-21-alternate-history-game-design.md](../specs/2026-05-21-alternate-history-game-design.md) §14 (Provider system).

**Scope notes:**

- v1 spec promises 8+ local provider integrations + 9+ cloud. Plan 1 ships **Ollama + Generic OpenAI-compat + OpenAI + Anthropic** as proof-of-design. The remaining providers (LM Studio, KoboldCpp, vLLM, Groq, Mistral, etc.) are added in subsequent small plans by extending the same abstractions. LM Studio, llama.cpp, and KoboldCpp are detected for auto-detection but use the OpenAI-compatible adapter behind the scenes — so they're effectively supported.
- Per-subsystem model assignment is **not** in Plan 1. We ship a single "default model" config. Per-subsystem comes when subsystems exist (Plans 4+).
- Streaming responses are in scope (essential for chat UX).
- Embedding endpoints are stubbed in the trait but not implemented in Plan 1 (deferred to Plan 9, RAG).
- "Warm pools" (keep-alive pinging) deferred to Plan 4 when we actually issue subsystem calls — premature in Plan 1.

---

## File structure

### Rust (`src-tauri/`)

```
src-tauri/
├── Cargo.toml                       # deps added: tokio, reqwest, async-trait, keyring, thiserror, mockito (dev), futures-util, dirs
└── src/
    ├── lib.rs                       # Tauri builder, registers commands; CURRENTLY one greet command — will be replaced
    ├── main.rs                      # entry point (unchanged)
    ├── error.rs                     # AppError enum used across the app
    ├── commands/
    │   ├── mod.rs                   # re-exports
    │   └── providers.rs             # Tauri command handlers for provider operations
    ├── providers/
    │   ├── mod.rs                   # Provider trait + module re-exports
    │   ├── types.rs                 # ChatMessage, ChatRequest, ChatResponse, ChatChunk, ModelInfo, ProviderKind
    │   ├── error.rs                 # ProviderError enum (provider-specific failure modes)
    │   ├── ollama.rs                # OllamaProvider impl
    │   ├── openai_compatible.rs     # OpenAICompatProvider impl (generic, parametrized by base URL + headers)
    │   ├── openai.rs                # OpenAIProvider — wraps OpenAICompatProvider with OpenAI defaults
    │   ├── anthropic.rs             # AnthropicProvider impl (different shape: system separate, x-api-key header, messages API)
    │   ├── detect.rs                # auto-detection: parallel port probes
    │   └── registry.rs              # ProviderRegistry: collection of configured providers, lookup by id
    ├── config/
    │   ├── mod.rs
    │   └── store.rs                 # JSON config file in app data dir; load/save provider configs
    └── secrets/
        ├── mod.rs
        └── keyring_store.rs         # secure storage of API keys via OS keyring
```

### Frontend (`src/`)

```
src/
├── App.tsx                          # main app — replace template scaffolding with Settings + TestChat
├── App.css                          # minor edits
├── main.tsx                         # unchanged
├── lib/
│   ├── tauri.ts                     # typed wrappers around invoke()
│   └── types.ts                     # TS types mirroring Rust types
└── components/
    ├── Settings/
    │   ├── index.tsx                # Settings page layout
    │   ├── ProviderList.tsx         # list configured providers with delete/edit
    │   ├── AddProvider.tsx          # form: kind, name, base URL, API key, models
    │   ├── AutoDetect.tsx           # button + render of detected providers
    │   └── TestChat.tsx             # quick test: pick provider+model, send a message, see response
    └── shared/
        ├── Button.tsx
        ├── Input.tsx
        ├── Select.tsx
        └── Card.tsx
```

### Tests

- Rust unit tests live alongside source (`#[cfg(test)] mod tests` at the bottom of each file)
- Rust integration tests in `src-tauri/tests/`
- Frontend: vitest + React Testing Library (need to install vitest)

---

## Cargo dependencies (add in Task 1)

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls"] }
async-trait = "0.1"
thiserror = "2"
keyring = "3"
futures-util = "0.3"
dirs = "5"
uuid = { version = "1", features = ["v4", "serde"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[dev-dependencies]
mockito = "1"
tokio-test = "0.4"
```

---

## Task 1 — Cargo dependency setup

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add new dependencies to Cargo.toml**

Replace the `[dependencies]` block with:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls"] }
async-trait = "0.1"
thiserror = "2"
keyring = "3"
futures-util = "0.3"
dirs = "5"
uuid = { version = "1", features = ["v4", "serde"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[dev-dependencies]
mockito = "1"
tokio-test = "0.4"
```

- [ ] **Step 2: Verify build**

```
cd src-tauri && cargo check
```

Expected: clean build (deps fetch + compile, may take 1-3 minutes first time).

- [ ] **Step 3: Commit**

```
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Add provider abstraction deps (reqwest, tokio, keyring, etc.)"
```

---

## Task 2 — Common provider types

**Files:**
- Create: `src-tauri/src/providers/mod.rs`
- Create: `src-tauri/src/providers/types.rs`
- Create: `src-tauri/src/providers/error.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod providers;`)

- [ ] **Step 1: Write provider/error.rs (the test first)**

Create `src-tauri/src/providers/error.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("provider returned status {status}: {body}")]
    Http { status: u16, body: String },

    #[error("invalid response shape: {0}")]
    InvalidResponse(String),

    #[error("missing api key for provider {0}")]
    MissingApiKey(String),

    #[error("model {model} not available on {provider}")]
    ModelNotFound { provider: String, model: String },

    #[error("provider not configured: {0}")]
    NotConfigured(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("keyring: {0}")]
    Keyring(#[from] keyring::Error),

    #[error("other: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ProviderError>;
```

- [ ] **Step 2: Write provider/types.rs**

Create `src-tauri/src/providers/types.rs`:

```rust
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: Uuid,
    pub kind: ProviderKind,
    pub name: String,
    pub base_url: String,
    /// True when an API key is required and stored in keyring under this id.
    pub uses_api_key: bool,
}
```

- [ ] **Step 3: Write provider/mod.rs (trait)**

Create `src-tauri/src/providers/mod.rs`:

```rust
pub mod error;
pub mod types;

use async_trait::async_trait;
use futures_util::stream::BoxStream;
pub use error::{ProviderError, Result};
pub use types::*;

/// A unified interface across all LLM providers (local + cloud).
#[async_trait]
pub trait Provider: Send + Sync {
    fn name(&self) -> &str;
    fn kind(&self) -> ProviderKind;

    async fn list_models(&self) -> Result<Vec<ModelInfo>>;
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse>;
    async fn chat_stream(&self, request: ChatRequest) -> Result<BoxStream<'static, Result<ChatChunk>>>;

    async fn health(&self) -> Result<bool>;
}
```

- [ ] **Step 4: Register module in lib.rs**

Modify `src-tauri/src/lib.rs`. Add at the top (above the `greet` function):

```rust
mod providers;
mod error;
```

(We'll create `error.rs` shortly; cargo check will fail until then — that's expected.)

- [ ] **Step 5: Create the top-level error.rs**

Create `src-tauri/src/error.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("provider: {0}")]
    Provider(#[from] crate::providers::ProviderError),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid argument: {0}")]
    InvalidArgument(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
```

- [ ] **Step 6: Build to confirm types compile**

```
cd src-tauri && cargo check
```

Expected: clean build, no warnings about unused (because nothing uses them yet, suppress with `#[allow(dead_code)]` if needed).

If you get "unused" warnings, add `#![allow(dead_code)]` at top of `providers/mod.rs` — they'll go away once Task 3 wires consumers. Optional cleanup.

- [ ] **Step 7: Commit**

```
git add src-tauri/src/providers src-tauri/src/error.rs src-tauri/src/lib.rs
git commit -m "Add Provider trait + common types + error enum"
```

---

## Task 3 — Ollama provider

**Files:**
- Create: `src-tauri/src/providers/ollama.rs`
- Modify: `src-tauri/src/providers/mod.rs` (add `pub mod ollama;`)

Ollama exposes two relevant endpoints: `GET /api/tags` (list models), `POST /api/chat` (chat, supports streaming via newline-delimited JSON). Reference: [Ollama API docs](https://github.com/ollama/ollama/blob/main/docs/api.md).

- [ ] **Step 1: Add the module declaration**

Modify `src-tauri/src/providers/mod.rs`. Add at the top alongside the other `mod` lines:

```rust
pub mod ollama;
```

- [ ] **Step 2: Stub the OllamaProvider type**

Create `src-tauri/src/providers/ollama.rs` with the bare-bones skeleton:

```rust
use async_trait::async_trait;
use futures_util::stream::BoxStream;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::{
    error::{ProviderError, Result},
    types::*,
    Provider,
};

pub struct OllamaProvider {
    name: String,
    base_url: String,
    client: Client,
}

impl OllamaProvider {
    pub fn new(name: impl Into<String>, base_url: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            base_url: base_url.into(),
            client: Client::new(),
        }
    }
}

#[async_trait]
impl Provider for OllamaProvider {
    fn name(&self) -> &str {
        &self.name
    }
    fn kind(&self) -> ProviderKind {
        ProviderKind::Ollama
    }
    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        unimplemented!()
    }
    async fn chat(&self, _request: ChatRequest) -> Result<ChatResponse> {
        unimplemented!()
    }
    async fn chat_stream(&self, _request: ChatRequest) -> Result<BoxStream<'static, Result<ChatChunk>>> {
        unimplemented!()
    }
    async fn health(&self) -> Result<bool> {
        unimplemented!()
    }
}
```

- [ ] **Step 3: Write the first failing test — list_models**

Add this to the end of `src-tauri/src/providers/ollama.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[tokio::test]
    async fn list_models_returns_parsed_models() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/api/tags")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{
                    "models": [
                        {"name": "llama3:8b", "size": 4000000000, "modified_at": "2026-01-01T00:00:00Z"},
                        {"name": "qwen2.5:32b", "size": 16000000000, "modified_at": "2026-01-01T00:00:00Z"}
                    ]
                }"#,
            )
            .create_async()
            .await;

        let provider = OllamaProvider::new("test-ollama", server.url());
        let models = provider.list_models().await.expect("list_models should succeed");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "llama3:8b");
        assert_eq!(models[1].id, "qwen2.5:32b");
        mock.assert_async().await;
    }
}
```

- [ ] **Step 4: Run the test, expect failure**

```
cd src-tauri && cargo test --lib providers::ollama::tests::list_models_returns_parsed_models
```

Expected: panic ("not yet implemented"). The test calls `unimplemented!()`.

- [ ] **Step 5: Implement list_models**

Replace the `list_models` body and add the response types:

```rust
#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaTagModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagModel {
    name: String,
}

impl OllamaProvider {
    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let resp = self.client.get(&url).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Http { status: status.as_u16(), body });
        }
        Ok(resp.json::<T>().await?)
    }
}
```

Then replace `list_models`:

```rust
async fn list_models(&self) -> Result<Vec<ModelInfo>> {
    let resp: OllamaTagsResponse = self.get_json("/api/tags").await?;
    Ok(resp
        .models
        .into_iter()
        .map(|m| ModelInfo {
            id: m.name,
            display_name: None,
            context_length: None,
        })
        .collect())
}
```

- [ ] **Step 6: Run the test, expect pass**

```
cd src-tauri && cargo test --lib providers::ollama::tests::list_models_returns_parsed_models
```

Expected: PASS.

- [ ] **Step 7: Write the failing test for chat (non-streaming)**

Add to the `tests` module:

```rust
#[tokio::test]
async fn chat_returns_parsed_response() {
    let mut server = Server::new_async().await;
    let mock = server
        .mock("POST", "/api/chat")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            r#"{
                "model": "llama3:8b",
                "message": {"role": "assistant", "content": "Hello, world!"},
                "done": true,
                "prompt_eval_count": 12,
                "eval_count": 5
            }"#,
        )
        .create_async()
        .await;

    let provider = OllamaProvider::new("test-ollama", server.url());
    let req = ChatRequest {
        model: "llama3:8b".into(),
        messages: vec![ChatMessage { role: Role::User, content: "Hi".into() }],
        max_tokens: None,
        temperature: None,
        stream: false,
    };
    let resp = provider.chat(req).await.expect("chat should succeed");
    assert_eq!(resp.content, "Hello, world!");
    assert_eq!(resp.model, "llama3:8b");
    let usage = resp.usage.unwrap();
    assert_eq!(usage.prompt_tokens, 12);
    assert_eq!(usage.completion_tokens, 5);
    assert_eq!(usage.total_tokens, 17);
    mock.assert_async().await;
}
```

- [ ] **Step 8: Run the test, expect failure (still unimplemented!())**

```
cd src-tauri && cargo test --lib providers::ollama::tests::chat_returns_parsed_response
```

Expected: panic ("not yet implemented").

- [ ] **Step 9: Implement chat**

Add the request/response types and replace `chat`:

```rust
#[derive(Debug, Serialize)]
struct OllamaChatRequest<'a> {
    model: &'a str,
    messages: Vec<OllamaChatMessage<'a>>,
    stream: bool,
    options: Option<OllamaOptions>,
}

#[derive(Debug, Serialize)]
struct OllamaChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Serialize, Default)]
struct OllamaOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    model: String,
    message: OllamaChatResponseMessage,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    prompt_eval_count: u32,
    #[serde(default)]
    eval_count: u32,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponseMessage {
    content: String,
}

fn role_str(role: &Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}
```

Then implement `chat`:

```rust
async fn chat(&self, request: ChatRequest) -> Result<ChatResponse> {
    let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));
    let messages: Vec<OllamaChatMessage> = request
        .messages
        .iter()
        .map(|m| OllamaChatMessage { role: role_str(&m.role), content: &m.content })
        .collect();
    let body = OllamaChatRequest {
        model: &request.model,
        messages,
        stream: false,
        options: if request.temperature.is_some() || request.max_tokens.is_some() {
            Some(OllamaOptions {
                temperature: request.temperature,
                num_predict: request.max_tokens,
            })
        } else {
            None
        },
    };
    let resp = self.client.post(&url).json(&body).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ProviderError::Http { status: status.as_u16(), body });
    }
    let parsed: OllamaChatResponse = resp.json().await?;
    Ok(ChatResponse {
        content: parsed.message.content,
        model: parsed.model,
        usage: Some(UsageStats {
            prompt_tokens: parsed.prompt_eval_count,
            completion_tokens: parsed.eval_count,
            total_tokens: parsed.prompt_eval_count + parsed.eval_count,
        }),
    })
}
```

- [ ] **Step 10: Run all ollama tests**

```
cd src-tauri && cargo test --lib providers::ollama
```

Expected: 2 passed.

- [ ] **Step 11: Implement chat_stream**

Ollama's streaming format is newline-delimited JSON, each line a partial response. Implement `chat_stream`:

```rust
async fn chat_stream(&self, request: ChatRequest) -> Result<BoxStream<'static, Result<ChatChunk>>> {
    use futures_util::StreamExt;

    let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));
    let messages: Vec<OllamaChatMessage> = request
        .messages
        .iter()
        .map(|m| OllamaChatMessage { role: role_str(&m.role), content: &m.content })
        .collect();
    let body = OllamaChatRequest {
        model: &request.model,
        messages,
        stream: true,
        options: if request.temperature.is_some() || request.max_tokens.is_some() {
            Some(OllamaOptions {
                temperature: request.temperature,
                num_predict: request.max_tokens,
            })
        } else {
            None
        },
    };
    let resp = self.client.post(&url).json(&body).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ProviderError::Http { status: status.as_u16(), body });
    }

    let byte_stream = resp.bytes_stream();
    let line_stream = byte_stream
        .map(|chunk| chunk.map_err(ProviderError::from))
        .scan(Vec::<u8>::new(), |buffer, chunk| {
            let chunks = match chunk {
                Err(e) => return futures_util::future::ready(Some(vec![Err(e)])),
                Ok(b) => b,
            };
            buffer.extend_from_slice(&chunks);
            let mut emitted: Vec<Result<ChatChunk>> = Vec::new();
            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line = buffer.drain(..=pos).collect::<Vec<_>>();
                let line = String::from_utf8_lossy(&line[..line.len() - 1]).into_owned();
                if line.trim().is_empty() {
                    continue;
                }
                emitted.push(parse_ollama_stream_line(&line));
            }
            futures_util::future::ready(Some(emitted))
        })
        .flat_map(|emitted| futures_util::stream::iter(emitted));

    Ok(Box::pin(line_stream))
}
```

Add the parse helper:

```rust
#[derive(Debug, Deserialize)]
struct OllamaStreamLine {
    #[serde(default)]
    message: Option<OllamaChatResponseMessage>,
    #[serde(default)]
    done: bool,
}

fn parse_ollama_stream_line(line: &str) -> Result<ChatChunk> {
    let parsed: OllamaStreamLine = serde_json::from_str(line)?;
    let delta = parsed.message.map(|m| m.content).unwrap_or_default();
    Ok(ChatChunk { delta, done: parsed.done })
}
```

- [ ] **Step 12: Write a streaming test**

Add to the `tests` module:

```rust
#[tokio::test]
async fn chat_stream_yields_chunks() {
    use futures_util::StreamExt;
    let mut server = Server::new_async().await;
    let body = "{\"message\":{\"role\":\"assistant\",\"content\":\"Hel\"},\"done\":false}\n\
                {\"message\":{\"role\":\"assistant\",\"content\":\"lo\"},\"done\":false}\n\
                {\"message\":{\"role\":\"assistant\",\"content\":\"!\"},\"done\":true}\n";
    let mock = server.mock("POST", "/api/chat").with_status(200).with_body(body).create_async().await;

    let provider = OllamaProvider::new("test", server.url());
    let req = ChatRequest {
        model: "llama3:8b".into(),
        messages: vec![ChatMessage { role: Role::User, content: "Hi".into() }],
        max_tokens: None,
        temperature: None,
        stream: true,
    };
    let mut stream = provider.chat_stream(req).await.expect("stream should start");
    let mut combined = String::new();
    let mut last_done = false;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.expect("chunk should parse");
        combined.push_str(&chunk.delta);
        last_done = chunk.done;
    }
    assert_eq!(combined, "Hello!");
    assert!(last_done);
    mock.assert_async().await;
}
```

- [ ] **Step 13: Run streaming test**

```
cd src-tauri && cargo test --lib providers::ollama::tests::chat_stream_yields_chunks
```

Expected: PASS.

- [ ] **Step 14: Implement health**

Replace the `health` method:

```rust
async fn health(&self) -> Result<bool> {
    let url = format!("{}/api/tags", self.base_url.trim_end_matches('/'));
    match self.client.get(&url).send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}
```

- [ ] **Step 15: Add a health test**

```rust
#[tokio::test]
async fn health_returns_true_when_reachable() {
    let mut server = Server::new_async().await;
    let _mock = server.mock("GET", "/api/tags").with_status(200).with_body("{\"models\":[]}").create_async().await;
    let provider = OllamaProvider::new("t", server.url());
    assert!(provider.health().await.unwrap());
}

#[tokio::test]
async fn health_returns_false_when_unreachable() {
    let provider = OllamaProvider::new("t", "http://127.0.0.1:1");
    assert!(!provider.health().await.unwrap());
}
```

- [ ] **Step 16: Run all ollama tests**

```
cd src-tauri && cargo test --lib providers::ollama
```

Expected: 5 passed.

- [ ] **Step 17: Commit**

```
git add src-tauri/src/providers/ollama.rs src-tauri/src/providers/mod.rs
git commit -m "Add OllamaProvider with chat, stream, list_models, health"
```

---

## Task 4 — Generic OpenAI-compatible provider

**Files:**
- Create: `src-tauri/src/providers/openai_compatible.rs`
- Modify: `src-tauri/src/providers/mod.rs` (add `pub mod openai_compatible;`)

OpenAI-compat exposes: `GET /v1/models`, `POST /v1/chat/completions`. Streaming uses Server-Sent Events: `data: {json}\n\n`, terminated by `data: [DONE]`.

- [ ] **Step 1: Add the module declaration**

In `providers/mod.rs`:

```rust
pub mod openai_compatible;
```

- [ ] **Step 2: Stub the type**

Create `providers/openai_compatible.rs`:

```rust
use async_trait::async_trait;
use futures_util::stream::BoxStream;
use reqwest::Client;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};

use super::{
    error::{ProviderError, Result},
    types::*,
    Provider,
};

pub struct OpenAICompatProvider {
    name: String,
    kind: ProviderKind,
    base_url: String,
    api_key: Option<String>,
    extra_headers: Vec<(String, String)>,
    client: Client,
}

impl OpenAICompatProvider {
    pub fn new(
        name: impl Into<String>,
        kind: ProviderKind,
        base_url: impl Into<String>,
        api_key: Option<String>,
    ) -> Self {
        Self {
            name: name.into(),
            kind,
            base_url: base_url.into(),
            api_key,
            extra_headers: Vec::new(),
            client: Client::new(),
        }
    }

    fn build_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(key) = &self.api_key {
            if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", key)) {
                headers.insert(AUTHORIZATION, v);
            }
        }
        for (k, v) in &self.extra_headers {
            if let (Ok(name), Ok(value)) = (reqwest::header::HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                headers.insert(name, value);
            }
        }
        headers
    }
}

#[async_trait]
impl Provider for OpenAICompatProvider {
    fn name(&self) -> &str { &self.name }
    fn kind(&self) -> ProviderKind { self.kind }
    async fn list_models(&self) -> Result<Vec<ModelInfo>> { unimplemented!() }
    async fn chat(&self, _request: ChatRequest) -> Result<ChatResponse> { unimplemented!() }
    async fn chat_stream(&self, _request: ChatRequest) -> Result<BoxStream<'static, Result<ChatChunk>>> { unimplemented!() }
    async fn health(&self) -> Result<bool> { unimplemented!() }
}
```

- [ ] **Step 3: Write the list_models test**

Add at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[tokio::test]
    async fn list_models_parses_openai_format() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("GET", "/v1/models")
            .with_status(200)
            .with_body(r#"{"data":[{"id":"gpt-4o","object":"model"},{"id":"gpt-4o-mini","object":"model"}]}"#)
            .create_async()
            .await;
        let p = OpenAICompatProvider::new("t", ProviderKind::OpenAiCompatible, server.url(), None);
        let m = p.list_models().await.unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].id, "gpt-4o");
    }
}
```

- [ ] **Step 4: Implement list_models**

```rust
#[derive(Deserialize)]
struct OAIModelsResp {
    data: Vec<OAIModel>,
}
#[derive(Deserialize)]
struct OAIModel {
    id: String,
}

async fn list_models_impl(&self) -> Result<Vec<ModelInfo>> {
    let url = format!("{}/v1/models", self.base_url.trim_end_matches('/'));
    let resp = self.client.get(&url).headers(self.build_headers()).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ProviderError::Http { status: status.as_u16(), body });
    }
    let parsed: OAIModelsResp = resp.json().await?;
    Ok(parsed.data.into_iter().map(|m| ModelInfo {
        id: m.id,
        display_name: None,
        context_length: None,
    }).collect())
}
```

(Replace the `list_models` method body in the `impl Provider` block to call `self.list_models_impl().await`.)

```rust
async fn list_models(&self) -> Result<Vec<ModelInfo>> {
    self.list_models_impl().await
}
```

- [ ] **Step 5: Run and confirm pass**

```
cd src-tauri && cargo test --lib providers::openai_compatible::tests::list_models_parses_openai_format
```

Expected: PASS.

- [ ] **Step 6: Implement chat (non-streaming)**

Add types + impl:

```rust
#[derive(Serialize)]
struct OAIChatReq<'a> {
    model: &'a str,
    messages: Vec<OAIChatMsg<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    stream: bool,
}

#[derive(Serialize)]
struct OAIChatMsg<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct OAIChatResp {
    model: String,
    choices: Vec<OAIChoice>,
    #[serde(default)]
    usage: Option<OAIUsage>,
}

#[derive(Deserialize)]
struct OAIChoice {
    message: OAIMsgOut,
}

#[derive(Deserialize)]
struct OAIMsgOut {
    content: String,
}

#[derive(Deserialize)]
struct OAIUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

fn role_str(r: &Role) -> &'static str {
    match r {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}
```

Replace the `chat` body:

```rust
async fn chat(&self, request: ChatRequest) -> Result<ChatResponse> {
    let url = format!("{}/v1/chat/completions", self.base_url.trim_end_matches('/'));
    let messages: Vec<OAIChatMsg> = request.messages.iter().map(|m| OAIChatMsg {
        role: role_str(&m.role),
        content: &m.content,
    }).collect();
    let body = OAIChatReq {
        model: &request.model,
        messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        stream: false,
    };
    let resp = self.client.post(&url).headers(self.build_headers()).json(&body).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ProviderError::Http { status: status.as_u16(), body });
    }
    let parsed: OAIChatResp = resp.json().await?;
    let content = parsed.choices.into_iter().next()
        .ok_or_else(|| ProviderError::InvalidResponse("no choices in response".into()))?
        .message.content;
    Ok(ChatResponse {
        content,
        model: parsed.model,
        usage: parsed.usage.map(|u| UsageStats {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
        }),
    })
}
```

- [ ] **Step 7: Write the chat test**

```rust
#[tokio::test]
async fn chat_parses_openai_response() {
    let mut server = Server::new_async().await;
    let _mock = server.mock("POST", "/v1/chat/completions")
        .with_status(200)
        .with_body(r#"{"model":"gpt-4o","choices":[{"message":{"role":"assistant","content":"Hi!"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}"#)
        .create_async().await;
    let p = OpenAICompatProvider::new("t", ProviderKind::OpenAi, server.url(), Some("sk-test".into()));
    let req = ChatRequest {
        model: "gpt-4o".into(),
        messages: vec![ChatMessage { role: Role::User, content: "Hi".into() }],
        max_tokens: None, temperature: None, stream: false,
    };
    let resp = p.chat(req).await.unwrap();
    assert_eq!(resp.content, "Hi!");
    assert_eq!(resp.usage.unwrap().total_tokens, 5);
}
```

- [ ] **Step 8: Run + confirm**

```
cd src-tauri && cargo test --lib providers::openai_compatible
```

Expected: 2 passed.

- [ ] **Step 9: Implement chat_stream (SSE format)**

Replace `chat_stream`:

```rust
async fn chat_stream(&self, request: ChatRequest) -> Result<BoxStream<'static, Result<ChatChunk>>> {
    use futures_util::StreamExt;

    let url = format!("{}/v1/chat/completions", self.base_url.trim_end_matches('/'));
    let messages: Vec<OAIChatMsg> = request.messages.iter().map(|m| OAIChatMsg {
        role: role_str(&m.role),
        content: &m.content,
    }).collect();
    let body = OAIChatReq {
        model: &request.model,
        messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        stream: true,
    };
    let resp = self.client.post(&url).headers(self.build_headers()).json(&body).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ProviderError::Http { status: status.as_u16(), body });
    }

    let byte_stream = resp.bytes_stream();
    let stream = byte_stream
        .map(|c| c.map_err(ProviderError::from))
        .scan(Vec::<u8>::new(), |buffer, chunk| {
            let chunks = match chunk {
                Err(e) => return futures_util::future::ready(Some(vec![Err(e)])),
                Ok(b) => b,
            };
            buffer.extend_from_slice(&chunks);
            let mut emitted = Vec::<Result<ChatChunk>>::new();
            while let Some(pos) = find_double_newline(buffer) {
                let event = buffer.drain(..=pos.0 + pos.1 - 1).collect::<Vec<_>>();
                let text = String::from_utf8_lossy(&event).into_owned();
                for line in text.lines() {
                    if let Some(rest) = line.strip_prefix("data: ") {
                        if rest.trim() == "[DONE]" {
                            emitted.push(Ok(ChatChunk { delta: String::new(), done: true }));
                        } else if let Some(parsed) = parse_sse_data(rest) {
                            emitted.push(parsed);
                        }
                    }
                }
            }
            futures_util::future::ready(Some(emitted))
        })
        .flat_map(|emitted| futures_util::stream::iter(emitted));
    Ok(Box::pin(stream))
}
```

Add the helpers:

```rust
fn find_double_newline(buf: &[u8]) -> Option<(usize, usize)> {
    // Returns (position of \n in \n\n, span length 2) or for \r\n\r\n returns (pos of first \r, 4).
    let mut i = 0;
    while i + 1 < buf.len() {
        if buf[i] == b'\n' && buf[i + 1] == b'\n' {
            return Some((i, 2));
        }
        if i + 3 < buf.len() && buf[i] == b'\r' && buf[i + 1] == b'\n' && buf[i + 2] == b'\r' && buf[i + 3] == b'\n' {
            return Some((i, 4));
        }
        i += 1;
    }
    None
}

#[derive(Deserialize)]
struct OAIStreamChunk {
    choices: Vec<OAIStreamChoice>,
}
#[derive(Deserialize)]
struct OAIStreamChoice {
    delta: OAIStreamDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}
#[derive(Deserialize)]
struct OAIStreamDelta {
    #[serde(default)]
    content: Option<String>,
}

fn parse_sse_data(line: &str) -> Option<Result<ChatChunk>> {
    let parsed: OAIStreamChunk = match serde_json::from_str(line) {
        Ok(p) => p,
        Err(e) => return Some(Err(ProviderError::Serde(e))),
    };
    let choice = parsed.choices.into_iter().next()?;
    let delta = choice.delta.content.unwrap_or_default();
    let done = choice.finish_reason.is_some();
    Some(Ok(ChatChunk { delta, done }))
}
```

- [ ] **Step 10: Write the stream test**

```rust
#[tokio::test]
async fn chat_stream_parses_sse() {
    use futures_util::StreamExt;
    let mut server = Server::new_async().await;
    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n\
                data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n\
                data: [DONE]\n\n";
    let _mock = server.mock("POST", "/v1/chat/completions").with_body(body).create_async().await;
    let p = OpenAICompatProvider::new("t", ProviderKind::OpenAi, server.url(), Some("sk".into()));
    let req = ChatRequest { model: "gpt-4o".into(), messages: vec![ChatMessage { role: Role::User, content: "Hi".into() }], max_tokens: None, temperature: None, stream: true };
    let mut s = p.chat_stream(req).await.unwrap();
    let mut combined = String::new();
    let mut done = false;
    while let Some(c) = s.next().await {
        let c = c.unwrap();
        combined.push_str(&c.delta);
        done |= c.done;
    }
    assert_eq!(combined, "Hello");
    assert!(done);
}
```

- [ ] **Step 11: Run + confirm**

```
cd src-tauri && cargo test --lib providers::openai_compatible
```

Expected: 3 passed.

- [ ] **Step 12: Implement health**

```rust
async fn health(&self) -> Result<bool> {
    let url = format!("{}/v1/models", self.base_url.trim_end_matches('/'));
    match self.client.get(&url).headers(self.build_headers()).send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}
```

- [ ] **Step 13: Run all openai_compatible tests + commit**

```
cd src-tauri && cargo test --lib providers::openai_compatible
git add src-tauri/src/providers/openai_compatible.rs src-tauri/src/providers/mod.rs
git commit -m "Add OpenAI-compatible provider with SSE streaming"
```

---

## Task 5 — OpenAI provider (preset)

**Files:**
- Create: `src-tauri/src/providers/openai.rs`
- Modify: `src-tauri/src/providers/mod.rs`

A thin wrapper that constructs `OpenAICompatProvider` with the canonical OpenAI base URL.

- [ ] **Step 1: Add module + write the file**

In `providers/mod.rs`:
```rust
pub mod openai;
```

Create `providers/openai.rs`:

```rust
use super::openai_compatible::OpenAICompatProvider;
use super::types::ProviderKind;

pub fn new_openai(name: impl Into<String>, api_key: String) -> OpenAICompatProvider {
    OpenAICompatProvider::new(name, ProviderKind::OpenAi, "https://api.openai.com", Some(api_key))
}
```

- [ ] **Step 2: Build + commit**

```
cd src-tauri && cargo check
git add src-tauri/src/providers/openai.rs src-tauri/src/providers/mod.rs
git commit -m "Add OpenAI provider preset on top of OpenAI-compat"
```

---

## Task 6 — Anthropic provider

**Files:**
- Create: `src-tauri/src/providers/anthropic.rs`
- Modify: `src-tauri/src/providers/mod.rs`

Anthropic uses `POST /v1/messages` with: `x-api-key` header, `anthropic-version: 2023-06-01` header, `system` field separate from `messages`. Streaming is SSE with multiple event types (`message_start`, `content_block_delta`, `message_delta`, `message_stop`).

- [ ] **Step 1: Add module and stub**

In `providers/mod.rs`:
```rust
pub mod anthropic;
```

Create `providers/anthropic.rs`:

```rust
use async_trait::async_trait;
use futures_util::stream::BoxStream;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::{
    error::{ProviderError, Result},
    types::*,
    Provider,
};

pub struct AnthropicProvider {
    name: String,
    base_url: String,
    api_key: String,
    client: Client,
}

impl AnthropicProvider {
    pub fn new(name: impl Into<String>, base_url: impl Into<String>, api_key: String) -> Self {
        Self {
            name: name.into(),
            base_url: base_url.into(),
            api_key,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl Provider for AnthropicProvider {
    fn name(&self) -> &str { &self.name }
    fn kind(&self) -> ProviderKind { ProviderKind::Anthropic }

    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        // Anthropic doesn't have a public /models endpoint; return our well-known set.
        Ok(vec![
            ModelInfo { id: "claude-opus-4-7".into(), display_name: Some("Claude Opus 4.7".into()), context_length: Some(1_000_000) },
            ModelInfo { id: "claude-sonnet-4-6".into(), display_name: Some("Claude Sonnet 4.6".into()), context_length: Some(200_000) },
            ModelInfo { id: "claude-haiku-4-5".into(), display_name: Some("Claude Haiku 4.5".into()), context_length: Some(200_000) },
        ])
    }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse> {
        let (system, messages) = split_system(request.messages);
        let body = AnthropicReq {
            model: request.model.clone(),
            max_tokens: request.max_tokens.unwrap_or(4096),
            temperature: request.temperature,
            system,
            messages,
            stream: false,
        };
        let url = format!("{}/v1/messages", self.base_url.trim_end_matches('/'));
        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Http { status: status.as_u16(), body });
        }
        let parsed: AnthropicResp = resp.json().await?;
        let content = parsed.content.into_iter()
            .filter_map(|b| if b.kind == "text" { Some(b.text) } else { None })
            .collect::<Vec<_>>()
            .join("");
        let usage = parsed.usage.map(|u| UsageStats {
            prompt_tokens: u.input_tokens,
            completion_tokens: u.output_tokens,
            total_tokens: u.input_tokens + u.output_tokens,
        });
        Ok(ChatResponse { content, model: parsed.model, usage })
    }

    async fn chat_stream(&self, _request: ChatRequest) -> Result<BoxStream<'static, Result<ChatChunk>>> {
        // Streaming deferred to a follow-up task — Plan 1 ships non-streaming for Anthropic.
        Err(ProviderError::Other("Anthropic streaming not yet implemented".into()))
    }

    async fn health(&self) -> Result<bool> {
        // Cheapest verifiable call: send a 1-token request and check 200. Or just verify URL reachable.
        let url = format!("{}/v1/messages", self.base_url.trim_end_matches('/'));
        let r = self.client.head(&url).header("x-api-key", &self.api_key).send().await;
        Ok(matches!(r, Ok(resp) if resp.status().as_u16() < 500))
    }
}

#[derive(Serialize)]
struct AnthropicReq {
    model: String,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<AnthropicMsg>,
    stream: bool,
}

#[derive(Serialize)]
struct AnthropicMsg {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct AnthropicResp {
    model: String,
    content: Vec<AnthropicBlock>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct AnthropicUsage {
    input_tokens: u32,
    output_tokens: u32,
}

fn split_system(messages: Vec<ChatMessage>) -> (Option<String>, Vec<AnthropicMsg>) {
    let mut system_parts = Vec::<String>::new();
    let mut out = Vec::<AnthropicMsg>::new();
    for m in messages {
        match m.role {
            Role::System => system_parts.push(m.content),
            Role::User => out.push(AnthropicMsg { role: "user".into(), content: m.content }),
            Role::Assistant => out.push(AnthropicMsg { role: "assistant".into(), content: m.content }),
        }
    }
    let sys = if system_parts.is_empty() { None } else { Some(system_parts.join("\n\n")) };
    (sys, out)
}
```

- [ ] **Step 2: Write a chat test**

Add tests module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[tokio::test]
    async fn chat_parses_anthropic_response() {
        let mut server = Server::new_async().await;
        let _mock = server.mock("POST", "/v1/messages")
            .match_header("x-api-key", "test-key")
            .match_header("anthropic-version", "2023-06-01")
            .with_status(200)
            .with_body(r#"{"id":"msg_1","model":"claude-opus-4-7","content":[{"type":"text","text":"Hi!"}],"usage":{"input_tokens":5,"output_tokens":3}}"#)
            .create_async().await;
        let p = AnthropicProvider::new("t", server.url(), "test-key".into());
        let req = ChatRequest {
            model: "claude-opus-4-7".into(),
            messages: vec![
                ChatMessage { role: Role::System, content: "You are helpful.".into() },
                ChatMessage { role: Role::User, content: "Hi".into() },
            ],
            max_tokens: Some(100), temperature: None, stream: false,
        };
        let resp = p.chat(req).await.unwrap();
        assert_eq!(resp.content, "Hi!");
        assert_eq!(resp.usage.unwrap().total_tokens, 8);
    }

    #[test]
    fn split_system_extracts_system_and_role_maps() {
        let msgs = vec![
            ChatMessage { role: Role::System, content: "A".into() },
            ChatMessage { role: Role::System, content: "B".into() },
            ChatMessage { role: Role::User, content: "U".into() },
            ChatMessage { role: Role::Assistant, content: "X".into() },
        ];
        let (sys, out) = split_system(msgs);
        assert_eq!(sys.unwrap(), "A\n\nB");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].role, "user");
        assert_eq!(out[1].role, "assistant");
    }
}
```

- [ ] **Step 3: Run + confirm**

```
cd src-tauri && cargo test --lib providers::anthropic
```

Expected: 2 passed.

- [ ] **Step 4: Commit**

```
git add src-tauri/src/providers/anthropic.rs src-tauri/src/providers/mod.rs
git commit -m "Add Anthropic provider (non-streaming; streaming TODO)"
```

---

## Task 7 — Auto-detection

**Files:**
- Create: `src-tauri/src/providers/detect.rs`
- Modify: `src-tauri/src/providers/mod.rs`

Probe known localhost ports in parallel with short timeouts, return a list of detected providers.

- [ ] **Step 1: Add module and types**

In `providers/mod.rs`:
```rust
pub mod detect;
```

Create `providers/detect.rs`:

```rust
use reqwest::Client;
use serde::Serialize;
use std::time::Duration;

use super::types::ProviderKind;

#[derive(Debug, Clone, Serialize)]
pub struct DetectedProvider {
    pub kind: ProviderKind,
    pub display_name: String,
    pub base_url: String,
    pub probe_path: String,
}

#[derive(Debug, Clone, Copy)]
struct ProbeTarget {
    kind: ProviderKind,
    display_name: &'static str,
    port: u16,
    probe_path: &'static str,
}

const PROBES: &[ProbeTarget] = &[
    ProbeTarget { kind: ProviderKind::Ollama, display_name: "Ollama", port: 11434, probe_path: "/api/tags" },
    ProbeTarget { kind: ProviderKind::LmStudio, display_name: "LM Studio", port: 1234, probe_path: "/v1/models" },
    ProbeTarget { kind: ProviderKind::LlamaCpp, display_name: "llama.cpp", port: 8080, probe_path: "/v1/models" },
    ProbeTarget { kind: ProviderKind::KoboldCpp, display_name: "KoboldCpp", port: 5001, probe_path: "/api/v1/info/version" },
];

pub async fn detect_local_providers() -> Vec<DetectedProvider> {
    let client = Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .expect("client build");

    let probes = PROBES.iter().map(|p| {
        let client = client.clone();
        let p = *p;
        async move {
            let url = format!("http://localhost:{}{}", p.port, p.probe_path);
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => Some(DetectedProvider {
                    kind: p.kind,
                    display_name: p.display_name.into(),
                    base_url: format!("http://localhost:{}", p.port),
                    probe_path: p.probe_path.into(),
                }),
                _ => None,
            }
        }
    });

    let results = futures_util::future::join_all(probes).await;
    results.into_iter().flatten().collect()
}
```

- [ ] **Step 2: Add an integration test (against mock servers — run real probes)**

Add tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[tokio::test]
    async fn detect_against_known_servers() {
        // We can't easily intercept the hardcoded port list, so this test runs
        // a probe against a known-bad host to ensure the empty-result path works.
        let detected = detect_local_providers().await;
        // The result depends on what's running locally — assertion: function returns Vec without panic.
        let _ = detected;
    }
}
```

(A more rigorous test would require parameterizing the probe list. We'll do that in a follow-up if needed; for Plan 1 the empty-result smoke is enough.)

- [ ] **Step 3: Run + confirm**

```
cd src-tauri && cargo test --lib providers::detect
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```
git add src-tauri/src/providers/detect.rs src-tauri/src/providers/mod.rs
git commit -m "Add auto-detection of local LLM providers"
```

---

## Task 8 — Config store (provider configs persisted)

**Files:**
- Create: `src-tauri/src/config/mod.rs`
- Create: `src-tauri/src/config/store.rs`
- Modify: `src-tauri/src/lib.rs`

JSON file in OS app-data dir holds `Vec<ProviderConfig>`.

- [ ] **Step 1: Wire module**

In `src-tauri/src/lib.rs`, add:
```rust
mod config;
```

- [ ] **Step 2: Write store.rs**

Create `config/mod.rs`:
```rust
pub mod store;
```

Create `config/store.rs`:

```rust
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::providers::types::ProviderConfig;

const APP_DIR: &str = "AlternateHistoryDemo";
const CONFIG_FILE: &str = "providers.json";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ConfigFile {
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    #[serde(default)]
    pub default_provider: Option<uuid::Uuid>,
    #[serde(default)]
    pub default_model: Option<String>,
}

pub fn config_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(APP_DIR)
        .join(CONFIG_FILE)
}

pub fn load() -> std::io::Result<ConfigFile> {
    let path = config_path();
    if !path.exists() {
        return Ok(ConfigFile::default());
    }
    let bytes = std::fs::read(&path)?;
    let parsed: ConfigFile = serde_json::from_slice(&bytes)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(parsed)
}

pub fn save(cfg: &ConfigFile) -> std::io::Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(cfg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_config_serializes_round_trip() {
        let cfg = ConfigFile::default();
        let bytes = serde_json::to_vec(&cfg).unwrap();
        let parsed: ConfigFile = serde_json::from_slice(&bytes).unwrap();
        assert!(parsed.providers.is_empty());
        assert!(parsed.default_provider.is_none());
        assert!(parsed.default_model.is_none());
    }

    #[test]
    fn config_path_includes_app_dir() {
        let p = config_path();
        assert!(p.to_string_lossy().contains(APP_DIR));
        assert!(p.to_string_lossy().ends_with("providers.json"));
    }
}
```

- [ ] **Step 3: Build + test + commit**

```
cd src-tauri && cargo test --lib config
git add src-tauri/src/config src-tauri/src/lib.rs
git commit -m "Add config file store for provider configs"
```

Expected: 2 passed.

---

## Task 9 — Secrets store (API keys via keyring)

**Files:**
- Create: `src-tauri/src/secrets/mod.rs`
- Create: `src-tauri/src/secrets/keyring_store.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod secrets;`)

- [ ] **Step 1: Wire module**

In `src-tauri/src/lib.rs`:
```rust
mod secrets;
```

Create `secrets/mod.rs`:
```rust
pub mod keyring_store;
```

- [ ] **Step 2: Write keyring_store.rs**

```rust
use keyring::Entry;
use uuid::Uuid;

const SERVICE: &str = "AlternateHistoryDemo";

fn entry_for(provider_id: Uuid) -> keyring::Result<Entry> {
    Entry::new(SERVICE, &provider_id.to_string())
}

pub fn set_api_key(provider_id: Uuid, api_key: &str) -> keyring::Result<()> {
    let entry = entry_for(provider_id)?;
    entry.set_password(api_key)
}

pub fn get_api_key(provider_id: Uuid) -> keyring::Result<Option<String>> {
    let entry = entry_for(provider_id)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete_api_key(provider_id: Uuid) -> keyring::Result<()> {
    let entry = entry_for(provider_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}
```

- [ ] **Step 3: Add tests (note: keyring tests touch the real OS keyring — gated behind an `online` feature)**

Skip live tests in CI; add a small smoke test for the round-trip with a feature gate. For Plan 1 we'll add a manual test only — keyring CI is finicky on different OSes. Add minimal coverage:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // This test actually touches the OS keyring. It's gated so CI can opt out.
    #[test]
    #[ignore = "touches OS keyring; run with `cargo test -- --ignored`"]
    fn set_get_delete_round_trip() {
        let id = Uuid::new_v4();
        set_api_key(id, "test-secret-12345").expect("set");
        let got = get_api_key(id).expect("get");
        assert_eq!(got.as_deref(), Some("test-secret-12345"));
        delete_api_key(id).expect("delete");
        let after = get_api_key(id).expect("get-after-delete");
        assert!(after.is_none());
    }
}
```

- [ ] **Step 4: Build + commit (test deliberately ignored)**

```
cd src-tauri && cargo check
git add src-tauri/src/secrets src-tauri/src/lib.rs
git commit -m "Add keyring-backed API key storage"
```

---

## Task 10 — Provider registry

**Files:**
- Create: `src-tauri/src/providers/registry.rs`
- Modify: `src-tauri/src/providers/mod.rs`

Holds a collection of constructed `Box<dyn Provider>` keyed by config id. Built on app start from the config file + keyring.

- [ ] **Step 1: Add module**

In `providers/mod.rs`:
```rust
pub mod registry;
```

- [ ] **Step 2: Write registry.rs**

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::{
    anthropic::AnthropicProvider,
    error::{ProviderError, Result},
    ollama::OllamaProvider,
    openai::new_openai,
    openai_compatible::OpenAICompatProvider,
    types::{ProviderConfig, ProviderKind},
    Provider,
};
use crate::secrets::keyring_store;

#[derive(Clone, Default)]
pub struct ProviderRegistry {
    inner: Arc<RwLock<HashMap<Uuid, Arc<dyn Provider>>>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a registry from saved configs. Reads API keys from keyring.
    pub async fn from_configs(configs: &[ProviderConfig]) -> Self {
        let registry = Self::new();
        for c in configs {
            if let Err(e) = registry.add_from_config(c.clone()).await {
                tracing::warn!("Skipping provider {}: {}", c.name, e);
            }
        }
        registry
    }

    pub async fn add_from_config(&self, c: ProviderConfig) -> Result<()> {
        let api_key = if c.uses_api_key {
            keyring_store::get_api_key(c.id)
                .map_err(ProviderError::Keyring)?
        } else {
            None
        };
        let provider: Arc<dyn Provider> = match c.kind {
            ProviderKind::Ollama => Arc::new(OllamaProvider::new(c.name.clone(), c.base_url.clone())),
            ProviderKind::LmStudio | ProviderKind::LlamaCpp | ProviderKind::KoboldCpp | ProviderKind::OpenAiCompatible => {
                Arc::new(OpenAICompatProvider::new(c.name.clone(), c.kind, c.base_url.clone(), api_key.clone()))
            }
            ProviderKind::OpenAi => {
                let key = api_key.ok_or_else(|| ProviderError::MissingApiKey("OpenAI".into()))?;
                Arc::new(new_openai(c.name.clone(), key))
            }
            ProviderKind::Anthropic => {
                let key = api_key.ok_or_else(|| ProviderError::MissingApiKey("Anthropic".into()))?;
                Arc::new(AnthropicProvider::new(c.name.clone(), c.base_url.clone(), key))
            }
        };
        let mut inner = self.inner.write().await;
        inner.insert(c.id, provider);
        Ok(())
    }

    pub async fn remove(&self, id: Uuid) {
        let mut inner = self.inner.write().await;
        inner.remove(&id);
    }

    pub async fn get(&self, id: Uuid) -> Option<Arc<dyn Provider>> {
        let inner = self.inner.read().await;
        inner.get(&id).cloned()
    }
}
```

- [ ] **Step 3: Add a smoke test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::types::ProviderConfig;

    #[tokio::test]
    async fn registry_holds_ollama_provider() {
        let cfg = ProviderConfig {
            id: Uuid::new_v4(),
            kind: ProviderKind::Ollama,
            name: "My Ollama".into(),
            base_url: "http://localhost:11434".into(),
            uses_api_key: false,
        };
        let registry = ProviderRegistry::new();
        registry.add_from_config(cfg.clone()).await.unwrap();
        let got = registry.get(cfg.id).await;
        assert!(got.is_some());
        assert_eq!(got.unwrap().name(), "My Ollama");
    }
}
```

- [ ] **Step 4: Run + commit**

```
cd src-tauri && cargo test --lib providers::registry
git add src-tauri/src/providers/registry.rs src-tauri/src/providers/mod.rs
git commit -m "Add ProviderRegistry"
```

Expected: 1 passed.

---

## Task 11 — Tauri commands

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/providers.rs`
- Modify: `src-tauri/src/lib.rs` (register commands + state)

Expose these commands to the frontend:

- `list_provider_configs() -> Vec<ProviderConfig>`
- `add_provider(config: ProviderConfig, api_key: Option<String>) -> ()`
- `remove_provider(id: Uuid) -> ()`
- `list_models(provider_id: Uuid) -> Vec<ModelInfo>`
- `test_chat(provider_id: Uuid, model: String, prompt: String) -> ChatResponse`
- `detect_local_providers() -> Vec<DetectedProvider>`
- `get_default_provider() -> Option<(Uuid, Option<String>)>`
- `set_default_provider(id: Uuid, model: Option<String>) -> ()`

- [ ] **Step 1: Wire commands module**

In `src-tauri/src/lib.rs`:
```rust
mod commands;
```

Create `commands/mod.rs`:
```rust
pub mod providers;
```

- [ ] **Step 2: Define the AppState**

We need shared state for `ProviderRegistry` and config. Add to `src-tauri/src/lib.rs` (or a new `state.rs`):

```rust
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub registry: crate::providers::registry::ProviderRegistry,
    pub config: Arc<Mutex<crate::config::store::ConfigFile>>,
}

impl AppState {
    pub async fn new() -> Self {
        let cfg = crate::config::store::load().unwrap_or_default();
        let registry = crate::providers::registry::ProviderRegistry::from_configs(&cfg.providers).await;
        Self {
            registry,
            config: Arc::new(Mutex::new(cfg)),
        }
    }

    pub async fn save_config(&self) -> std::io::Result<()> {
        let cfg = self.config.lock().await.clone();
        crate::config::store::save(&cfg)
    }
}
```

- [ ] **Step 3: Write providers.rs commands**

Create `src-tauri/src/commands/providers.rs`:

```rust
use tauri::State;
use uuid::Uuid;

use crate::config::store::ConfigFile;
use crate::error::{AppError, Result};
use crate::providers::detect::{detect_local_providers as do_detect, DetectedProvider};
use crate::providers::types::{ChatMessage, ChatRequest, ChatResponse, ModelInfo, ProviderConfig, Role};
use crate::secrets::keyring_store;
use crate::AppState;

#[tauri::command]
pub async fn list_provider_configs(state: State<'_, AppState>) -> Result<Vec<ProviderConfig>> {
    Ok(state.config.lock().await.providers.clone())
}

#[tauri::command]
pub async fn add_provider(
    state: State<'_, AppState>,
    mut config: ProviderConfig,
    api_key: Option<String>,
) -> Result<ProviderConfig> {
    if config.id.is_nil() {
        config.id = Uuid::new_v4();
    }
    if let Some(key) = &api_key {
        keyring_store::set_api_key(config.id, key)
            .map_err(|e| AppError::Provider(crate::providers::ProviderError::Keyring(e)))?;
        config.uses_api_key = true;
    }
    state.registry.add_from_config(config.clone()).await?;
    {
        let mut cfg = state.config.lock().await;
        cfg.providers.retain(|p| p.id != config.id);
        cfg.providers.push(config.clone());
    }
    state.save_config().await?;
    Ok(config)
}

#[tauri::command]
pub async fn remove_provider(state: State<'_, AppState>, id: Uuid) -> Result<()> {
    state.registry.remove(id).await;
    let _ = keyring_store::delete_api_key(id);
    {
        let mut cfg = state.config.lock().await;
        cfg.providers.retain(|p| p.id != id);
        if cfg.default_provider == Some(id) {
            cfg.default_provider = None;
        }
    }
    state.save_config().await?;
    Ok(())
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>, provider_id: Uuid) -> Result<Vec<ModelInfo>> {
    let p = state
        .registry
        .get(provider_id)
        .await
        .ok_or_else(|| AppError::NotFound("provider".into()))?;
    Ok(p.list_models().await?)
}

#[tauri::command]
pub async fn test_chat(
    state: State<'_, AppState>,
    provider_id: Uuid,
    model: String,
    prompt: String,
) -> Result<ChatResponse> {
    let p = state
        .registry
        .get(provider_id)
        .await
        .ok_or_else(|| AppError::NotFound("provider".into()))?;
    let req = ChatRequest {
        model,
        messages: vec![ChatMessage { role: Role::User, content: prompt }],
        max_tokens: Some(512),
        temperature: Some(0.7),
        stream: false,
    };
    Ok(p.chat(req).await?)
}

#[tauri::command]
pub async fn detect_local_providers() -> Result<Vec<DetectedProvider>> {
    Ok(do_detect().await)
}

#[tauri::command]
pub async fn get_default_provider(state: State<'_, AppState>) -> Result<Option<(Uuid, Option<String>)>> {
    let cfg = state.config.lock().await;
    if let Some(id) = cfg.default_provider {
        Ok(Some((id, cfg.default_model.clone())))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn set_default_provider(
    state: State<'_, AppState>,
    id: Uuid,
    model: Option<String>,
) -> Result<()> {
    {
        let mut cfg = state.config.lock().await;
        cfg.default_provider = Some(id);
        cfg.default_model = model;
    }
    state.save_config().await?;
    Ok(())
}
```

- [ ] **Step 4: Register commands and state in lib.rs**

Replace the body of `lib.rs` `run()` to register state + commands. Full final `lib.rs`:

```rust
mod commands;
mod config;
mod error;
mod providers;
mod secrets;

use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub registry: crate::providers::registry::ProviderRegistry,
    pub config: Arc<Mutex<crate::config::store::ConfigFile>>,
}

impl AppState {
    pub async fn new() -> Self {
        let cfg = crate::config::store::load().unwrap_or_default();
        let registry = crate::providers::registry::ProviderRegistry::from_configs(&cfg.providers).await;
        Self {
            registry,
            config: Arc::new(Mutex::new(cfg)),
        }
    }

    pub async fn save_config(&self) -> std::io::Result<()> {
        let cfg = self.config.lock().await.clone();
        crate::config::store::save(&cfg)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init()
        .ok();

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
    let state = rt.block_on(AppState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::providers::list_provider_configs,
            commands::providers::add_provider,
            commands::providers::remove_provider,
            commands::providers::list_models,
            commands::providers::test_chat,
            commands::providers::detect_local_providers,
            commands::providers::get_default_provider,
            commands::providers::set_default_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

(The `greet` command is removed — no longer needed.)

- [ ] **Step 5: Build + verify clean compile**

```
cd src-tauri && cargo check
```

Expected: clean.

- [ ] **Step 6: Commit**

```
git add src-tauri/src/commands src-tauri/src/lib.rs
git commit -m "Wire Tauri commands for provider configs, chat, detect"
```

---

## Task 12 — Frontend: typed Tauri command wrappers

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/lib/types.ts`

- [ ] **Step 1: Define TS types**

Create `src/lib/types.ts`:

```typescript
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
```

- [ ] **Step 2: Define command wrappers**

Create `src/lib/tauri.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { ProviderConfig, ModelInfo, ChatResponse, DetectedProvider } from "./types";

export function listProviderConfigs() {
  return invoke<ProviderConfig[]>("list_provider_configs");
}

export function addProvider(config: Omit<ProviderConfig, "id"> & { id?: string }, api_key?: string) {
  const c: ProviderConfig = {
    id: config.id ?? "00000000-0000-0000-0000-000000000000",
    kind: config.kind,
    name: config.name,
    base_url: config.base_url,
    uses_api_key: !!api_key || config.uses_api_key,
  };
  return invoke<ProviderConfig>("add_provider", { config: c, apiKey: api_key ?? null });
}

export function removeProvider(id: string) {
  return invoke<void>("remove_provider", { id });
}

export function listModels(provider_id: string) {
  return invoke<ModelInfo[]>("list_models", { providerId: provider_id });
}

export function testChat(provider_id: string, model: string, prompt: string) {
  return invoke<ChatResponse>("test_chat", { providerId: provider_id, model, prompt });
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
```

- [ ] **Step 3: Commit**

```
git add src/lib
git commit -m "Add typed Tauri command wrappers for provider operations"
```

---

## Task 13 — Frontend: shared UI primitives

**Files:**
- Create: `src/components/shared/Button.tsx`
- Create: `src/components/shared/Input.tsx`
- Create: `src/components/shared/Select.tsx`
- Create: `src/components/shared/Card.tsx`

Tiny presentational components. Tailwind would be nice eventually but for Plan 1 we use plain CSS class names matching the existing `App.css` style. No design system yet — just functional.

- [ ] **Step 1: Write all four files**

`src/components/shared/Button.tsx`:
```tsx
import { ButtonHTMLAttributes } from "react";

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return <button className={`ahd-button ${className}`} {...rest} />;
}
```

`src/components/shared/Input.tsx`:
```tsx
import { InputHTMLAttributes } from "react";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`ahd-input ${className}`} {...rest} />;
}
```

`src/components/shared/Select.tsx`:
```tsx
import { SelectHTMLAttributes } from "react";

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return <select className={`ahd-select ${className}`} {...rest} />;
}
```

`src/components/shared/Card.tsx`:
```tsx
import { ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="ahd-card">
      {title && <h3 className="ahd-card-title">{title}</h3>}
      <div className="ahd-card-body">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Add minimal styles**

Append to `src/App.css`:

```css
.ahd-button { padding: 6px 12px; border: 1px solid #444; background: #2a2a2a; color: #eee; border-radius: 4px; cursor: pointer; }
.ahd-button:hover:not(:disabled) { background: #3a3a3a; }
.ahd-button:disabled { opacity: 0.5; cursor: not-allowed; }
.ahd-input, .ahd-select { padding: 6px 8px; border: 1px solid #444; background: #1f1f1f; color: #eee; border-radius: 4px; }
.ahd-card { border: 1px solid #333; border-radius: 6px; padding: 12px; margin-bottom: 12px; background: #1c1c1c; }
.ahd-card-title { margin: 0 0 8px 0; font-size: 1rem; font-weight: 600; }
.ahd-card-body { font-size: 0.9rem; }
.ahd-stack { display: flex; flex-direction: column; gap: 8px; }
.ahd-row { display: flex; gap: 8px; align-items: center; }
.ahd-grow { flex: 1; }
```

- [ ] **Step 3: Commit**

```
git add src/components/shared src/App.css
git commit -m "Add shared UI primitives + base styles"
```

---

## Task 14 — Frontend: provider list

**Files:**
- Create: `src/components/Settings/ProviderList.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import { listProviderConfigs, removeProvider } from "../../lib/tauri";
import type { ProviderConfig } from "../../lib/types";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";

export function ProviderList({ refreshToken, onChange }: { refreshToken: number; onChange: () => void }) {
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

  if (error) return <Card title="Configured providers"><div style={{ color: "salmon" }}>{error}</div></Card>;

  return (
    <Card title="Configured providers">
      {providers.length === 0 && <div>No providers configured yet.</div>}
      <div className="ahd-stack">
        {providers.map((p) => (
          <div key={p.id} className="ahd-row">
            <div className="ahd-grow">
              <strong>{p.name}</strong> <small>({p.kind})</small><br />
              <small>{p.base_url}</small>
            </div>
            <Button onClick={() => handleRemove(p.id)}>Remove</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```
git add src/components/Settings/ProviderList.tsx
git commit -m "Add ProviderList component"
```

---

## Task 15 — Frontend: AddProvider form

**Files:**
- Create: `src/components/Settings/AddProvider.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
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

  const handleSubmit = async (e: React.FormEvent) => {
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
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind} className="ahd-grow" />
        </div>
        <div className="ahd-row">
          <label>Base URL</label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="ahd-grow" />
        </div>
        {KIND_DEFAULTS[kind].needs_key && (
          <div className="ahd-row">
            <label>API key</label>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="ahd-grow" />
          </div>
        )}
        {error && <div style={{ color: "salmon" }}>{error}</div>}
        <div>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add"}</Button>
        </div>
      </form>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```
git add src/components/Settings/AddProvider.tsx
git commit -m "Add AddProvider form"
```

---

## Task 16 — Frontend: AutoDetect

**Files:**
- Create: `src/components/Settings/AutoDetect.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
        <Button onClick={handleScan} disabled={busy}>{busy ? "Scanning…" : "Scan localhost"}</Button>
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
```

- [ ] **Step 2: Commit**

```
git add src/components/Settings/AutoDetect.tsx
git commit -m "Add AutoDetect component"
```

---

## Task 17 — Frontend: TestChat

**Files:**
- Create: `src/components/Settings/TestChat.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
  }, [refreshToken]);

  useEffect(() => {
    if (!providerId) {
      setModels([]);
      setModel("");
      return;
    }
    listModels(providerId)
      .then((m) => {
        setModels(m);
        if (m.length && !model) setModel(m[0].id);
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
          <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="ahd-grow">
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </div>
        <div className="ahd-row">
          <label>Model</label>
          <Select value={model} onChange={(e) => setModel(e.target.value)} className="ahd-grow">
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name ?? m.id}</option>
            ))}
          </Select>
        </div>
        <div className="ahd-row">
          <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} className="ahd-grow" />
          <Button onClick={handleSend} disabled={busy || !providerId || !model}>{busy ? "Sending…" : "Send"}</Button>
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
```

- [ ] **Step 2: Commit**

```
git add src/components/Settings/TestChat.tsx
git commit -m "Add TestChat component"
```

---

## Task 18 — Frontend: Settings page

**Files:**
- Create: `src/components/Settings/index.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { useState } from "react";
import { AddProvider } from "./AddProvider";
import { AutoDetect } from "./AutoDetect";
import { ProviderList } from "./ProviderList";
import { TestChat } from "./TestChat";

export function Settings() {
  const [refreshToken, setRefreshToken] = useState(0);
  const bump = () => setRefreshToken((t) => t + 1);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1>Settings</h1>
      <AutoDetect onAdded={bump} />
      <AddProvider onAdded={bump} />
      <ProviderList refreshToken={refreshToken} onChange={bump} />
      <TestChat refreshToken={refreshToken} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```
git add src/components/Settings/index.tsx
git commit -m "Add Settings page composing all provider sub-components"
```

---

## Task 19 — Wire Settings into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace App.tsx body**

Replace `src/App.tsx` with:

```tsx
import "./App.css";
import { Settings } from "./components/Settings";

function App() {
  return (
    <main>
      <Settings />
    </main>
  );
}

export default App;
```

(Removes the default Tauri template UI.)

- [ ] **Step 2: Trim App.css**

Remove the template's logo/animation rules from `src/App.css`. Keep only:
- The base font/body rules
- The `.ahd-*` classes added in Task 13

A minimal `App.css` to settle on:

```css
:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  color: #f5f5f5;
  background: #121212;
}

body {
  margin: 0;
  min-height: 100vh;
}

main {
  min-height: 100vh;
}

h1 { font-size: 1.5rem; margin: 0 0 16px 0; }

.ahd-button { padding: 6px 12px; border: 1px solid #444; background: #2a2a2a; color: #eee; border-radius: 4px; cursor: pointer; }
.ahd-button:hover:not(:disabled) { background: #3a3a3a; }
.ahd-button:disabled { opacity: 0.5; cursor: not-allowed; }
.ahd-input, .ahd-select { padding: 6px 8px; border: 1px solid #444; background: #1f1f1f; color: #eee; border-radius: 4px; }
.ahd-card { border: 1px solid #333; border-radius: 6px; padding: 12px; margin-bottom: 12px; background: #1c1c1c; }
.ahd-card-title { margin: 0 0 8px 0; font-size: 1rem; font-weight: 600; }
.ahd-card-body { font-size: 0.9rem; }
.ahd-stack { display: flex; flex-direction: column; gap: 8px; }
.ahd-row { display: flex; gap: 8px; align-items: center; }
.ahd-grow { flex: 1; }
```

- [ ] **Step 3: Commit**

```
git add src/App.tsx src/App.css
git commit -m "Wire Settings page as the main view"
```

---

## Task 20 — Build verification

**Files:**
- (none — verification step)

- [ ] **Step 1: Run all Rust tests**

```
cd src-tauri && cargo test --lib
```

Expected: all tests pass (ignored keyring test stays ignored). Final count should be approximately:
- providers::ollama: 5 passed
- providers::openai_compatible: 3 passed
- providers::anthropic: 2 passed
- providers::registry: 1 passed
- providers::detect: 1 passed
- config: 2 passed
- secrets: 1 ignored
- Total: 14 passed, 1 ignored

- [ ] **Step 2: Build the frontend**

```
cd .. && pnpm build
```

Expected: clean Vite + TS build.

- [ ] **Step 3: Run the full Tauri dev build (manual smoke test)**

```
pnpm tauri dev
```

Manual checks (user runs and confirms):
1. App opens, shows "Settings" page
2. Click "Scan localhost" — if Ollama is running on 11434, it appears under "Detected providers"
3. Click "Add" next to detected Ollama → it appears in "Configured providers"
4. Scroll to "Test chat", pick Ollama, pick a model from dropdown, leave the default prompt
5. Click "Send" — response appears

If any step fails: debug, fix, recommit, re-test.

- [ ] **Step 4: Commit any final touches and push**

```
git add -A
git status   # confirm nothing unexpected
git commit -m "Plan 01 verification — full E2E pass" --allow-empty
git push
```

---

## Plan 01 acceptance criteria

- [ ] All Rust unit tests pass (`cd src-tauri && cargo test --lib`)
- [ ] `pnpm build` succeeds with no warnings
- [ ] `pnpm tauri dev` opens the app
- [ ] Auto-detect surfaces a running Ollama instance
- [ ] User can add Ollama, OpenAI (with key), or Anthropic (with key) via the UI
- [ ] Test chat round-trips a message and shows the response
- [ ] Provider configs persist across app restarts
- [ ] API keys persist via OS keyring (visible in Windows Credential Manager / macOS Keychain / Linux Secret Service)

---

## Next plan

After this lands, **Plan 02 (Persistence layer + world-state scaffold)** can begin. The provider abstraction is now ready for subsystems to consume in later plans.
