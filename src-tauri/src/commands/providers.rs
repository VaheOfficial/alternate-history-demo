use tauri::State;
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::providers::detect::{detect_local_providers as do_detect, DetectedProvider};
use crate::providers::types::{
    ChatMessage, ChatRequest, ChatResponse, LoadedModel, ModelInfo, ProviderConfig, Role,
};
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
pub async fn list_models(
    state: State<'_, AppState>,
    provider_id: Uuid,
) -> Result<Vec<ModelInfo>> {
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
    keep_alive: Option<String>,
) -> Result<ChatResponse> {
    let p = state
        .registry
        .get(provider_id)
        .await
        .ok_or_else(|| AppError::NotFound("provider".into()))?;
    let req = ChatRequest {
        model,
        messages: vec![ChatMessage {
            role: Role::User,
            content: prompt,
        }],
        max_tokens: Some(512),
        temperature: Some(0.7),
        stream: false,
        keep_alive,
        response_format: None,
        num_ctx: None,
        allow_thinking: None,
    };
    Ok(p.chat(req).await?)
}

#[tauri::command]
pub async fn list_loaded_models(
    state: State<'_, AppState>,
    provider_id: Uuid,
) -> Result<Option<Vec<LoadedModel>>> {
    let p = state
        .registry
        .get(provider_id)
        .await
        .ok_or_else(|| AppError::NotFound("provider".into()))?;
    Ok(p.list_loaded_models().await?)
}

#[tauri::command]
pub async fn unload_model(
    state: State<'_, AppState>,
    provider_id: Uuid,
    model: String,
) -> Result<bool> {
    let p = state
        .registry
        .get(provider_id)
        .await
        .ok_or_else(|| AppError::NotFound("provider".into()))?;
    Ok(p.unload_model(&model).await?)
}

#[tauri::command]
pub async fn detect_local_providers() -> Result<Vec<DetectedProvider>> {
    Ok(do_detect().await)
}

#[tauri::command]
pub async fn get_default_provider(
    state: State<'_, AppState>,
) -> Result<Option<(Uuid, Option<String>)>> {
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
