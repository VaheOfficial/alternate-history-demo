use async_trait::async_trait;
use futures_util::stream::BoxStream;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::Client;
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
            if let (Ok(name), Ok(value)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_str(v),
            ) {
                headers.insert(name, value);
            }
        }
        headers
    }

    async fn list_models_impl(&self) -> Result<Vec<ModelInfo>> {
        let url = format!("{}/v1/models", self.base_url.trim_end_matches('/'));
        let resp = self
            .client
            .get(&url)
            .headers(self.build_headers())
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
        let parsed: OAIModelsResp = resp.json().await?;
        Ok(parsed
            .data
            .into_iter()
            .map(|m| ModelInfo {
                id: m.id,
                display_name: None,
                context_length: None,
            })
            .collect())
    }
}

#[derive(Deserialize)]
struct OAIModelsResp {
    data: Vec<OAIModel>,
}

#[derive(Deserialize)]
struct OAIModel {
    id: String,
}

#[derive(Serialize)]
struct OAIChatReq<'a> {
    model: &'a str,
    messages: Vec<OAIChatMsg<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<OAIResponseFormat<'a>>,
}

#[derive(Serialize)]
struct OAIResponseFormat<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
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

fn find_double_newline(buf: &[u8]) -> Option<(usize, usize)> {
    // Returns (position of first byte of separator, separator length).
    let mut i = 0;
    while i + 1 < buf.len() {
        if buf[i] == b'\n' && buf[i + 1] == b'\n' {
            return Some((i, 2));
        }
        if i + 3 < buf.len()
            && buf[i] == b'\r'
            && buf[i + 1] == b'\n'
            && buf[i + 2] == b'\r'
            && buf[i + 3] == b'\n'
        {
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

#[async_trait]
impl Provider for OpenAICompatProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn kind(&self) -> ProviderKind {
        self.kind
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        self.list_models_impl().await
    }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse> {
        let url = format!(
            "{}/v1/chat/completions",
            self.base_url.trim_end_matches('/')
        );
        let messages: Vec<OAIChatMsg> = request
            .messages
            .iter()
            .map(|m| OAIChatMsg {
                role: role_str(&m.role),
                content: &m.content,
            })
            .collect();
        let body = OAIChatReq {
            model: &request.model,
            messages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false,
            response_format: request
                .response_format
                .as_deref()
                .filter(|f| *f == "json")
                .map(|_| OAIResponseFormat {
                    kind: "json_object",
                }),
        };
        let resp = self
            .client
            .post(&url)
            .headers(self.build_headers())
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
        let parsed: OAIChatResp = resp.json().await?;
        let content = parsed
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| ProviderError::InvalidResponse("no choices in response".into()))?
            .message
            .content;
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

    async fn chat_stream(
        &self,
        request: ChatRequest,
    ) -> Result<BoxStream<'static, Result<ChatChunk>>> {
        use futures_util::StreamExt;

        let url = format!(
            "{}/v1/chat/completions",
            self.base_url.trim_end_matches('/')
        );
        let messages: Vec<OAIChatMsg> = request
            .messages
            .iter()
            .map(|m| OAIChatMsg {
                role: role_str(&m.role),
                content: &m.content,
            })
            .collect();
        let body = OAIChatReq {
            model: &request.model,
            messages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: true,
            response_format: None,
        };
        let resp = self
            .client
            .post(&url)
            .headers(self.build_headers())
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
                    let drain_end = pos.0 + pos.1 - 1;
                    let event: Vec<u8> = buffer.drain(..=drain_end).collect();
                    let text = String::from_utf8_lossy(&event).into_owned();
                    for line in text.lines() {
                        if let Some(rest) = line.strip_prefix("data: ") {
                            if rest.trim() == "[DONE]" {
                                emitted.push(Ok(ChatChunk {
                                    delta: String::new(),
                                    done: true,
                                }));
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

    async fn health(&self) -> Result<bool> {
        let url = format!("{}/v1/models", self.base_url.trim_end_matches('/'));
        match self
            .client
            .get(&url)
            .headers(self.build_headers())
            .send()
            .await
        {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }
}

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
            .with_body(
                r#"{"data":[{"id":"gpt-4o","object":"model"},{"id":"gpt-4o-mini","object":"model"}]}"#,
            )
            .create_async()
            .await;
        let p = OpenAICompatProvider::new("t", ProviderKind::OpenAiCompatible, server.url(), None);
        let m = p.list_models().await.unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].id, "gpt-4o");
    }

    #[tokio::test]
    async fn chat_parses_openai_response() {
        let mut server = Server::new_async().await;
        let _mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(200)
            .with_body(r#"{"model":"gpt-4o","choices":[{"message":{"role":"assistant","content":"Hi!"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}"#)
            .create_async()
            .await;
        let p = OpenAICompatProvider::new(
            "t",
            ProviderKind::OpenAi,
            server.url(),
            Some("sk-test".into()),
        );
        let req = ChatRequest {
            model: "gpt-4o".into(),
            messages: vec![ChatMessage {
                role: Role::User,
                content: "Hi".into(),
            }],
            max_tokens: None,
            temperature: None,
            stream: false,
            keep_alive: None,
            response_format: None,
        };
        let resp = p.chat(req).await.unwrap();
        assert_eq!(resp.content, "Hi!");
        assert_eq!(resp.usage.unwrap().total_tokens, 5);
    }

    #[tokio::test]
    async fn chat_stream_parses_sse() {
        use futures_util::StreamExt;
        let mut server = Server::new_async().await;
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n\
                    data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n\
                    data: [DONE]\n\n";
        let _mock = server
            .mock("POST", "/v1/chat/completions")
            .with_body(body)
            .create_async()
            .await;
        let p = OpenAICompatProvider::new(
            "t",
            ProviderKind::OpenAi,
            server.url(),
            Some("sk".into()),
        );
        let req = ChatRequest {
            model: "gpt-4o".into(),
            messages: vec![ChatMessage {
                role: Role::User,
                content: "Hi".into(),
            }],
            max_tokens: None,
            temperature: None,
            stream: true,
            keep_alive: None,
            response_format: None,
        };
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
}
