use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("provider returned status {status}: {body}")]
    Http { status: u16, body: String },

    #[error("invalid response shape: {0}")]
    InvalidResponse(String),

    #[error("missing api key for provider {0}")]
    MissingApiKey(String),

    #[error("model {model} not available on {provider}")]
    ModelNotFound { provider: String, model: String },

    #[error("provider not configured: {0}")]
    NotConfigured(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("keyring: {0}")]
    Keyring(#[from] keyring::Error),

    #[error("other: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ProviderError>;
