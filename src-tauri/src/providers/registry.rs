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
            keyring_store::get_api_key(c.id).map_err(ProviderError::Keyring)?
        } else {
            None
        };
        let provider: Arc<dyn Provider> = match c.kind {
            ProviderKind::Ollama => Arc::new(OllamaProvider::new(c.name.clone(), c.base_url.clone())),
            ProviderKind::LmStudio
            | ProviderKind::LlamaCpp
            | ProviderKind::KoboldCpp
            | ProviderKind::OpenAiCompatible => Arc::new(OpenAICompatProvider::new(
                c.name.clone(),
                c.kind,
                c.base_url.clone(),
                api_key.clone(),
            )),
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
