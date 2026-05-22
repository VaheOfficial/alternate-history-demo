//! Scenario seeder — builds a `World` from the bundled Natural Earth data.
//!
//! Right now there's one scenario: "Modern Day" — all 258 countries with their
//! real provinces, default tech/doctrine, no units. This is the baseline for
//! Plan 04. Later scenarios (1914, 1939, 1962) live alongside this.

use std::collections::HashMap;

use chrono::NaiveDate;
use serde::Deserialize;

use super::clock::GameClock;
use super::ids::{BranchId, NationId, NpcId, ProvinceId, SaveId};
use super::nation::{
    DoctrineId, GovernmentType, IndustrySplit, Nation, ResourceStockpile, TechLevel,
};
use super::npc::{
    Ideology, Npc, NpcPersona, NpcRole, PersonaArchetype, SpeechStyle,
};
use super::province::{Province, ResourceYield, Terrain};
use super::world::World;

// The map pipeline writes these into `public/`. We embed them at compile time
// so the seeder works offline and doesn't depend on Tauri resource paths.
const COUNTRIES_JSON: &str = include_str!("../../../public/countries.json");
const PROVINCES_META_JSON: &str = include_str!("../../../public/world-meta.json");

#[derive(Debug, Deserialize)]
struct CountryRow {
    iso_a3: String,
    name: String,
    #[allow(dead_code)]
    formal_name: String,
    map_color: u8,
    #[allow(dead_code)]
    continent: String,
    #[allow(dead_code)]
    label_lon: f64,
    #[allow(dead_code)]
    label_lat: f64,
}

#[derive(Debug, Deserialize)]
struct CountriesFile {
    countries: Vec<CountryRow>,
}

#[derive(Debug, Deserialize)]
struct ProvinceRow {
    shape_id: String,
    name: String,
    iso_country: String,
}

#[derive(Debug, Deserialize)]
struct ProvincesFile {
    provinces: Vec<ProvinceRow>,
}

/// Tiny ISO3 → GovernmentType table. Anything not listed defaults to
/// Democracy. Intentionally compact — the LLM will refine over time.
fn government_for(iso: &str) -> GovernmentType {
    match iso {
        "CHN" | "VNM" | "CUB" | "LAO" | "PRK" => GovernmentType::Communist,
        "SAU" | "JOR" | "MAR" | "OMN" | "QAT" | "BHR" | "KWT" | "THA" | "JPN" | "SWE"
        | "NOR" | "DNK" | "GBR" | "NLD" | "BEL" | "ESP" | "MYS" | "BRN" | "TON"
        | "LSO" | "BTN" | "CAM" | "LIE" | "MCO" | "LUX" | "AND" | "SWZ" => {
            GovernmentType::Monarchy
        }
        "IRN" | "VAT" => GovernmentType::Theocracy,
        "MMR" | "TCD" | "MLI" | "BFA" | "SDN" | "ERI" => GovernmentType::MilitaryJunta,
        "RUS" | "BLR" | "TKM" | "TJK" | "VEN" | "NIC" | "ZWE" | "SYR" | "EGY" => {
            GovernmentType::Fascist
        }
        _ => GovernmentType::Democracy,
    }
}

/// Coarse doctrine pick — large land powers default to Mass Assault, naval /
/// island states to Defense in Depth, technologically advanced western nations
/// to Mobile Warfare, everyone else to Superior Firepower. Refinable later.
fn doctrine_for(iso: &str) -> DoctrineId {
    match iso {
        "USA" | "GBR" | "FRA" | "DEU" | "ISR" | "AUS" | "CAN" | "JPN" | "KOR" => {
            DoctrineId::MobileWarfare
        }
        "RUS" | "CHN" | "PRK" | "IND" | "PAK" | "IRN" => DoctrineId::MassAssault,
        "NZL" | "PHL" | "IDN" | "MYS" | "SGP" | "JAM" | "CUB" | "TWN" => {
            DoctrineId::DefenseInDepth
        }
        _ => DoctrineId::SuperiorFirepower,
    }
}

