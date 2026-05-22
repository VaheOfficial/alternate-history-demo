pub mod anthropic;
pub mod detect;
pub mod error;
pub mod ollama;
pub mod openai;
pub mod openai_compatible;
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
    async fn chat_stream(
        &self,
        request: ChatRequest,
    ) -> Result<BoxStream<'static, Result<ChatChunk>>>;

    async fn health(&self) -> Result<bool>;
}
