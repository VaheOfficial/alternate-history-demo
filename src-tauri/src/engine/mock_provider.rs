//! A mock Provider used by integration tests to simulate LLM responses
//! without spinning up Ollama / network. Returns canned text given by the
//! test, lets us verify the full validator / NPC turn / production flows.

use async_trait::async_trait;
use futures_util::stream::BoxStream;
use std::sync::{Arc, Mutex};

use crate::providers::error::Result;
use crate::providers::types::*;
use crate::providers::Provider;

#[derive(Default)]
pub struct MockProvider {
    pub responses: Mutex<Vec<String>>,
    pub calls: Mutex<Vec<ChatRequest>>,
}

impl MockProvider {
    pub fn new(responses: Vec<&str>) -> Arc<Self> {
        Arc::new(Self {
            responses: Mutex::new(responses.into_iter().map(String::from).collect()),
            calls: Mutex::new(Vec::new()),
        })
    }

    pub fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

#[async_trait]
impl Provider for MockProvider {
    fn name(&self) -> &str {
        "mock"
    }
    fn kind(&self) -> ProviderKind {
        ProviderKind::Ollama
    }
    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(vec![ModelInfo {
            id: "mock".into(),
            display_name: None,
            context_length: None,
        }])
    }
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse> {
        self.calls.lock().unwrap().push(request);
        let body = {
            let mut q = self.responses.lock().unwrap();
            if q.is_empty() {
                "{}".to_string()
            } else {
                q.remove(0)
            }
        };
        Ok(ChatResponse {
            content: body,
            model: "mock".into(),
            usage: None,
        })
    }
    async fn chat_stream(
        &self,
        _request: ChatRequest,
    ) -> Result<BoxStream<'static, Result<ChatChunk>>> {
        unimplemented!("mock stream not needed")
    }
    async fn health(&self) -> Result<bool> {
        Ok(true)
    }
}