/// Construct a "Modern Day" world. Every ISO3 with at least one province gets
/// a Nation; every province from `world-meta.json` becomes a Province owned by
/// that Nation.
pub fn build_modern_world(save: SaveId, branch: BranchId, start: NaiveDate) -> World {
    let countries: CountriesFile =
        serde_json::from_str(COUNTRIES_JSON).expect("countries.json embedded at build time");
    let provinces: ProvincesFile = serde_json::from_str(PROVINCES_META_JSON)
        .expect("world-meta.json embedded at build time");

    // Group provinces by iso_country up front so we can size Nation stats by
    // territory count.
    let mut provinces_by_iso: HashMap<String, Vec<&ProvinceRow>> = HashMap::new();
    for p in &provinces.provinces {
        if p.iso_country.is_empty() {
            continue;
        }
        provinces_by_iso
            .entry(p.iso_country.clone())
            .or_default()
            .push(p);
    }

    // Build a Nation for every country that has at least one province.
    let country_by_iso: HashMap<&str, &CountryRow> = countries
        .countries
        .iter()
        .map(|c| (c.iso_a3.as_str(), c))
        .collect();

    let mut nations: Vec<Nation> = Vec::with_capacity(provinces_by_iso.len());
    let mut npcs: Vec<Npc> = Vec::new();
    let mut nation_by_iso: HashMap<String, NationId> = HashMap::new();

    for (iso, prov_rows) in &provinces_by_iso {
        let display_name = country_by_iso
            .get(iso.as_str())
            .map(|c| c.name.as_str())
            .unwrap_or(iso.as_str());
        let map_color = country_by_iso
            .get(iso.as_str())
            .map(|c| c.map_color)
            .unwrap_or(1);

        let nation_id = NationId::new();
        let leader_id = NpcId::new();

        // Rough nation-size proxy: number of provinces. Real numbers will come
        // from per-country tables later. For now: 1k pop per "scale unit",
        // 100 industry, treasury proportional.
        let prov_count = prov_rows.len() as i64;
        let population = prov_count.saturating_mul(2_000_000);
        let manpower = (population / 25).max(50_000);
        let gdp = prov_count * 50_000_000_000; // very rough; refined later
        let treasury = gdp / 20;
        let industry = (prov_count as u32 * 2).max(5);

        npcs.push(Npc {
            id: leader_id,
            name: format!("Leader of {}", display_name),
            nation: nation_id,
            role: NpcRole::Leader,
            persona: NpcPersona {
                archetype: PersonaArchetype::Pragmatist,
                traits: Vec::new(),
                speech_style: SpeechStyle::Formal,
                ideology: Ideology::Centrist,
                historical_quirks: Vec::new(),
            },
            opinion_of_player: 0,
            grudges: Vec::new(),
            relationships: HashMap::new(),
        });

        nations.push(Nation {
            id: nation_id,
            name: display_name.to_string(),
            iso_a3: iso.clone(),
            government: government_for(iso),
            leader: leader_id,
            treasury,
            gdp,
            population,
            manpower_pool: manpower,
            stability: 55,
            war_support: 10,
            industry_capacity: industry,
            industry_split: IndustrySplit::default(),
            resources: ResourceStockpile::default(),
            tech: TechLevel(5),
            doctrine: doctrine_for(iso),
            map_color,
            relations: HashMap::new(),
            build_queue: Vec::new(),
        });

        nation_by_iso.insert(iso.clone(), nation_id);
    }

    // Build provinces, each owned by its iso_country's Nation.
    let mut out_provinces: Vec<Province> = Vec::with_capacity(provinces.provinces.len());
    for p in &provinces.provinces {
        let Some(owner) = nation_by_iso.get(&p.iso_country) else {
            continue;
        };
        out_provinces.push(Province {
            id: ProvinceId::new(),
            name: p.name.clone(),
            geometry_ref: p.shape_id.clone(),
            owner: *owner,
            core_of: vec![*owner],
            terrain: Terrain::Plains, // refined later from a terrain map
            population: 1_000_000,    // placeholder
            base_industry: 1,
            base_resources: ResourceYield::default(),
            supply_value: 1,
            is_capital: false,
            is_supply_hub: false,
        });
    }

    World {
        save_id: save,
        branch_id: branch,
        clock: GameClock::new(start),
        player_nation: None,
        nations,
        provinces: out_provinces,
        units: vec![],
        npcs,
        treaties: vec![],
        crises: vec![],
        frontlines: vec![],
        events: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modern_world_has_many_nations_and_provinces() {
        let w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        // Sanity bounds — Natural Earth has 200+ countries, 4000+ provinces.
        assert!(w.nations.len() >= 180, "got {} nations", w.nations.len());
        assert!(
            w.provinces.len() >= 3_500,
            "got {} provinces",
            w.provinces.len()
        );
    }

    #[test]
    fn every_province_has_an_existing_owner() {
        let w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let nation_ids: std::collections::HashSet<NationId> =
            w.nations.iter().map(|n| n.id).collect();
        for p in &w.provinces {
            assert!(nation_ids.contains(&p.owner));
        }
    }

    #[test]
    fn usa_exists_and_has_provinces() {
        let w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let usa = w
            .nations
            .iter()
            .find(|n| n.iso_a3 == "USA")
            .expect("USA missing");
        let n = w.provinces.iter().filter(|p| p.owner == usa.id).count();
        assert!(n >= 50, "USA has only {} provinces", n);
    }
}
