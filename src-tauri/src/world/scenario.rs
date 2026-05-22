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
use super::treaty::{Treaty, TreatyKind, TreatyTerms};
use super::world::World;
use super::ids::TreatyId;

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
    #[serde(default)]
    population: i64,
    #[serde(default)]
    gdp_million_usd: i64,
    #[serde(default)]
    #[allow(dead_code)]
    pop_rank: u8,
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
    #[serde(default)]
    area_deg2: f64,
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

/// Static goal seeds for the major nations. Anything not listed gets a
/// generic "preserve sovereignty and trade" — the LLM refines as a nation
/// acts. Goals are short, action-oriented, deliberately a bit opinionated
/// so the world has flavor on day one.
fn goals_for(iso: &str) -> Vec<String> {
    let preset: &[(&str, &[&str])] = &[
        ("USA", &["maintain global naval supremacy", "contain authoritarian blocs", "secure energy and chip supply chains"]),
        ("CHN", &["reunify Taiwan on Chinese terms", "expand BRI influence in the Global South", "dominate semiconductor & EV markets"]),
        ("RUS", &["restore sphere of influence over post-Soviet space", "weaken NATO cohesion", "secure Arctic resource claims"]),
        ("GBR", &["preserve special relationship with USA", "lead European security outside EU", "project naval power east of Suez"]),
        ("FRA", &["lead a strategically autonomous EU", "stabilize the Sahel", "maintain Pacific presence via overseas territories"]),
        ("DEU", &["anchor EU industrial policy", "transition energy away from fossil fuels", "rebuild deterrent military credibility"]),
        ("IND", &["counter Chinese assertiveness in the Indo-Pacific", "modernize the military", "lead the Global South diplomatically"]),
        ("JPN", &["counter Chinese & North Korean threats", "deepen US alliance", "secure undersea cable + semiconductor flow"]),
        ("KOR", &["deter North Korean aggression", "diversify supply chains away from China", "expand soft-power reach"]),
        ("PRK", &["preserve regime survival", "extract aid via brinkmanship", "complete tactical nuclear arsenal"]),
        ("TUR", &["lead Sunni Muslim diplomacy", "control Eastern Mediterranean energy routes", "balance Russia and NATO"]),
        ("IRN", &["expand axis of resistance influence", "achieve nuclear threshold capability", "evade sanctions through China & Russia"]),
        ("ISR", &["degrade Iran-aligned militias", "expand Abraham-Accords normalization", "secure Negev tech corridor"]),
        ("SAU", &["lead Sunni Arab world", "diversify economy beyond oil", "balance USA and China"]),
        ("ARE", &["become regional logistics + finance hub", "diversify beyond hydrocarbons", "play balanced great-power game"]),
        ("EGY", &["preserve Suez Canal revenue", "stabilize the south (Sudan, Libya)", "manage Nile water security with Ethiopia"]),
        ("PAK", &["maintain nuclear parity with India", "navigate China-US balance", "stabilize border regions"]),
        ("UKR", &["reclaim full sovereignty over occupied territory", "secure EU+NATO accession path", "rebuild war-shattered economy"]),
        ("POL", &["lead Eastern NATO frontier defense", "build largest European land army", "decouple from Russian energy"]),
        ("AUS", &["counter Chinese influence in Pacific", "deepen AUKUS submarine program", "secure critical-minerals trade"]),
        ("BRA", &["lead South American bloc", "balance USA-China without alignment", "preserve Amazon while developing economy"]),
        ("MEX", &["manage USA migration politics", "modernize industry via nearshoring", "contain cartel violence"]),
        ("CAN", &["assert Arctic sovereignty", "diversify trade beyond USA", "lead on critical minerals supply"]),
        ("ITA", &["lead Mediterranean migration diplomacy", "anchor Southern EU", "maintain influence in Libya & Horn of Africa"]),
        ("ESP", &["lead EU Mediterranean policy", "anchor Latin-American ties", "secure renewable-energy transition"]),
        ("NLD", &["lead EU trade + semiconductor policy", "host international rules-based institutions"]),
        ("SWE", &["lock in NATO membership benefits", "strengthen Baltic defense"]),
        ("FIN", &["secure long Russian border", "deepen Nordic-Baltic defense integration"]),
        ("NOR", &["lead Arctic & North Atlantic security", "manage energy export politics"]),
        ("CHE", &["preserve armed neutrality", "remain global financial hub"]),
        ("ZAF", &["lead African Union diplomacy", "preserve BRICS leverage", "manage post-load-shedding economy"]),
        ("NGA", &["lead West African security", "diversify beyond oil", "contain insurgencies in north"]),
        ("ETH", &["assert regional hegemony", "complete GERD dam politics with Egypt", "recover from internal conflicts"]),
        ("ARG", &["stabilize chronic inflation", "monetize Vaca Muerta + lithium", "deepen Mercosur"]),
        ("CHL", &["preserve copper + lithium leverage", "navigate Pacific trade politics"]),
        ("VNM", &["balance USA-China to preserve sovereignty", "climb electronics manufacturing ladder"]),
        ("PHL", &["counter Chinese South-China-Sea claims", "deepen US alliance", "secure West Philippine Sea"]),
        ("IDN", &["lead ASEAN diplomatic centrality", "navigate USA-China without alignment"]),
        ("THA", &["balance USA-China", "preserve monarchy + political stability"]),
        ("BLR", &["preserve regime survival via Russian backing"]),
        ("KAZ", &["balance Russia & China", "diversify pipeline routes westward"]),
        ("VEN", &["preserve regime", "monetize oil reserves through China + Russia"]),
        ("CUB", &["preserve revolutionary continuity", "navigate USA pressure"]),
    ];
    for (key, goals) in preset {
        if *key == iso {
            return goals.iter().map(|s| s.to_string()).collect();
        }
    }
    vec![
        "preserve sovereignty and territorial integrity".into(),
        "grow the economy and stabilize society".into(),
    ]
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
        let country_row = country_by_iso.get(iso.as_str()).copied();
        let display_name = country_row
            .map(|c| c.name.as_str())
            .unwrap_or(iso.as_str());
        let map_color = country_row.map(|c| c.map_color).unwrap_or(1);

        let nation_id = NationId::new();
        let leader_id = NpcId::new();

        // Real population + GDP from Natural Earth. Fall back to crude
        // province-count estimates if the join misses (rare; covers obscure
        // territories without country metadata).
        let prov_count = prov_rows.len() as i64;
        let population = match country_row {
            Some(c) if c.population > 0 => c.population,
            _ => prov_count.saturating_mul(500_000),
        };
        // GDP_MD is in millions; multiply by 1M for raw USD.
        let gdp = match country_row {
            Some(c) if c.gdp_million_usd > 0 => c.gdp_million_usd.saturating_mul(1_000_000),
            _ => prov_count.saturating_mul(5_000_000_000),
        };
        // Manpower proxy: ~3.5% of population (military-age × willingness).
        let manpower = ((population as f64 * 0.035) as i64).max(10_000);
        // Treasury starts ~10% of GDP.
        let treasury = gdp / 10;
        // Industry proxy: log10(GDP_USD / 1e9), clamped to 1..200. So $1T GDP
        // ≈ 30 IC, $20T ≈ 43 IC. Refined later by tech + production rules.
        let industry = if gdp > 0 {
            let log_billions = ((gdp as f64) / 1.0e9).max(1.0).log10();
            ((log_billions * 12.0) as u32).clamp(1, 200)
        } else {
            5
        };

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
            goals: goals_for(iso),
        });

        nation_by_iso.insert(iso.clone(), nation_id);
    }

    // Build provinces. Each province gets:
    //   - population: country POP_EST distributed by area share (with a floor
    //     so even tiny islands aren't zero)
    //   - base_industry: country industry distributed by area share too,
    //     biased slightly toward larger provinces
    //   - supply_value: scales with area (bigger = more supply to draw from)
    let nation_by_iso_ref = &nation_by_iso;
    let nations_ref = &nations;
    // Build a small helper map: iso → (total_area, country_pop, country_industry)
    let mut country_summary: HashMap<&str, (f64, i64, u32)> = HashMap::new();
    for (iso, rows) in &provinces_by_iso {
        let total_area: f64 = rows.iter().map(|r| r.area_deg2.max(0.0)).sum::<f64>();
        let Some(nid) = nation_by_iso_ref.get(iso) else {
            continue;
        };
        let Some(n) = nations_ref.iter().find(|n| n.id == *nid) else {
            continue;
        };
        country_summary.insert(iso.as_str(), (total_area, n.population, n.industry_capacity));
    }

    let mut out_provinces: Vec<Province> = Vec::with_capacity(provinces.provinces.len());
    for p in &provinces.provinces {
        let Some(owner) = nation_by_iso_ref.get(&p.iso_country) else {
            continue;
        };
        let (total_area, country_pop, country_industry) = country_summary
            .get(p.iso_country.as_str())
            .copied()
            .unwrap_or((0.0, 1_000_000, 5));

        let prov_area = p.area_deg2.max(0.0);
        let share = if total_area > 0.0 {
            (prov_area / total_area).clamp(0.0, 1.0)
        } else {
            0.0
        };

        // Population: floor of 5k so tiny islands don't end up at zero.
        let prov_pop =
            ((country_pop as f64 * share) as i64).max(5_000);
        // Industry distributed by area but only if country has ≥5 IC to share.
        let prov_ind = if country_industry >= 5 {
            ((country_industry as f64 * share) as u32).max(0)
        } else {
            0
        };
        // Supply: area-bucketed 1..10. Bigger province = more supply.
        let supply = ((prov_area * 8.0) as u32).clamp(1, 10);

        out_provinces.push(Province {
            id: ProvinceId::new(),
            name: p.name.clone(),
            geometry_ref: p.shape_id.clone(),
            owner: *owner,
            core_of: vec![*owner],
            terrain: Terrain::Plains, // refined later from a terrain map
            population: prov_pop,
            base_industry: prov_ind,
            base_resources: ResourceYield::default(),
            supply_value: supply,
            is_capital: false,
            is_supply_hub: false,
        });
    }

    let treaties = seed_alliances(&nation_by_iso, start);

    World {
        save_id: save,
        branch_id: branch,
        clock: GameClock::new(start),
        player_nation: None,
        nations,
        provinces: out_provinces,
        units: vec![],
        npcs,
        treaties,
        crises: vec![],
        frontlines: vec![],
        events: vec![],
    }
}

