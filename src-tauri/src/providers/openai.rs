use super::openai_compatible::OpenAICompatProvider;
use super::types::ProviderKind;

pub fn new_openai(name: impl Into<String>, api_key: String) -> OpenAICompatProvider {
    OpenAICompatProvider::new(
        name,
        ProviderKind::OpenAi,
        "https://api.openai.com",
        Some(api_key),
    )
}
