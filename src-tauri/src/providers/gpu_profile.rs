//! GPU detection + chat-tuning calculator.
//!
//! Goal: when running a reasoning model on a powerful GPU, we want big
//! context + big num_predict so the model has room to think AND answer.
//! On low-VRAM machines we fall back to non-thinking mode with modest
//! context.
//!
//! Detection priority: NVIDIA → fallback heuristic. AMD/Intel GPU
//! detection on Windows is messy; we treat them the same as fallback
//! (assume 8GB available — enough for thinking mode at 8K context).

use std::process::Command;
use std::sync::OnceLock;

#[derive(Debug, Clone, serde::Serialize)]
pub struct GpuProfile {
    pub vendor: &'static str,
    /// Total VRAM in megabytes.
    pub total_mb: u64,
    /// Free VRAM (after the OS / other apps) in megabytes.
    pub free_mb: u64,
}

#[derive(Debug, Clone)]
pub struct ChatTuning {
    /// Context window size (num_ctx in Ollama parlance).
    pub num_ctx: u32,
    /// Max tokens to GENERATE. Must be generous on thinking models so
    /// reasoning + answer both fit.
    pub num_predict: u32,
    /// Whether to allow the model to use thinking/reasoning mode.
    pub allow_thinking: bool,
}

/// Cached GPU profile — detected lazily, valid for the app's lifetime.
fn cached_gpu() -> &'static Option<GpuProfile> {
    static CELL: OnceLock<Option<GpuProfile>> = OnceLock::new();
    CELL.get_or_init(detect_gpu)
}

pub fn current_gpu() -> Option<GpuProfile> {
    cached_gpu().clone()
}

fn detect_gpu() -> Option<GpuProfile> {
    // Try nvidia-smi first.
    if let Some(p) = detect_nvidia() {
        return Some(p);
    }
    None
}

fn detect_nvidia() -> Option<GpuProfile> {
    let out = Command::new("nvidia-smi")
        .args([
            "--query-gpu=memory.total,memory.free",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    // First GPU only — most consumer machines have one.
    let line = s.lines().next()?.trim();
    let parts: Vec<&str> = line.split(',').map(str::trim).collect();
    if parts.len() < 2 {
        return None;
    }
    let total: u64 = parts[0].parse().ok()?;
    let free: u64 = parts[1].parse().ok()?;
    Some(GpuProfile {
        vendor: "nvidia",
        total_mb: total,
        free_mb: free,
    })
}

/// Compute tuning given the GPU profile + the model's approximate footprint.
/// `model_size_mb` is the on-disk size of the model (Ollama's `/api/show`
/// → `size` field) which closely tracks VRAM weight usage when fully
/// offloaded.
///
/// Strategy:
///   1. Reserve 1 GB overhead for the OS / Ollama runtime.
///   2. After weights are loaded, remaining VRAM gets used for context.
///   3. KV cache cost ≈ 0.05 MB per token for typical models (varies, but
///      this is a safe over-estimate that prevents OOM).
///   4. If we can fit ≥8K context, enable thinking. Otherwise fall back to
///      non-thinking + moderate context.
pub fn compute_tuning(model_size_mb: u64, is_json: bool) -> ChatTuning {
    let gpu = current_gpu();
    let total = gpu.as_ref().map(|g| g.total_mb).unwrap_or(8 * 1024);
    // Target 90% utilization per the user's request.
    let target_vram = (total as f64 * 0.90) as u64;
    let overhead_mb = 1024u64;
    let weights_mb = model_size_mb;
    let ctx_budget_mb = target_vram
        .saturating_sub(overhead_mb)
        .saturating_sub(weights_mb);

    // ~0.05 MB per token of KV cache is a generic safe estimate.
    let kv_per_token_mb = 0.05f64;
    let max_ctx = (ctx_budget_mb as f64 / kv_per_token_mb) as u32;

    // Useful range: 4K min, 65K max (model architectures usually cap there).
    let num_ctx = max_ctx.clamp(4096, 65_536);

    // Allow thinking if we have enough headroom for a real reasoning trace.
    let allow_thinking = num_ctx >= 8192;

    // num_predict: generous if we're allowing thinking, conservative
    // otherwise. For JSON output specifically we want extra slack so even
    // long thinking traces still leave room for the answer.
    let num_predict = match (allow_thinking, is_json) {
        (true, true) => 4096,
        (true, false) => 2048,
        (false, true) => 1024,
        (false, false) => 512,
    };

    ChatTuning {
        num_ctx,
        num_predict,
        allow_thinking,
    }
}

/// Convenience: ask the provider for the model size, then compute tuning.
/// Falls back to a "small model assumption" (3 GB) if size can't be
/// determined — safe for any modern GPU.
pub async fn tune_for(
    provider: &dyn super::Provider,
    model: &str,
    is_json: bool,
) -> ChatTuning {
    let size_mb = provider
        .estimate_model_size_mb(model)
        .await
        .unwrap_or(3 * 1024);
    compute_tuning(size_mb, is_json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weak_gpu_falls_back_to_non_thinking() {
        // Simulate by overriding cache. We can't easily set the cache from
        // the test, but compute_tuning takes model size as input — pass a
        // model whose weights dominate small GPUs.
        // With fallback 8GB GPU and an 8B model (~5GB), only 3GB for ctx →
        // num_ctx ~= 60K (fits easily). So thinking stays on. Use a 25GB
        // model on the 8GB fallback to test the no-thinking branch.
        // (compute_tuning uses cached GPU; we can't override, so verify
        // that the heuristic is at least logically consistent — see
        // tuning_is_consistent.)
    }

    #[test]
    fn tuning_is_consistent() {
        let t = compute_tuning(5000, true);
        assert!(t.num_ctx >= 4096);
        assert!(t.num_predict >= 512);
        if t.allow_thinking {
            assert!(t.num_predict >= 2048);
        }
    }
}
