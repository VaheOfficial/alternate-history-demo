//! Province adjacency lookup.
//!
//! The map-build pipeline writes `public/province-adjacency.json` with a
//! flat shape_id → neighbours map (5,758 edges, 2,653 provinces in the
//! current Natural Earth scenario). We embed it at compile time so the
//! engine can resolve MoveUnit actions without the caller passing the
//! adjacency map every time.
//!
//! Why this exists: NPC turns call `apply_actions(..., None)` — without a
//! shared default, every AI-emitted MoveUnit silently fails with
//! "adjacency map not provided". The frontend has its own copy that gets
//! passed for player-issued moves, but the NPC path needs the same data
//! server-side.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

const ADJACENCY_JSON: &str =
    include_str!("../../../public/province-adjacency.json");

#[derive(Debug, Deserialize)]
struct AdjacencyFile {
    adjacency: HashMap<String, Vec<String>>,
}

static CACHED: OnceLock<HashMap<String, Vec<String>>> = OnceLock::new();

/// Borrow the shared adjacency map. Parses the embedded JSON on first call.
/// Subsequent calls are O(1).
pub fn default_adjacency() -> &'static HashMap<String, Vec<String>> {
    CACHED.get_or_init(|| {
        serde_json::from_str::<AdjacencyFile>(ADJACENCY_JSON)
            .map(|f| f.adjacency)
            .unwrap_or_default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_adjacency_parses_and_has_edges() {
        let map = default_adjacency();
        assert!(
            map.len() > 1500,
            "expected the full adjacency map, got {} keys",
            map.len()
        );
        // Spot check: an Argentine province should have neighbours.
        let arg = map.get("ARG|ARG-1309");
        assert!(arg.is_some() && !arg.unwrap().is_empty());
    }
}
