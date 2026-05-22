# Plan 07 — UX polish ("make it feel gamey")

**Goal:** The current UI is functional but reads as "tech demo." After this
plan it should feel like a deliberate strategy game: clear hierarchy, a
unified command dock, an HUD-style top bar with iconified stats, subtle
motion, and a vignetted map.

## Visual problems to fix

1. Floating panels (Action, Production, Saves drawer, Country drawer,
   Summary modal) all read the same — no layering, no priority. They
   compete instead of cooperating.
2. Top bar is plain — wastes prime real estate. No faction identity.
3. No iconography. Every UI element is text — feels like a settings page,
   not a strategy game.
4. No motion language. Things pop in/out abruptly.
5. Player's key stats (treasury, manpower, IC, stability) are buried in
   the country drawer rather than always-visible.

## Polish moves

### 1. **Unified Command Dock** (replaces floating ActionPanel +
    ProductionPanel)
- Bottom-of-screen dock with tabbed UI: Orders | Production | Saves | History
- Always pinned, ~340px tall. Tabs along the top of the dock.
- Smooth tab switch (cross-fade).
- Collapse button to shrink to just the tab strip.
- Dock doesn't overlap the right-side drawer; drawer becomes 360px from
  the right and the dock fits in the space to its left.

### 2. **HUD-style TopBar**
- Layout: `[Menu] [Player flag + name]   [Resource pills with icons]
  [Centered date + round]   [End-turn primary button + time-increment row]`
- Resource pills: Treasury, Manpower, Industry, Stability, War support —
  each with an SVG icon, current value, and an optional delta chip
  (+income this turn).
- Player flag is the country mapcolor13 swatch larger, with a thin border
  glow when it's your turn.
- End-turn button uses a primary gradient + soft pulse animation.

### 3. **Iconography**
- Inline SVG `Icon` component with a handful of strategy icons:
  Treasury (coins), Manpower (people), Industry (gear), Stability
  (heartbeat), War-support (fist), Orders (scroll), Production (factory),
  Save (disk), History (book), Build (hammer), Send (arrow).
- All sized via `--fs-md` / em.

### 4. **Motion + microinteractions**
- Drawer slide-in (250ms cubic-bezier).
- Summary modal fade-up.
- Button press: scale 0.97 + brightness.
- Tab switch: 150ms cross-fade.
- Province highlight on hover: subtle.

### 5. **Map vignette**
- Inner shadow around the WorldMap container so the player feels like
  they're peering at a planning table. Top edge slightly darker (under
  the top bar).

### 6. **Visual hierarchy on cards**
- Section headers in uppercase tracked microcopy + color (was already
  there — refine).
- Card backgrounds get a subtle linear gradient + 1px inset highlight.
- Primary buttons get a glow on hover.
- Destructive buttons (Delete save) get a danger border.

## Out of scope (deferred to Plan 08+)

- Sound effects
- Animated transitions on the map itself (panning to selected nation,
  fading colors on conquest)
- Player notifications system (banners for key events)
- Tutorial / onboarding flow
- Right-click context menus on provinces
