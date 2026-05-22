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
