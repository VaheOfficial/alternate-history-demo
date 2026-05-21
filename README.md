# Alternate History Demo

LLM-driven alternate-history game, BYO model.

A desktop app (Tauri) where the LLM backend is *yours* — your local Ollama instance,
your OpenAI/Anthropic/OpenRouter API key, or any OpenAI-compatible endpoint. No token
billing from us; the game runs on your GPU or your API quota.

## Stack

- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Rust (Tauri 2)
- **LLM providers:** pluggable (Ollama / OpenAI-compatible — TBD)
- **Distribution:** native installers per OS (MSI/NSIS on Windows, DMG on macOS, AppImage/deb on Linux), auto-updating

## Development

Prereqs: Node 24+, pnpm, Rust stable (MSVC on Windows), Visual Studio Build Tools, WebView2 runtime.

```
pnpm install
pnpm tauri dev      # run the app in dev mode (hot reload)
pnpm tauri build    # produce a release installer
```

The Rust toolchain is pinned to `stable-x86_64-pc-windows-msvc` via `rust-toolchain.toml`
so this project doesn't depend on your global rustup default.
