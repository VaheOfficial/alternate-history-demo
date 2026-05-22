//! Snapshot migrations.
//!
//! When the scenario seed formula changes between game versions, older saves
//! end up with stale Nation stats. Rather than version-gate everything, we
//! detect telltale signs of the OLD placeholder formula and rewrite the
//! affected fields from the canonical (countries.json + GDP-tax-rate) source.
//!
//! What we DO NOT touch:
//!   - Province ownership (player conquests must survive)
//!   - Goals (player + LLM may have edited)
//!   - Relations + treaties
//!   - Events history
//!
//! Only Nation.{population, gdp, manpower_pool, treasury, industry_capacity,
//! map_color} get refreshed if they look like the old placeholders.

use std::collections::HashMap;

use serde::Deserialize;

use super::world::World;

const COUNTRIES_JSON: &str = include_str!("../../../public/countries.json");

#[derive(Debug, Deserialize)]
struct CountryRow {
    iso_a3: String,
    #[allow(dead_code)]
    name: String,
    #[serde(default)]
    population: i64,
    #[serde(default)]
    gdp_million_usd: i64,
    #[serde(default)]
    map_color: u8,
}

#[derive(Debug, Deserialize)]
struct CountriesFile {
    countries: Vec<CountryRow>,
}

/// Refresh nation stats from canonical source if the snapshot looks stale.
/// Returns `true` if anything was changed.
///
/// Heuristic for "stale": at least one Nation has population that's an exact
/// multiple of 2_000_000 (old `prov_count * 2_000_000` formula) AND less than
/// 300_000_000. That's a strong tell.
pub fn migrate_stale_stats(world: &mut World) -> bool {
    let stale = world.nations.iter().any(|n| {
        n.population > 0
            && n.population < 300_000_000
            && n.population % 2_000_000 == 0
    });
    if !stale {
        return false;
    }

    let file: CountriesFile = match serde_json::from_str(COUNTRIES_JSON) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let by_iso: HashMap<&str, &CountryRow> = file
        .countries
        .iter()
        .map(|c| (c.iso_a3.as_str(), c))
        .collect();

    let mut changed = false;
    for nation in &mut world.nations {
        let Some(row) = by_iso.get(nation.iso_a3.as_str()) else {
            continue;
        };
        if row.population <= 0 {
            continue;
        }
        // Treat as stale only if THIS nation matches the old formula.
        let this_stale = nation.population > 0
            && nation.population < 300_000_000
            && nation.population % 2_000_000 == 0;
        if !this_stale {
            continue;
        }

        nation.population = row.population;
        if row.gdp_million_usd > 0 {
            nation.gdp = row.gdp_million_usd.saturating_mul(1_000_000);
        }
        nation.manpower_pool = ((nation.population as f64 * 0.035) as i64).max(10_000);
        nation.treasury = nation.gdp / 10;
        if nation.gdp > 0 {
            let log_billions = ((nation.gdp as f64) / 1.0e9).max(1.0).log10();
            nation.industry_capacity = ((log_billions * 12.0) as u32).clamp(1, 200);
        }
        if row.map_color >= 1 && row.map_color <= 13 {
            nation.map_color = row.map_color;
        }
        changed = true;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::ids::{BranchId, SaveId};
    use crate::world::scenario::build_modern_world;
    use chrono::NaiveDate;

    #[test]
    fn fresh_world_is_not_flagged_stale() {
        let mut w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        assert!(!migrate_stale_stats(&mut w));
    }

    #[test]
    fn old_formula_world_gets_refreshed() {
        let mut w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        // Roll back to old formula.
        for n in &mut w.nations {
            n.population = 50i64 * 2_000_000;
        }
        let changed = migrate_stale_stats(&mut w);
        assert!(changed);
        let usa = w.nations.iter().find(|n| n.iso_a3 == "USA").unwrap();
        assert!(
            usa.population > 300_000_000,
            "USA should be 328M+ after migration, got {}",
            usa.population
        );
    }
}
