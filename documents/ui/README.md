# Handoff: Mars Construction tab redesign

Applies the redesigned Construction tab to the real codebase. The target is the
existing Lit component **`ui/components/mars-tab.ts`** — its render + styles get
replaced; the `ColonyStore` API and the engine's `Structure` type are reused
**as-is** (no engine changes required for the base version).

## Files in this bundle
- **`mars-tab.proposed.ts`** — a drop-in replacement for `ui/components/mars-tab.ts`.
  Compiles against the store API and `Structure` fields the current component
  already uses. Copy it over `mars-tab.ts` (or diff it in).
- **`Mars Construction.dc.html`** — the visual reference / prototype. Open in a
  browser to see the intended look and interaction.

## What the redesign changes (the UX brief)
The old tab was a wall of run-on prose cards. The redesign:
1. **Fixed card zones**, same order every card: header (LED + name + built count)
   → **hero line** (the one decision number: `+80,000 water`, `+100 kW`) → cost
   chips (need vs. stock) → muted specs strip (crew/spares/demolish/recycle on one
   dim line) → **prominent stepper**.
2. **Live consequences summary bar** at the top: materials committed vs. stock,
   net power, crew required, units queued — updates as you step the queue.
3. **Two failure states separated:** amber = unlocked but short on materials
   (recoverable); violet = hard-locked behind a prereq.
4. **Locked buildings collapsed** into their own `Locked (N)` section; expand to
   see each one's unlock requirement as a badge (`🔒 Population ≥ 100`,
   `🔒 Build first: Waste Pad`).
5. **Grouped by function** — Power / Life Support / Infrastructure / Industry /
   Population — instead of a flat card wall.

## Store API used (all already on `ColonyStore`)
`structures()`, `builtCount(id)`, `queuedCount(id)`, `addBuild(id)`,
`removeBuild(id)`, `prereqMet(id)`, `lockReason(id)` (`{missingStructure,
minPopNeeded, missingTech}`), `stocks()`, `industryMultNow(id)`,
`queuedDemolishCount(id)`, `addDemolish/removeDemolish(id)`, `demolishable(id)`,
`subscribe(fn)`.

`Structure` fields used: `id`, `name`, `energy`, `produces`, `consumes`,
`buildMaterials`, `stormVulnerable`, `upkeepSpares`, `opsCrew`, `housing`,
`demolishCrew`, `recycleFrac`, `depletionScale`. (Exactly the set the current card
reads — nothing new.)

## The two derived pieces (no engine change needed)
1. **Functional grouping.** `Structure` has no `category`, so `groupOf(s)` derives
   one heuristically (`energy>0`→power; produces food/water/o2/n2→life;
   `housing`→population; produces anything else→industry; else→infra), with a
   `GROUP_OVERRIDE` map keyed by structure id for exceptions (e.g. `waste_pad`→
   infra, `medbay`→population). **Recommended cleanup:** add a `category` field to
   `Structure` in the engine and replace `groupOf` with `s.category`.
2. **Queue aggregates** (summary bar): `queueTotals()` sums
   `queuedCount × {buildMaterials, energy, opsCrew}` across structures — fully
   self-contained. If `store.plan()` / `CommitPlan` already exposes committed
   materials or a projected net-energy, prefer wiring those in instead.

## Behavior notes to preserve
- **`+` is NOT hard-disabled on materials.** Your model treats material shortfall
  as a soft warning (`plan().materialsShort`), enforced at commit — so the stepper
  keeps `+` enabled and only shows the amber "short" state. (The HTML prototype
  hard-gates `+`; the real component intentionally does not, to match your commit
  flow. Keep the soft behavior.)
- **Commit** stays in the shared footer (`colony-app.ts`) — the summary bar's
  action area only carries "Clear" here, matching how commit is global.
- Demolish row, industry ramp/depletion hint, storm-vulnerable caveat, and the
  i18n/store subscriptions are all carried over unchanged.

## New i18n keys to add
The component references these `t()` keys that don't exist yet — add them to your
i18n tables (EN + RU), reusing existing wording where you have it:

```
mars.short                "Short"              / "Не хватает"
mars.readyToBuild         "Ready to build"     / "Готово к постройке"
mars.shortMaterials       "Short on materials" / "Не хватает материалов"
mars.queuedMaterials      "Materials committed (used / stock)" / "Материалы в плане (использовано / склад)"
mars.netPower             "Net power"          / "Чистая мощность"
mars.crewReq              "Crew required"      / "Требуется экипаж"
mars.unitsQueued          "Units queued"       / "Единиц в плане"
mars.clear                "Clear"              / "Очистить"
mars.have                 "have"               / "скл."
mars.outputPerWindow      "output / window"    / "выход / окно"
mars.avgPower             "avg power"          / "ср. мощность"
mars.perWindowShort       "wnd"                / "окно"
mars.infra                "infrastructure"     / "инфраструктура"
mars.housingHero          "+ Housing"          / "+ Жильё"
mars.housingHeroSub       "adds habitat"       / "добавляет жильё"
mars.typesCount           "{n} types"          / "{n} тип."
mars.showRequirements     "show requirements"  / "показать требования"
mars.collapse             "collapse"           / "скрыть"
mars.group.power          "Power"              / "Энергетика"
mars.group.life           "Life Support"       / "Жизнеобеспечение"
mars.group.infra          "Infrastructure"     / "Инфраструктура"
mars.group.industry       "Industry"           / "Промышленность"
mars.group.population      "Population"         / "Население"
```
(Reused existing keys: `mars.built`, `mars.buildable`, `mars.locked`,
`mars.builtCount`, `mars.needFirst/needPop/needTech`, `mars.sparesPerWnd`,
`mars.crewPerUnit`, `mars.demolish`, `mars.demolishLabel`, `mars.stormVulnerable`,
`mars.industryOutput`, `mars.depletion`, `mars.rampup`.)

## Theme tokens
Uses your existing `tokens` CSS vars (`--c-green/amber/violet/red`, `--c-panel`,
`--c-bg`, `--c-border`, `--c-border-hover`, `--c-text*`, `--font-mono`,
`--font-head`, `--radius`, `--radius-sm`). A few optional extras are referenced
with fallbacks so it compiles without them — promote them to real tokens for
consistency: `--c-green-border`, `--c-green-fill`, `--c-green-text`,
`--c-red-border`, `--c-amber-border`, `--c-text-bright`, `--c-violet-text`,
`--c-violet-text2`, `--c-violet-fill`, `--c-violet-border`.

## Suggested order of work
1. Copy `mars-tab.proposed.ts` → `ui/components/mars-tab.ts`.
2. Add the new i18n keys (EN + RU).
3. Add the optional theme tokens (or leave the inline fallbacks).
4. Adjust `GROUP_OVERRIDE` for any structure ids the heuristic mis-buckets
   (check the console/visual against your real `STRUCTURES` list).
5. Optional cleanup: add `category` to `Structure` in the engine; drop `groupOf`.
