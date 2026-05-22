#![allow(dead_code)]

mod commands;
mod config;
mod db;
mod error;
mod providers;
pub mod saves;
mod secrets;
pub mod world;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct AppState {
    pub registry: crate::providers::registry::ProviderRegistry,
    pub config: Arc<Mutex<crate::config::store::ConfigFile>>,
}

impl AppState {
    pub async fn new() -> Self {
        let cfg = crate::config::store::load().unwrap_or_default();
        let registry =
            crate::providers::registry::ProviderRegistry::from_configs(&cfg.providers).await;
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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Build AppState on Tauri's own async runtime so reqwest::Client and any
            // spawned tasks live on the same runtime that drives async commands.
            let state = tauri::async_runtime::block_on(AppState::new());
            app.manage(state);
            Ok(())
        })
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
