# Handoff: Outland Command — Control Center Dashboard

## Overview
A redesigned main dashboard for the Mars colonization sim ("Outland"), styled as an industrial/space-mission control center. Replaces the current bare dev-harness look (plain monospace on `colony-app.ts` / `dashboard-panel.ts`) with a full visual system: gauges, LED-coded system grid, budget ledger, alerts, chronicle log.

## About the Design Files
The file in this bundle (`Mars Control Center.dc.html`) is a **design reference built in HTML** — it shows the intended look, layout, and interaction, but is not production code. Your target environment is the existing **Lit + TypeScript** web-component codebase (`ui/components/*.ts`, `lit` + `lit/decorators.js`, `css`/`html` tagged templates). The task is to recreate this design inside that stack — most directly by restyling `dashboard-panel.ts` (and/or `colony-app.ts`'s shell) with the tokens and structure below, wired to the real `Snapshot`/`ColonyStore` data instead of the mock data used here.

## Fidelity
**High-fidelity.** Colors, type, spacing, and component structure below are final — implement pixel-close using Lit's `css` templates. The mock data in the HTML file should be replaced with live bindings from `ColonyStore` (see Data Mapping below).

## Screens / Views
Single screen: **Main Dashboard**. (Earth/Mars planning tabs, chronicle, and debrief screens are unchanged for now — this pass only covers the dashboard.)

### Layout
- Root container: full width, min-height 100vh, background `#070d0b`, padding `clamp(14px, 3vw, 32px)`, base font `IBM Plex Mono`.
- All rows are `display:flex; flex-wrap:wrap; gap:16px` (or CSS grid with `auto-fill, minmax(150px,1fr)` for the system tiles) — this is what makes it reflow to a single column on mobile with zero breakpoints. Keep that pattern; don't introduce `@media` rules, use `clamp()` and flex-wrap instead.

1. **Header bar** — flex row, `justify-content:space-between`, wraps on narrow widths.
   - Left: title "OUTLAND COMMAND" (Space Grotesk 700, `clamp(20px,2.6vw,30px)`, `#eafaf1`) + version tag ("v2.3.1", IBM Plex Mono 11px, `#4d6a5e`) inline; subtitle line below in `#7fa596` 11px uppercase; a dim scenario/feed line in `#4d6a5e` 10.5px.
   - Right: Window/Year readout (mono, 18px), an uplink status chip (green LED dot + "UPLINK NOMINAL", bg `#0d1a16`, border `#1e352d`), and — only when there are alerts — a pulsing red alert-count chip (bg `rgba(255,90,60,.12)`, border `#7a3326`).
2. **Gauge row** (3 cards, `flex:1 1 260px` each, bg `#0d1a16`, border `1px solid #1e352d`, radius 4px, padding 16px):
   - **Autonomy**: 140×140px donut built from `conic-gradient(#2fd68a {pct}%, #182a24 0)` with an inset circle punched out, big centered `%` number (26px, `#eafaf1`) + population subtext.
   - **Energy Balance**: gen/demand numbers (20px) + a 14px bar gauge (`#182a24` track, fill = green `#2fd68a` if surplus / red `#ff5a3c` if deficit, blinking via `blinkPulse` keyframe when in deficit) + status text.
   - **Import Throughput**: mass used/cap numbers + same bar-gauge pattern (red when mass is capped/over-throughput) + $/kg and launch-capacity readout.
3. **Budget ledger** (full-width card): spend bar (green/red fill = planned spend vs a virtual "1.3× budget" scale) with an amber `2px` tick marker showing the *real* (inflation-eroded) subsidy value overlaid on it; readouts for planned spend, nominal subsidy, real subsidy w/ erosion %, import cost F, F/M ratio, inflation %/window, and colonists-in-transit if any.
4. **Alert chips row** (only rendered when alerts exist): each chip is a horizontal pill, bg `rgba(255,90,60,.1)`, border `#7a3326`, small red dot, 12px text `#ffb8a8`, pulses via `blinkPulse` when the "alert pulse" toggle is on.
5. **Colony Systems grid**: section header + inline legend (LED dot + label ×4: Local/Buildable/Import/Black). Grid: `repeat(auto-fill, minmax(150px,1fr))`, gap 8px. Each tile: bg `#0d1a16` (or `#132a25` when selected), border `#1e352d` (or the status LED color when selected), radius 3px, padding 10px; shows LED dot + tier badge ("T0"–"T2"), system name (Space Grotesk 600 12.5px), and uppercase status word colored to match the LED. Click selects a tile (state, not navigation).
6. **Selected System inspector**: bordered card (`1px solid #2fd68a`) with small corner-bracket accents (4 absolutely-positioned L-shaped corner marks, 10×10px, 2px border) — a mission-console framing motif. Shows system name, tier, status, import mass draw (if any), and a note line.
7. **Chronicle log**: scrollable list (`max-height:190px`), each row `[W{n}]` in dim green-gray + event text in `#c3ddd0`.
8. **Footer bar**: left = dim note ("Window N closes in ~2.2 years shiptime"); right = two buttons — outline "Reset Simulation" and filled green "Commit ▸ Next Window" (bg `#123d28`, border `#2fd68a`, text `#d8f5e2`, hover bg `#164a30`).

## Interactions & Behavior
- Clicking a system tile sets it as "selected" (local component state) and updates the inspector card — no page navigation.
- Alert chips and out-of-range bar-gauge fills use a shared `blinkPulse` keyframe (`opacity 1 → 0.28 → 1`, 2.2s ease-in-out infinite) — gate this behind a settings/tweak toggle so it can be turned off.
- No page transitions; this is a single persistent dashboard view.
- Responsive: pure fluid layout (flex-wrap + grid auto-fill + `clamp()` type). No breakpoints needed — verify by resizing rather than adding `@media`.

## State Management
- `selectedSystemIndex` (or name) — which system tile is focused in the inspector. Local UI state, doesn't need to live in `ColonyStore`.
- Everything else (energy, autonomy, budget, node statuses, events) should read directly from `ColonyStore`'s existing `status()`, `plan()`, `demography()`, node/snapshot getters — see Data Mapping.
- Optional settings: language (en/ru) and alert-pulse on/off, if you want to keep those as user-facing toggles; otherwise hardcode.

## Design Tokens

**Colors**
- Background: `#070d0b` (page), `#0d1a16` (panels), `#132a25` (selected/hover panel), `#182a24` (track/inset)
- Borders: `#1e352d` (default), `#33544a` (hover)
- Text: `#eafaf1` (primary/bright), `#dfeee7` (base), `#c3ddd0` (log text), `#a8c4b8` (notes), `#7fa596` (labels/dim), `#5f8272` (secondary dim), `#4d6a5e` (faint), `#3d5a4d` (log timestamp)
- Status LEDs: local `#2fd68a` (green), buildable `#ffb020` (amber), import `#ff5a3c` (red/orange), black/unlocalizable `#8b8296` (violet-gray)
- Alert surfaces: bg `rgba(255,90,60,0.10–0.12)`, border `#7a3326`, text `#ffb8a8`

**Typography**
- Headings/labels: `Space Grotesk`, 500–700 weight, letter-spacing 0.05–0.08em, uppercase for section labels
- Data/numbers/body: `IBM Plex Mono`, 400–600 weight
- Scale used: 30px (title) / 20–26px (big numbers) / 16px (inspector name) / 12–13px (body/tile text) / 9–11px (labels, meta)

**Spacing / Radius**
- Panel padding: 16px; tile padding: 10px
- Border radius: 3–4px everywhere (sharp/industrial, not rounded)
- Gaps: 8px (tiles/chips), 16px (panel rows), 20–22px (major sections)

**Motion**
- `@keyframes blinkPulse { 0%,100% { opacity:1 } 50% { opacity:.28 } }` — 2.2s ease-in-out infinite, used only on active alerts/deficits, never decorative.

## Data Mapping (design mock → real store)
| Design element | Suggested source in `ColonyStore` / `Snapshot` |
|---|---|
| Autonomy %, population, window, year | `store.status()` |
| Energy gen/demand | `store.status().energyGen/energyDemand` |
| Budget M / real M / erosion / inflation | `store.status()` (`M`, `realM`, `erosionPct`, `inflationPct` per `dashboard-panel.ts`) |
| Import cost F, F/M, $/kg, launch K | `store.plan()` / `store.status()` (`F`, `fm`, `effPerKg`, `launchK`) |
| Mass used/cap | `store.plan().earth.mass` / `.throughput` |
| Node grid (name, tier, status) | `snapshot.nodes` (`NodeView[]`, `NodeStatus` local/buildable/import/black — see `dashboard-panel.ts`) |
| Alerts | `plan.overBudget`, `plan.earth.capped`, `plan.materialsShort`, energy deficit, etc. (same checks already in `colony-app.ts`'s `footer()`) |
| Chronicle events | `store` event/chronicle log (see `chronicle-panel.ts`) |
| Colonists in transit | `store.inTransit().colonists` |

## Assets
No external images/icons — everything is CSS (conic-gradient donut, bar gauges, corner-bracket frame). Fonts loaded from Google Fonts: `Space Grotesk` (500/600/700) and `IBM Plex Mono` (400/500/600) — add these via your existing font-loading approach (e.g. self-host or `@font-face` in a shared stylesheet) rather than a runtime Google Fonts `<link>`, to match how the rest of the app loads assets.

## Files
- `Mars Control Center.dc.html` — the full design reference (open directly in a browser).
