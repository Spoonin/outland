# Handoff: Colony Status panel redesign

Applies the redesigned status panel to the real codebase. Target:
**`ui/components/colony-status.ts`** — render + styles get replaced; the
`ColonyStatus` / `ResourceLine` data and the existing props are reused. One small
new prop (`series`) is needed for the sparklines.

## Files in this bundle
- **`colony-status.proposed.ts`** — drop-in replacement for
  `ui/components/colony-status.ts`. Copy it over (or diff it in).
- **`Mars Status Panel.dc.html`** — the visual reference / prototype. Open in a
  browser; use its `mode` tweak to see both populated and cold-start states.

## What the redesign changes
1. **Health percentages → mini-gauges.** `avgCondition` (wear), `sparesCoverage`,
   `crewCoverage`, `shieldCoverage`, and `pop/housingCapacity` render as a row of
   labeled bar gauges instead of inline `·`-separated bold text. A degraded system
   is visible as a partial bar, not read from prose.
2. **Resources split by criticality.** An emphasized **Life Support** grid
   (food/water/o2/n2) with larger tiles, then a compact **Stockpile** grid, then
   the existing collapsed **ISRU** section. (Previously one flat grid mixed
   existential and industrial resources.)
3. **Life-support tiles gain a fill bar + sparkline.** Capped resources
   (food/water) show a capacity fill bar; all four show a sparkline of recent
   history and runway (`≈ N wnd`) when draining.
4. **LEDs carry more state.** green (healthy) / amber (draining) / red
   (draining, <4 windows runway) — plus a new **blue "at cap"** state when a
   capped resource is >95% full and still growing (wasting production), and a
   **dim** state for inactive (0 stock, 0 flow) resources.
5. **Cold-start (pop 0)** dims empty tiles and shows one "awaiting first landing"
   cue instead of a wall of identical bright cells.

## Data used — nearly all already present
From `ColonyStatus` (`StatusView`): `pop`, `workforce`, `sickBeds`,
`avgCondition`, `sparesCoverage`, `crewCoverage`, `shieldCoverage`,
`housingCapacity`, `foodCapacityTotal`, `waterCapacityTotal`, and
`resources: ResourceLine[]` (`kind`, `stock`, `net`, `windows`, `localOnly`).
Existing props `inTransit`, `demography`, `lastReport`, `repairInfo` are carried
over (transit line + age-bar demography block preserved unchanged).

## The one thing to wire up: `series` (for sparklines)
Add a new prop and pass recent stock history keyed by resource kind:

```ts
@property({ attribute: false }) series?: Record<string, readonly number[]>;
```

Your store already computes this for the debrief chart — the `stockSeries`
object (`{ food, water, o2, n2 }`, ~8 windows each) shown around colonyStore.ts
line ~968. In `colony-app.ts` where `<colony-status>` is rendered, pass it:

```ts
html`<colony-status
  .status=${this.store.status()}
  .series=${this.store.stockSeries?.()}   // or wherever that view is exposed
  .inTransit=${this.store.inTransit()}
  ...>
</colony-status>`
```

Only food/water/o2/n2 need series; any kind without an entry renders a flat line
(no error). If exposing `stockSeries` to the live panel is awkward, the panel
degrades gracefully — omit the prop and the sparklines flatten; everything else
still works.

## New i18n keys to add (EN + RU)
```
status.lifeSupport   "Life Support"          / "Жизнеобеспечение"
status.stockpile     "Stockpile"             / "Склад"
status.atCap         "at cap"                / "у предела"
status.coldStart     "Awaiting first landing — stocks and production begin once colonists arrive."
                     / "Ожидание первой высадки — запасы и производство появятся после прибытия колонистов."
```
Reused existing keys: `status.title`, `status.pop`, `status.labor`,
`status.beds`, `status.transit`, `status.empty`, `status.wear`, `status.spares`,
`status.crew`, `status.radShield`, `status.housing`, `status.industrial`,
`status.kg`, `status.wnd`, plus the demography keys.

## Theme tokens
Uses your existing `tokens` vars. Adds one optional token referenced with a
fallback — promote it to a real token for the "at cap" state:
`--c-blue` (fallback `#4a9fd8`).

## Behavior notes preserved
- The `dkg()` one-decimal-for-small-flows rule (and its rationale) is carried over
  verbatim.
- Demography age-bar block, radiation-dose line, and transit line are unchanged.
- ISRU (`localOnly`) resources still collapse into a toggle section.

## Suggested order of work
1. Copy `colony-status.proposed.ts` → `ui/components/colony-status.ts`.
2. Add the 4 new i18n keys (EN + RU).
3. Pass `.series=${...}` from `colony-app.ts` (or skip — degrades gracefully).
4. Add the `--c-blue` token (or leave the inline fallback).
