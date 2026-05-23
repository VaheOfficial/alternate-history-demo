import type {
  Faction,
  FactionArchetype,
  World,
} from "../../../lib/game/types";
import { EmptyState } from "../../ui/EmptyState";
import { CrownIcon } from "../../ui/Icon";

/**
 * Politics screen (Plan 12 Phase 3). Each nation has 3-5 factions
 * with power + satisfaction. The player sees their own.
 */
export function PoliticsScreen({ world }: { world: World }) {
  const player = world.player_nation
    ? world.nations.find((n) => n.id === world.player_nation) ?? null
    : null;

  if (!player) {
    return (
      <EmptyState
        icon={<CrownIcon />}
        title="Politics"
        description="Your nation's internal coalitions and government structure live here."
        hint="Pick a player nation from the landing page to populate this screen."
      />
    );
  }

  const factions = player.factions ?? [];

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <div style={titleStyle}>Politics — {player.name}</div>
          <div style={subtitleStyle}>
            {governmentLabel(player.government)} · stability{" "}
            <strong>{player.stability}</strong> · war support{" "}
            <strong>{player.war_support}</strong>
          </div>
        </div>
      </div>

      {factions.length === 0 ? (
        <EmptyState
          icon={<CrownIcon />}
          title="No factions"
          description="This nation has no recorded factions in the current save."
          hint="Start a new game to seed factions per government type."
        />
      ) : (
        <div style={listStyle}>
          {factions.map((f, i) => (
            <FactionCard key={i} faction={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FactionCard({ faction }: { faction: Faction }) {
  const hint = HINT_BY_ARCHETYPE[faction.archetype];
  const satColor =
    faction.satisfaction < 20
      ? "#e26d6d"
      : faction.satisfaction < 50
      ? "#f5d76e"
      : "#7aa2f7";
  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>
        <span style={archetypeChipStyle(faction.archetype)}>
          {LABEL_BY_ARCHETYPE[faction.archetype]}
        </span>
        <span style={powerLabelStyle}>Power {faction.power}</span>
      </div>
      <div style={barRowStyle}>
        <div style={barLabelStyle}>Satisfaction</div>
        <div style={barTrackStyle}>
          <div
            style={{
              ...barFillStyle,
              width: `${faction.satisfaction}%`,
              background: satColor,
            }}
          />
        </div>
        <div style={barValueStyle}>{faction.satisfaction}</div>
      </div>
      <div style={barRowStyle}>
        <div style={barLabelStyle}>Power</div>
        <div style={barTrackStyle}>
          <div
            style={{
              ...barFillStyle,
              width: `${faction.power}%`,
              background: "var(--surface-3)",
            }}
          />
        </div>
        <div style={barValueStyle}>{faction.power}</div>
      </div>
      <div style={hintStyle}>{hint}</div>
    </div>
  );
}

const LABEL_BY_ARCHETYPE: Record<FactionArchetype, string> = {
  military: "Military",
  business: "Business",
  religious: "Religious",
  populist: "Populist",
  intellectual: "Intellectual",
};

const COLOR_BY_ARCHETYPE: Record<FactionArchetype, string> = {
  military: "#e26d6d",
  business: "#f5d76e",
  religious: "#9f7af7",
  populist: "#9aae8a",
  intellectual: "#7aa2f7",
};

const HINT_BY_ARCHETYPE: Record<FactionArchetype, string> = {
  military:
    "Loves war declarations and defense pacts. Unhappy with peace treaties and demilitarization.",
  business:
    "Loves trade agreements and stability. Unhappy with declared wars and vassalage.",
  religious:
    "Stable in monarchies and theocracies. Unhappy with rapid secular reforms.",
  populist:
    "Reacts to perceived national wins. Hostile to vassalage and unpopular concessions.",
  intellectual:
    "Loves alliances and trade. Unhappy with crackdowns and propaganda.",
};

function archetypeChipStyle(a: FactionArchetype): React.CSSProperties {
  return {
    padding: "3px 10px",
    borderRadius: 999,
    background: COLOR_BY_ARCHETYPE[a],
    color: "#0c1322",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };
}

function governmentLabel(g: string): string {
  return g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, " ");
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  gap: 10,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
};

const titleStyle: React.CSSProperties = {
  fontSize: "var(--fs-md)",
  fontWeight: 700,
  letterSpacing: "-0.01em",
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--fg-dim)",
  fontSize: "var(--fs-xs)",
  marginTop: 2,
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  flex: 1,
  overflowY: "auto",
  paddingRight: 6,
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const powerLabelStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
};

const barRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const barLabelStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-dim)",
  width: 95,
};

const barTrackStyle: React.CSSProperties = {
  flex: 1,
  height: 6,
  background: "var(--surface-3)",
  borderRadius: 999,
  overflow: "hidden",
};

const barFillStyle: React.CSSProperties = {
  height: "100%",
  transition: "width 220ms ease-out",
};

const barValueStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg)",
  width: 28,
  textAlign: "right",
};

const hintStyle: React.CSSProperties = {
  fontSize: "var(--fs-xs)",
  color: "var(--fg-muted)",
  fontStyle: "italic",
  lineHeight: 1.5,
};
