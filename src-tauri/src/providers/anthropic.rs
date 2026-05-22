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
    fn name(&self) -> &str {
        &self.name
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::Anthropic
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        // Anthropic doesn't expose a public /models endpoint; return our well-known set.
        Ok(vec![
            ModelInfo {
                id: "claude-opus-4-7".into(),
                display_name: Some("Claude Opus 4.7".into()),
                context_length: Some(1_000_000),
            },
            ModelInfo {
                id: "claude-sonnet-4-6".into(),
                display_name: Some("Claude Sonnet 4.6".into()),
                context_length: Some(200_000),
            },
            ModelInfo {
                id: "claude-haiku-4-5".into(),
                display_name: Some("Claude Haiku 4.5".into()),
                context_length: Some(200_000),
            },
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
            return Err(ProviderError::Http {
                status: status.as_u16(),
                body,
            });
        }
        let parsed: AnthropicResp = resp.json().await?;
        let content = parsed
            .content
            .into_iter()
            .filter_map(|b| if b.kind == "text" { Some(b.text) } else { None })
            .collect::<Vec<_>>()
            .join("");
        let usage = parsed.usage.map(|u| UsageStats {
            prompt_tokens: u.input_tokens,
            completion_tokens: u.output_tokens,
            total_tokens: u.input_tokens + u.output_tokens,
        });
        Ok(ChatResponse {
            content,
            model: parsed.model,
            usage,
        })
    }

    async fn chat_stream(
        &self,
        _request: ChatRequest,
    ) -> Result<BoxStream<'static, Result<ChatChunk>>> {
        // Streaming deferred to a follow-up task — Plan 1 ships non-streaming for Anthropic.
        Err(ProviderError::Other(
            "Anthropic streaming not yet implemented".into(),
        ))
    }

    async fn health(&self) -> Result<bool> {
        // We only confirm the host is reachable and not erroring at server-level (5xx).
        // Anthropic responds to HEAD /v1/messages with 4xx (405 / 401), which we treat as
        // "service reachable; auth/method may still be wrong but the endpoint is alive."
        let url = format!("{}/v1/messages", self.base_url.trim_end_matches('/'));
        let r = self
            .client
            .head(&url)
            .header("x-api-key", &self.api_key)
            .send()
            .await;
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
            Role::User => out.push(AnthropicMsg {
                role: "user".into(),
                content: m.content,
            }),
            Role::Assistant => out.push(AnthropicMsg {
                role: "assistant".into(),
                content: m.content,
            }),
        }
    }
    let sys = if system_parts.is_empty() {
        None
    } else {
        Some(system_parts.join("\n\n"))
    };
    (sys, out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[tokio::test]
    async fn chat_parses_anthropic_response() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/v1/messages")
            .match_header("x-api-key", "test-key")
            .match_header("anthropic-version", "2023-06-01")
            .with_status(200)
            .with_body(r#"{"id":"msg_1","model":"claude-opus-4-7","content":[{"type":"text","text":"Hi!"}],"usage":{"input_tokens":5,"output_tokens":3}}"#)
            .create_async()
            .await;
        let p = AnthropicProvider::new("t", server.url(), "test-key".into());
        let req = ChatRequest {
            model: "claude-opus-4-7".into(),
            messages: vec![
                ChatMessage {
                    role: Role::System,
                    content: "You are helpful.".into(),
                },
                ChatMessage {
                    role: Role::User,
                    content: "Hi".into(),
                },
            ],
            max_tokens: Some(100),
            temperature: None,
            stream: false,
            keep_alive: None,
            response_format: None,
            num_ctx: None,
            allow_thinking: None,
        };
        let resp = p.chat(req).await.unwrap();
        assert_eq!(resp.content, "Hi!");
        assert_eq!(resp.usage.unwrap().total_tokens, 8);
    }

    #[test]
    fn split_system_extracts_system_and_role_maps() {
        let msgs = vec![
            ChatMessage {
                role: Role::System,
                content: "A".into(),
            },
            ChatMessage {
                role: Role::System,
                content: "B".into(),
            },
            ChatMessage {
                role: Role::User,
                content: "U".into(),
            },
            ChatMessage {
                role: Role::Assistant,
                content: "X".into(),
            },
        ];
        let (sys, out) = split_system(msgs);
        assert_eq!(sys.unwrap(), "A\n\nB");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].role, "user");
        assert_eq!(out[1].role, "assistant");
    }
}
