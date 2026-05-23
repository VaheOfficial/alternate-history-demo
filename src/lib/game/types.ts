// Mirror of the Rust World types — kept loose where data is opaque to the UI.

export type GovernmentType =
  | "democracy"
  | "monarchy"
  | "republic"
  | "communist"
  | "fascist"
  | "military_junta"
  | "theocracy"
  | "other";

export type DoctrineId =
  | "mobile_warfare"
  | "defense_in_depth"
  | "mass_assault"
  | "superior_firepower";

export type UnitType = "infantry" | "armor" | "mechanized" | "artillery";

export type SupplyState = "supplied" | "reduced" | "out_of_supply";

export interface Unit {
  id: string;
  owner: string;
  unit_type: UnitType;
  location: string;
  strength: number;
  organization: number;
  experience: number;
  supply_state: SupplyState;
}

export type Terrain =
  | "plains"
  | "forest"
  | "hills_rough"
  | "mountains"
  | "urban"
  | "desert"
  | "river"
  | "coastal";

export interface IndustrySplit {
  civilian: number;
  military: number;
  research: number;
}

export interface ResourceStockpile {
  steel: number;
  oil: number;
  rubber: number;
  tungsten: number;
}

export interface Nation {
  id: string;
  name: string;
  iso_a3: string;
  government: GovernmentType;
  leader: string;
  treasury: number;
  gdp: number;
  population: number;
  manpower_pool: number;
  stability: number;
  war_support: number;
  industry_capacity: number;
  industry_split: IndustrySplit;
  resources: ResourceStockpile;
  tech: number;
  doctrine: DoctrineId;
  map_color: number;
  relations: Record<string, number>;
  build_queue: unknown[];
  goals: string[];
}

export interface ResourceYield {
  steel: number;
  oil: number;
  rubber: number;
  tungsten: number;
}

export interface Province {
  id: string;
  name: string;
  geometry_ref: string;
  owner: string;
  core_of: string[];
  terrain: Terrain;
  population: number;
  base_industry: number;
  base_resources: ResourceYield;
  supply_value: number;
  is_capital: boolean;
  is_supply_hub: boolean;
}

export interface GameClock {
  current_date: string; // ISO date "YYYY-MM-DD"
  round: number;
}

export type TreatyKind =
  | "non_aggression"
  | "defensive_pact"
  | "alliance"
  | "trade_agreement"
  | "ceasefire"
  | "peace_treaty"
  | "vassalage";

export interface TreatyTerms {
  territory_transfers: unknown[];
  tribute_per_year: number;
  extra_clauses: string[];
}

export interface Treaty {
  id: string;
  kind: TreatyKind;
  parties: string[];
  signed_on: string;
  expires_on: string | null;
  terms: TreatyTerms;
}

export interface PendingAction {
  id: string;
  initiator: string;
  label: string;
  narrative: string;
  started_on: string;
  completes_on: string;
  progress_pct: number;
  on_complete: unknown[];
}

export type BattlePlanStatus = "planned" | "executed" | "cancelled";

export interface BattlePlan {
  id: string;
  owner: string;
  target: string;
  sources: string[];
  status: BattlePlanStatus;
  created_on: string;
  executions: number;
}

export type ChannelStatus = "open" | "closed";

export interface DiplomaticMessage {
  id: string;
  speaker: string;
  content: string;
  timestamp: string;
  proposed_actions: unknown[];
  enacted: boolean;
}

export interface DiplomaticChannel {
  id: string;
  participants: string[];
  messages: DiplomaticMessage[];
  status: ChannelStatus;
  opened_on: string;
}

export interface World {
  save_id: string;
  branch_id: string;
  clock: GameClock;
  player_nation: string | null;
  nations: Nation[];
  provinces: Province[];
  units: Unit[];
  npcs: unknown[];
  treaties: Treaty[];
  crises: unknown[];
  frontlines: unknown[];
  events: unknown[];
  pending: PendingAction[];
  battle_plans: BattlePlan[];
  diplomatic_channels: DiplomaticChannel[];
}

export interface SaveSummary {
  id: string;
  name: string;
  scenario_id: string | null;
  created_at: string;
  last_played_at: string;
  initial_branch_id: string;
}

export interface ModernSaveBootstrap {
  save: SaveSummary;
  world: World;
}
