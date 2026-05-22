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

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let resp = self.client.get(&url).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Http {
                status: status.as_u16(),
                body,
            });
        }
        Ok(resp.json::<T>().await?)
    }
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaTagModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagModel {
    name: String,
}

#[derive(Debug, Serialize)]
struct OllamaChatRequest<'a> {
    model: &'a str,
    messages: Vec<OllamaChatMessage<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<OllamaOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    keep_alive: Option<&'a str>,
    /// Ollama's strict JSON output mode. When set to "json", the model is
    /// constrained to emit valid JSON — far more reliable than just asking
    /// nicely in the prompt.
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<&'a str>,
    /// Disables reasoning-model thinking when set to false. Critical for
    /// JSON-mode with thinking models (gemma4, qwen-r1, deepseek-r1) —
    /// otherwise the model burns its entire token budget in a separate
    /// `thinking` field and emits empty `content`.
    #[serde(skip_serializing_if = "Option::is_none")]
    think: Option<bool>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    num_ctx: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    model: String,
    message: OllamaChatResponseMessage,
    #[serde(default)]
    #[allow(dead_code)]
    done: bool,
    #[serde(default)]
    prompt_eval_count: u32,
    #[serde(default)]
    eval_count: u32,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponseMessage {
    content: String,
    /// Some reasoning models (gemma4, deepseek-r1) split their output into
    /// a separate `thinking` field. When `content` is empty but `thinking`
    /// has data, the actual answer is buried in the reasoning trace.
    #[serde(default)]
    thinking: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaStreamLine {
    #[serde(default)]
    message: Option<OllamaChatResponseMessage>,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaShowResponse {
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    details: Option<OllamaShowDetails>,
}

#[derive(Debug, Deserialize)]
struct OllamaShowDetails {
    #[serde(default)]
    parameter_size: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaPsResponse {
    #[serde(default)]
    models: Vec<OllamaPsModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaPsModel {
    name: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    size_vram: Option<u64>,
    #[serde(default)]
    expires_at: Option<String>,
}

fn role_str(role: &Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

fn parse_ollama_stream_line(line: &str) -> Result<ChatChunk> {
    let parsed: OllamaStreamLine = serde_json::from_str(line)?;
    let delta = parsed.message.map(|m| m.content).unwrap_or_default();
    Ok(ChatChunk {
        delta,
        done: parsed.done,
    })
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

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse> {
        let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));
        let messages: Vec<OllamaChatMessage> = request
            .messages
            .iter()
            .map(|m| OllamaChatMessage {
                role: role_str(&m.role),
                content: &m.content,
            })
            .collect();
        let body = OllamaChatRequest {
            model: &request.model,
            messages,
            stream: false,
            options: if request.temperature.is_some()
                || request.max_tokens.is_some()
                || request.num_ctx.is_some()
            {
                Some(OllamaOptions {
                    temperature: request.temperature,
                    num_predict: request.max_tokens,
                    num_ctx: request.num_ctx,
                })
            } else {
                None
            },
            keep_alive: request.keep_alive.as_deref(),
            format: request
                .response_format
                .as_deref()
                .filter(|f| *f == "json"),
            // Only flip `think` explicitly when the caller has an opinion.
            // The default behavior (think omitted) lets the model use
            // whatever its modelfile says — which is "thinking on" for
            // reasoning models. The game commands compute this from the
            // GPU profile so weak GPUs fall back to no-thinking but
            // powerful ones keep reasoning.
            think: request.allow_thinking.map(|allow| allow),
        };
        let resp = self.client.post(&url).json(&body).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Http {
                status: status.as_u16(),
                body,
            });
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

    async fn chat_stream(
        &self,
        request: ChatRequest,
    ) -> Result<BoxStream<'static, Result<ChatChunk>>> {
        use futures_util::StreamExt;

        let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));
        let messages: Vec<OllamaChatMessage> = request
            .messages
            .iter()
            .map(|m| OllamaChatMessage {
                role: role_str(&m.role),
                content: &m.content,
            })
            .collect();
        let body = OllamaChatRequest {
            model: &request.model,
            messages,
            stream: true,
            options: if request.temperature.is_some()
                || request.max_tokens.is_some()
                || request.num_ctx.is_some()
            {
                Some(OllamaOptions {
                    temperature: request.temperature,
                    num_predict: request.max_tokens,
                    num_ctx: request.num_ctx,
                })
            } else {
                None
            },
            keep_alive: request.keep_alive.as_deref(),
            format: request
                .response_format
                .as_deref()
                .filter(|f| *f == "json"),
            // Only flip `think` explicitly when the caller has an opinion.
            // The default behavior (think omitted) lets the model use
            // whatever its modelfile says — which is "thinking on" for
            // reasoning models. The game commands compute this from the
            // GPU profile so weak GPUs fall back to no-thinking but
            // powerful ones keep reasoning.
            think: request.allow_thinking.map(|allow| allow),
        };
        let resp = self.client.post(&url).json(&body).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Http {
                status: status.as_u16(),
                body,
            });
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
                    let line: Vec<u8> = buffer.drain(..=pos).collect();
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

    async fn health(&self) -> Result<bool> {
        let url = format!("{}/api/tags", self.base_url.trim_end_matches('/'));
        match self.client.get(&url).send().await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    async fn list_loaded_models(&self) -> Result<Option<Vec<LoadedModel>>> {
        let resp: OllamaPsResponse = self.get_json("/api/ps").await?;
        Ok(Some(
            resp.models
                .into_iter()
                .map(|m| LoadedModel {
                    model: m.name,
                    size_bytes: m.size_vram.unwrap_or(m.size.unwrap_or(0)),
                    expires_at: m.expires_at,
                })
                .collect(),
        ))
    }

    async fn estimate_model_size_mb(&self, model: &str) -> Option<u64> {
        let url = format!("{}/api/show", self.base_url.trim_end_matches('/'));
        let body = serde_json::json!({ "name": model });
        let resp = self.client.post(&url).json(&body).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let parsed: OllamaShowResponse = resp.json().await.ok()?;
        if let Some(size) = parsed.size {
            return Some(size / (1024 * 1024));
        }
        // Fallback: parse parameter_size like "8.0B" — assume ~600 MB per
        // billion params (Q4 quant ballpark).
        if let Some(details) = parsed.details {
            if let Some(p_str) = details.parameter_size {
                let p_str = p_str.trim_end_matches(|c: char| !c.is_ascii_digit() && c != '.');
                if let Ok(p_b) = p_str.parse::<f64>() {
                    return Some((p_b * 600.0) as u64);
                }
            }
        }
        None
    }

    async fn unload_model(&self, model: &str) -> Result<bool> {
        // Per Ollama API: POST /api/chat with empty messages + keep_alive=0 unloads.
        let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));
        let body = OllamaChatRequest {
            model,
            messages: Vec::new(),
            stream: false,
            options: None,
            keep_alive: Some("0"),
            format: None,
            think: None,
        };
        let resp = self.client.post(&url).json(&body).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Http {
                status: status.as_u16(),
                body,
            });
        }
        Ok(true)
    }
}

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
        let models = provider
            .list_models()
            .await
            .expect("list_models should succeed");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "llama3:8b");
        assert_eq!(models[1].id, "qwen2.5:32b");
        mock.assert_async().await;
    }

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
            messages: vec![ChatMessage {
                role: Role::User,
                content: "Hi".into(),
            }],
            max_tokens: None,
            temperature: None,
            stream: false,
            keep_alive: None,
            response_format: None,
            num_ctx: None,
            allow_thinking: None,
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

    #[tokio::test]
    async fn chat_stream_yields_chunks() {
        use futures_util::StreamExt;
        let mut server = Server::new_async().await;
        let body = "{\"message\":{\"role\":\"assistant\",\"content\":\"Hel\"},\"done\":false}\n\
                    {\"message\":{\"role\":\"assistant\",\"content\":\"lo\"},\"done\":false}\n\
                    {\"message\":{\"role\":\"assistant\",\"content\":\"!\"},\"done\":true}\n";
        let mock = server
            .mock("POST", "/api/chat")
            .with_status(200)
            .with_body(body)
            .create_async()
            .await;

        let provider = OllamaProvider::new("test", server.url());
        let req = ChatRequest {
            model: "llama3:8b".into(),
            messages: vec![ChatMessage {
                role: Role::User,
                content: "Hi".into(),
            }],
            max_tokens: None,
            temperature: None,
            stream: true,
            keep_alive: None,
            response_format: None,
            num_ctx: None,
            allow_thinking: None,
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

    #[tokio::test]
    async fn health_returns_true_when_reachable() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("GET", "/api/tags")
            .with_status(200)
            .with_body("{\"models\":[]}")
            .create_async()
            .await;
        let provider = OllamaProvider::new("t", server.url());
        assert!(provider.health().await.unwrap());
    }

    #[tokio::test]
    async fn health_returns_false_when_unreachable() {
        let provider = OllamaProvider::new("t", "http://127.0.0.1:1");
        assert!(!provider.health().await.unwrap());
    }
}
