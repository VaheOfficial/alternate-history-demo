pub mod anthropic;
pub mod detect;
pub mod error;
pub mod ollama;
pub mod openai;
pub mod openai_compatible;
pub mod registry;
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

    /// Returns currently loaded (in-memory) models if the provider supports introspection.
    /// Default impl returns `None` meaning "not supported on this provider."
    async fn list_loaded_models(&self) -> Result<Option<Vec<LoadedModel>>> {
        Ok(None)
    }

    /// Unloads a specific model if the provider supports it. Returns true if
    /// the operation was attempted, false if not supported.
    async fn unload_model(&self, _model: &str) -> Result<bool> {
        Ok(false)
    }
}
