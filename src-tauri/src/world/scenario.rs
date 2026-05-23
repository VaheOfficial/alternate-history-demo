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
use super::nation::UnitType;
use super::npc::{
    Ideology, Npc, NpcPersona, NpcRole, PersonaArchetype, SpeechStyle,
};
use super::province::{Province, ResourceYield, Terrain};
use super::treaty::{Treaty, TreatyKind, TreatyTerms};
use super::unit::{SupplyState, Unit};
use super::world::World;
use super::ids::{TreatyId, UnitId};

// The map pipeline writes these into `public/`. We embed them at compile time
// so the seeder works offline and doesn't depend on Tauri resource paths.
const COUNTRIES_JSON: &str = include_str!("../../../public/countries.json");
const PROVINCES_META_JSON: &str = include_str!("../../../public/world-meta.json");
const PROVINCE_ADJACENCY_JSON: &str =
    include_str!("../../../public/province-adjacency.json");

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

#[derive(Debug, Deserialize)]
struct AdjacencyFile {
    adjacency: HashMap<String, Vec<String>>,
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

/// Seed 3-5 factions per nation based on government type. The mix is
/// deliberately opinionated so Politics screen has flavor on day one —
/// theocracies start with a powerful Religious bloc, democracies with
/// a balanced Business/Intellectual/Populist mix, juntas heavily
/// Military, etc.
fn seed_factions(government: GovernmentType) -> Vec<crate::world::faction::Faction> {
    use crate::world::faction::{Faction, FactionArchetype as A};
    let entries: Vec<(A, u8, u8)> = match government {
        GovernmentType::Democracy => vec![
            (A::Business, 30, 55),
            (A::Intellectual, 20, 60),
            (A::Populist, 25, 50),
            (A::Military, 15, 55),
        ],
        GovernmentType::Republic => vec![
            (A::Business, 30, 50),
            (A::Military, 25, 55),
            (A::Intellectual, 20, 55),
            (A::Populist, 20, 50),
        ],
        GovernmentType::Monarchy => vec![
            (A::Military, 30, 60),
            (A::Religious, 25, 60),
            (A::Business, 25, 55),
            (A::Populist, 15, 45),
        ],
        GovernmentType::Communist => vec![
            (A::Military, 35, 55),
            (A::Populist, 25, 55),
            (A::Intellectual, 15, 50),
            (A::Business, 5, 35),
        ],
        GovernmentType::Fascist => vec![
            (A::Military, 45, 60),
            (A::Business, 25, 55),
            (A::Populist, 20, 50),
        ],
        GovernmentType::MilitaryJunta => vec![
            (A::Military, 60, 60),
            (A::Business, 20, 45),
            (A::Religious, 10, 45),
        ],
        GovernmentType::Theocracy => vec![
            (A::Religious, 55, 65),
            (A::Military, 25, 55),
            (A::Populist, 15, 50),
        ],
        GovernmentType::Other => vec![
            (A::Military, 25, 50),
            (A::Business, 25, 50),
            (A::Populist, 25, 50),
            (A::Intellectual, 15, 50),
        ],
    };
    entries
        .into_iter()
        .map(|(archetype, power, satisfaction)| Faction {
            archetype,
            power,
            satisfaction,
        })
        .collect()
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
            factions: seed_factions(government_for(iso)),
            research: Default::default(),
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
        let area_share = if total_area > 0.0 {
            (prov_area / total_area).clamp(0.0, 1.0)
        } else {
            0.0
        };

        // Population: distributed by area share with a 5k floor so tiny
        // islands don't end up at zero.
        let prov_pop = ((country_pop as f64 * area_share) as i64).max(5_000);

        // Industry: distributed by POPULATION share (urbanized regions
        // produce more), not area share. This avoids the bug where most
        // provinces showed 0 IC even when the country had ~50 to share —
        // big rural provinces stole all the share by area but had nothing
        // to industrialize with.
        //
        // Floor: any inhabited province (>100k people) gets at least 1 IC.
        let pop_share = if country_pop > 0 {
            (prov_pop as f64 / country_pop as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let raw_ind = (country_industry as f64 * pop_share).round() as u32;
        let prov_ind = if prov_pop >= 100_000 {
            raw_ind.max(1)
        } else {
            raw_ind
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
    let units = seed_units(&nations, &out_provinces, &provinces.provinces);

    #[allow(clippy::redundant_field_names)]
    World {
        save_id: save,
        branch_id: branch,
        clock: GameClock::new(start),
        player_nation: None,
        nations,
        provinces: out_provinces,
        units,
        npcs,
        treaties,
        crises: vec![],
        frontlines: vec![],
        events: vec![],
        pending: vec![],
        battle_plans: vec![],
        diplomatic_channels: vec![],
        victory: None,
        wars: vec![],
        production_orders: vec![],
        spy_missions: vec![],
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

/// Seed starting military units. Approximates HOI4-style divisions:
///   - Count scales with manpower_pool (capped 1..60).
///   - Type mix shifts with doctrine.
///   - Placement: 25% at the nation's largest-pop province ("capital
///     reserve"), 75% spread across BORDER PROVINCES (provinces with at
///     least one foreign neighbor in the adjacency graph). Distribution
///     weighted by population so big border regions get more.
///   - Nations with no land borders (islands) park everything at the
///     capital — there's nowhere else to deploy.
fn seed_units(
    nations: &[Nation],
    provinces: &[Province],
    raw_provinces: &[ProvinceRow],
) -> Vec<Unit> {
    // Parse adjacency once. If it fails, fall back to capital-only placement.
    let adjacency: HashMap<String, Vec<String>> = serde_json::from_str::<AdjacencyFile>(
        PROVINCE_ADJACENCY_JSON,
    )
    .map(|a| a.adjacency)
    .unwrap_or_default();

    // shape_id → iso_country lookup (so we can tell when a neighbour is foreign).
    let iso_by_shape: HashMap<&str, &str> = raw_provinces
        .iter()
        .map(|p| (p.shape_id.as_str(), p.iso_country.as_str()))
        .collect();

    let mut out: Vec<Unit> = Vec::new();
    for nation in nations {
        let nation_provinces: Vec<&Province> =
            provinces.iter().filter(|p| p.owner == nation.id).collect();
        let capital = nation_provinces.iter().copied().max_by_key(|p| p.population);
        let Some(capital) = capital else { continue };

        // Border provinces: at least one adjacent province whose iso_country
        // differs from this nation's iso.
        let nation_iso = nation.iso_a3.as_str();
        let border_provinces: Vec<&Province> = nation_provinces
            .iter()
            .copied()
            .filter(|p| {
                let Some(neighbors) = adjacency.get(p.geometry_ref.as_str()) else {
                    return false;
                };
                neighbors.iter().any(|n_sid| {
                    iso_by_shape
                        .get(n_sid.as_str())
                        .map(|iso| *iso != nation_iso && !iso.is_empty())
                        .unwrap_or(false)
                })
            })
            .collect();

        // Division count: ~1 per 200K manpower, clamped.
        let count = ((nation.manpower_pool / 200_000) as i64).clamp(1, 60) as u32;
        let (inf_pct, mech_pct, arm_pct, _art_pct) = match nation.doctrine {
            super::nation::DoctrineId::MobileWarfare => (40, 30, 25, 5),
            super::nation::DoctrineId::MassAssault => (70, 10, 15, 5),
            super::nation::DoctrineId::DefenseInDepth => (50, 20, 15, 15),
            super::nation::DoctrineId::SuperiorFirepower => (50, 20, 20, 10),
        };
        let inf_count = (count * inf_pct) / 100;
        let mech_count = (count * mech_pct) / 100;
        let arm_count = (count * arm_pct) / 100;
        let art_count = count
            .saturating_sub(inf_count)
            .saturating_sub(mech_count)
            .saturating_sub(arm_count);

        let strength = (75 + (nation.tech.0 as u32 * 5)).clamp(60, 120);

        // Build the (shape_id, weight) deployment buckets.
        // 25% of total goes to capital reserve; 75% spread across border
        // provinces weighted by population. Island nations: 100% capital.
        let mut buckets: Vec<(ProvinceId, u32)> = Vec::new();
        let capital_reserve_pct: u32 = if border_provinces.is_empty() { 100 } else { 25 };
        let cap_count = (count * capital_reserve_pct) / 100;
        if cap_count > 0 {
            buckets.push((capital.id, cap_count));
        }
        let frontline_total = count.saturating_sub(cap_count);
        if frontline_total > 0 && !border_provinces.is_empty() {
            // Sort border provinces by population descending so the biggest
            // ones get the bulk of the deployment, but cycle through all of
            // them so we don't pile everything in one place.
            let mut sorted = border_provinces.clone();
            sorted.sort_by_key(|p| std::cmp::Reverse(p.population));
            // Round-robin so spread is visible even for small forces.
            let mut remaining = frontline_total;
            let mut idx = 0;
            while remaining > 0 {
                let p = sorted[idx % sorted.len()];
                // Bigger border regions get up to 3 divs per pass, smaller ones get 1.
                let take = if idx < 3 { 3.min(remaining) } else { 1.min(remaining) };
                if let Some(existing) = buckets.iter_mut().find(|(pid, _)| *pid == p.id) {
                    existing.1 += take;
                } else {
                    buckets.push((p.id, take));
                }
                remaining -= take;
                idx += 1;
                if idx > 200 { break; } // safety
            }
        }

        // Now distribute the doctrine mix proportionally across buckets.
        // Simple approach: cycle each type's divs round-robin over buckets so
        // every garrison gets a mix.
        let push_typed =
            |out: &mut Vec<Unit>, buckets: &[(ProvinceId, u32)], n: u32, kind: UnitType| {
                if n == 0 || buckets.is_empty() {
                    return;
                }
                let weight_total: u32 = buckets.iter().map(|(_, w)| *w).sum();
                if weight_total == 0 {
                    return;
                }
                // Allocate proportional to bucket weight; remainder spills round-robin.
                let mut allocated: Vec<u32> = buckets
                    .iter()
                    .map(|(_, w)| (n * w) / weight_total)
                    .collect();
                let mut remaining = n - allocated.iter().sum::<u32>();
                let mut i = 0;
                while remaining > 0 {
                    allocated[i % buckets.len()] += 1;
                    remaining -= 1;
                    i += 1;
                }
                for (b_idx, (province_id, _)) in buckets.iter().enumerate() {
                    for _ in 0..allocated[b_idx] {
                        out.push(Unit {
                            id: UnitId::new(),
                            owner: nation.id,
                            unit_type: kind,
                            location: *province_id,
                            strength,
                            organization: 80,
                            experience: 0,
                            supply_state: SupplyState::Supplied,
                        });
                    }
                }
            };
        push_typed(&mut out, &buckets, inf_count, UnitType::Infantry);
        push_typed(&mut out, &buckets, mech_count, UnitType::Mechanized);
        push_typed(&mut out, &buckets, arm_count, UnitType::Armor);
        push_typed(&mut out, &buckets, art_count, UnitType::Artillery);
    }
    out
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
    fn major_powers_units_spread_across_border_provinces() {
        // USA borders Canada + Mexico, so it should have border provinces, and
        // units should land in MORE than one province.
        let w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let usa = w.nations.iter().find(|n| n.iso_a3 == "USA").unwrap();
        let usa_unit_provinces: std::collections::HashSet<ProvinceId> = w
            .units
            .iter()
            .filter(|u| u.owner == usa.id)
            .map(|u| u.location)
            .collect();
        assert!(
            usa_unit_provinces.len() >= 3,
            "USA units should be spread across multiple border provinces, got {}",
            usa_unit_provinces.len()
        );
    }

    #[test]
    fn major_powers_seeded_with_many_units_small_states_with_few() {
        let w = build_modern_world(
            SaveId::new(),
            BranchId::new(),
            NaiveDate::from_ymd_opt(2026, 5, 22).unwrap(),
        );
        let usa = w.nations.iter().find(|n| n.iso_a3 == "USA").unwrap();
        let usa_units = w.units.iter().filter(|u| u.owner == usa.id).count();
        // USA's 328M pop × 3.5% manpower ÷ 200K per div ≈ ~57 divs → capped 60.
        assert!(
            usa_units >= 30 && usa_units <= 60,
            "USA should have a sizeable force, got {}",
            usa_units
        );
        // Tiny states should have only a handful.
        if let Some(lva) = w.nations.iter().find(|n| n.iso_a3 == "LVA") {
            let lva_units = w.units.iter().filter(|u| u.owner == lva.id).count();
            assert!(
                lva_units <= 10,
                "Latvia should be small, got {} units",
                lva_units
            );
        }
        // Doctrine mix: Mobile Warfare (USA) has more armor than Mass
        // Assault. Sanity: USA has some armored divisions.
        use crate::world::nation::UnitType;
        let usa_armor = w
            .units
            .iter()
            .filter(|u| u.owner == usa.id && u.unit_type == UnitType::Armor)
            .count();
        assert!(usa_armor >= 1, "USA should have armored divisions");
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