/// Seed the major modern-day alliances and blocs as initial Treaties. Membership
/// lists are correct as of ~2024; LLM can mutate via sign_treaty mid-game.
fn seed_alliances(
    nation_by_iso: &HashMap<String, NationId>,
    signed_on: chrono::NaiveDate,
) -> Vec<Treaty> {
    let blocs: &[(&str, TreatyKind, &[&str])] = &[
        (
            "NATO",
            TreatyKind::DefensivePact,
            &[
                "USA", "CAN", "GBR", "FRA", "DEU", "ITA", "ESP", "PRT", "BEL", "NLD",
                "LUX", "DNK", "NOR", "ISL", "TUR", "GRC", "POL", "CZE", "HUN", "SVK",
                "SVN", "EST", "LVA", "LTU", "BGR", "ROU", "HRV", "ALB", "MNE", "MKD",
                "FIN", "SWE",
            ],
        ),
        (
            "CSTO",
            TreatyKind::DefensivePact,
            &["RUS", "BLR", "ARM", "KAZ", "KGZ", "TJK"],
        ),
        (
            "European Union",
            TreatyKind::TradeAgreement,
            &[
                "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA",
                "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD",
                "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE",
            ],
        ),
        (
            "AUKUS",
            TreatyKind::DefensivePact,
            &["AUS", "GBR", "USA"],
        ),
        (
            "ANZUS",
            TreatyKind::DefensivePact,
            &["AUS", "NZL", "USA"],
        ),
        (
            "Arab League",
            TreatyKind::Alliance,
            &[
                "DZA", "BHR", "COM", "DJI", "EGY", "IRQ", "JOR", "KWT", "LBN", "LBY",
                "MAR", "MRT", "OMN", "PSE", "QAT", "SAU", "SOM", "SDN", "SYR", "TUN",
                "ARE", "YEM",
            ],
        ),
        (
            "USMCA",
            TreatyKind::TradeAgreement,
            &["USA", "CAN", "MEX"],
        ),
        (
            "BRICS",
            TreatyKind::TradeAgreement,
            &["BRA", "RUS", "IND", "CHN", "ZAF", "EGY", "ETH", "IRN", "ARE"],
        ),
    ];

    let mut treaties = Vec::new();
    for (name, kind, members) in blocs {
        let parties: Vec<NationId> = members
            .iter()
            .filter_map(|iso| nation_by_iso.get(*iso).copied())
            .collect();
        if parties.len() < 2 {
            continue; // skip if too few members exist in the world
        }
        treaties.push(Treaty {
            id: TreatyId::new(),
            kind: *kind,
            parties,
            signed_on,
            expires_on: None,
            terms: TreatyTerms {
                territory_transfers: Vec::new(),
                tribute_per_year: 0,
                extra_clauses: vec![format!("{} member", name)],
            },
        });
    }
    treaties
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
        // Sanity bounds: NE admin_0 has 250+ countries; post-tile-clustering
        // we get ~2500 provinces (down from raw 4596 — see cluster-provinces.ts).
        assert!(w.nations.len() >= 180, "got {} nations", w.nations.len());
        assert!(
            w.provinces.len() >= 1_500,
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
        // USA caps at 25 after tile-clustering — was 50, dialed down so big
        // countries don't drown the map in micro-tiles. See cluster-provinces.ts.
        assert!(n >= 20, "USA has only {} provinces", n);
    }
}
