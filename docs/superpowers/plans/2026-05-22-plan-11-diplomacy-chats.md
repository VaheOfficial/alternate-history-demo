# Plan 11 — Diplomacy Chats

**Status:** In progress
**Builds on:** Plan 05 (Living World / NPC actors), Plan 08 (tolerant LLM
JSON parsing), Plan 09–10 (UI surface for new dock tabs).

## Why

The design spec (section 16) explicitly keeps "group diplomacy chats" in
v1 — flagged as a user-requested feature. We have one-shot validator
turns and orchestrated NPC turns, but no surface where the player can sit
down and actually NEGOTIATE with one or more foreign leaders in a
conversation that ends in a treaty or an ultimatum.

The current orders-panel flow ("Threaten Canada with annexation") works
for unilateral declarations but can't carry a back-and-forth:

- Canada replies, the player counters, Canada folds at a worse deal, a
  treaty actually gets signed.
- Player sits the USA, UK and France down at a table to coordinate a
  joint response to a Russian move.
- Player tries to flip an alliance ("hey China, what would it take to
  break with Russia?").

A real diplomatic channel makes the LLM-driven world feel like a
diplomatic stage, not just an action validator.

## Data model

```rust
pub struct DiplomaticChannel {
    pub id: String,
    pub participants: Vec<NationId>, // player + 1..N NPCs
    pub messages: Vec<DiplomaticMessage>,
    pub status: ChannelStatus, // Open | Closed
    pub opened_on: NaiveDate,
}

pub enum ChannelStatus { Open, Closed }

pub struct DiplomaticMessage {
    pub id: String,
    pub speaker: NationId, // which nation is speaking
    pub content: String,   // in-character text
    pub timestamp: NaiveDate,
    /// Any typed actions the LLM emitted with this message (e.g. a
    /// proposed sign_treaty that the player can choose to enact).
    #[serde(default)]
    pub proposed_actions: Vec<TypedAction>,
}
```

Stored on `World.diplomatic_channels: Vec<DiplomaticChannel>` with
`#[serde(default)]` so old saves load. Channels persist across turns —
the player can come back to a paused conversation later.

## Turn-taking

One Tauri command does the round: `send_diplomatic_message_cmd`:

1. Append the player's message to the channel.
2. Decide WHO speaks next. v1: just iterate over all NPC participants
   and let each speak in order, ONCE per `send`. (Future: a "next
   speaker" LLM subsystem picks dynamically based on relevance.)
3. For each NPC participant, in turn:
   - Compose a system prompt establishing them as the leader of that
     nation (name, government, doctrine, goals, recent events,
     relationship with player).
   - Hand the LLM the full chat transcript so far.
   - Ask for ONE JSON object: `{ content, proposed_actions[] }`.
   - Parse with the same tolerant pipeline used by validator/NPC turn.
   - Append a DiplomaticMessage with the result.
4. Return the updated channel + world.

`proposed_actions` from NPCs are NOT auto-applied — they're advisory.
The player explicitly enacts them via a button (next round).

## "Accept proposal" surface

When an NPC message includes proposed_actions, the chat UI shows an
"Enact" button under that message. Clicking it runs the actions through
the same `apply_actions` engine that the validator uses, with the same
tolerant per-action parsing. World mutates, the action is moved to
`accepted: true` in the UI.

This is the "diplomatic outcome" pathway — when Canada says "fine, we'll
sign a non-aggression pact" with a sign_treaty action attached, the
player presses Enact and the treaty actually lands.

## UI

New "Diplomacy" tab in the command dock (between Advisor and Plans).

The panel shows:
- **Top:** list of open channels as cards. Each card shows participants
  (nation flags / mapcolor chips), most-recent-message preview, message
  count. Click to expand.
- **Channel detail (when expanded):** chat-style transcript with
  speaker-colored message bubbles, "Enact" buttons under NPC messages
  carrying proposed_actions, a textarea at the bottom for the player to
  send the next message. Plus a "Close channel" button.
- **"New channel" button:** opens a small modal asking which nations to
  invite. v1: a flat select-list of all nations sorted by industry; the
  player picks 1+ to start a channel.

## Server-side: command list

1. `open_diplomatic_channel_cmd(world, participants: Vec<NationId>) -> World`
   - Validates participants exist + player is in the list, creates the
     channel, returns updated world. Persists snapshot.
2. `send_diplomatic_message_cmd(provider_id, model, world, channel_id,
   message) -> { world, channel }`
   - Player message → for each NPC participant, LLM call → append
     messages. Persists snapshot.
3. `enact_diplomatic_proposal_cmd(world, channel_id, message_id) -> World`
   - Looks up the message, applies its `proposed_actions` through
     `apply_actions` with the embedded default adjacency, records an
     Event, persists snapshot.
4. `close_diplomatic_channel_cmd(world, channel_id) -> World`
   - Sets status to Closed (kept on world for history; not deleted).

## Prompting

Each NPC participant gets its OWN turn within a single send, with this
shape (paraphrased):

```
You ARE {nation_name} ({iso_a3}). You are sitting at a diplomatic
table with: {other participants}.

Government: {gov}. Doctrine: {doctrine}. Stability: {stab}.
Current relations with the other participants: …
Recent events: …

This is the conversation so far:
> Player ({player_iso}): "..."
> {Other NPC} ({iso_a3}): "..."

Respond IN CHARACTER as the leader / foreign minister of {nation_name}.
Be specific. Push your nation's interests. You may propose typed actions
(sign_treaty, modify_relation, declare_war, …) but they're advisory —
the player decides whether to enact.

Respond with ONE JSON object:
{
  "content": "<your in-character message, 1-4 sentences>",
  "proposed_actions": [<typed action>, ...]
}
```

Tolerant parsing same as validator: action variants that don't deserialize
get logged + skipped, conversation continues.

## What's out of scope for v1

- **Dynamic "next speaker" subsystem.** Every NPC participant speaks
  once per send round in fixed iso-sorted order. The design doc lists
  this as a separate AI subsystem; v1 just does round-robin.
- **NPC-to-NPC channels.** Only the player can open a channel. NPC-led
  diplomatic events are emitted by the existing NPC turn loop.
- **Memory beyond the transcript.** The LLM only sees this channel's
  messages, not other channels' history. (Real cross-channel diplomacy
  requires the Plan 12 RAG store.)
- **Voice / personality continuity across sessions.** Each send call is
  stateless against the LLM provider — we replay the transcript every
  time. No persistent system identity tokens.
- **Multi-language.** English only.

## Files

New:
- `src-tauri/src/world/diplomacy.rs` — `DiplomaticChannel`,
  `DiplomaticMessage`, status enum.
- `src/components/Game/DiplomacyPanel.tsx` — channel list + chat detail.

Modified:
- `src-tauri/src/world/mod.rs` — register module.
- `src-tauri/src/world/world.rs` — `diplomatic_channels` field.
- `src-tauri/src/world/scenario.rs` — initialize empty.
- `src-tauri/src/commands/game.rs` — 4 new Tauri commands +
  shared NPC-message prompt builder.
- `src-tauri/src/lib.rs` — register new commands.
- `src/lib/game/types.ts` — `DiplomaticChannel` / `DiplomaticMessage`.
- `src/lib/game/tauri.ts` — bindings.
- `src/components/Game/CommandDock.tsx` — "Diplomacy" tab.
- `src/components/Game/GameSession.tsx` — wire panel.

## Done criteria

1. Player can open a channel with 1+ NPC nations from a new "Diplomacy"
   dock tab.
2. Sending a message in the channel produces an NPC reply per
   participant (turn-taking in iso order).
3. NPC messages with proposed_actions show an Enact button; clicking it
   actually mutates the world (e.g. signs a treaty).
4. Channels persist on the world (save/load round-trip works).
5. Closing a channel marks it Closed but preserves the transcript.
6. `cargo test --lib` + `pnpm tsc --noEmit` + `pnpm build` all clean.
7. Plan doc landed.
