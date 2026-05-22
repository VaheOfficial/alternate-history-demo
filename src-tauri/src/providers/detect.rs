use reqwest::Client;
use serde::Serialize;
use std::time::Duration;

use super::types::ProviderKind;

#[derive(Debug, Clone, Serialize)]
pub struct DetectedProvider {
    pub kind: ProviderKind,
    pub display_name: String,
    pub base_url: String,
    pub probe_path: String,
}

#[derive(Debug, Clone, Copy)]
struct ProbeTarget {
    kind: ProviderKind,
    display_name: &'static str,
    port: u16,
    probe_path: &'static str,
}

const PROBES: &[ProbeTarget] = &[
    ProbeTarget {
        kind: ProviderKind::Ollama,
        display_name: "Ollama",
        port: 11434,
        probe_path: "/api/tags",
    },
    ProbeTarget {
        kind: ProviderKind::LmStudio,
        display_name: "LM Studio",
        port: 1234,
        probe_path: "/v1/models",
    },
    ProbeTarget {
        kind: ProviderKind::LlamaCpp,
        display_name: "llama.cpp",
        port: 8080,
        probe_path: "/v1/models",
    },
    ProbeTarget {
        kind: ProviderKind::KoboldCpp,
        display_name: "KoboldCpp",
        port: 5001,
        probe_path: "/api/v1/info/version",
    },
];

pub async fn detect_local_providers() -> Vec<DetectedProvider> {
    let client = Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .expect("client build");

    let probes = PROBES.iter().map(|p| {
        let client = client.clone();
        let p = *p;
        async move {
            let url = format!("http://localhost:{}{}", p.port, p.probe_path);
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => Some(DetectedProvider {
                    kind: p.kind,
                    display_name: p.display_name.into(),
                    base_url: format!("http://localhost:{}", p.port),
                    probe_path: p.probe_path.into(),
                }),
                _ => None,
            }
        }
    });

    let results = futures_util::future::join_all(probes).await;
    results.into_iter().flatten().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn detect_against_known_servers() {
        // Smoke test: function returns Vec without panic regardless of what is running locally.
        let detected = detect_local_providers().await;
        let _ = detected;
    }
}
