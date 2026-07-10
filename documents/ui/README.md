# Handoff: Earth — Resupply tab redesign

Applies the redesigned ordering manifest to the real codebase. Target:
**`ui/components/earth-tab.ts`** — render + card renderers + styles get replaced;
every `ColonyStore` method the current component calls is reused **unchanged**.

## Files in this bundle
- **`earth-tab.proposed.ts`** — drop-in replacement for `ui/components/earth-tab.ts`.
- **`Mars Earth Tab.dc.html`** — visual reference / prototype (open in a browser;
  `freeHousing` tweak unlocks the People tab, `language` toggles EN/RU).

## The two problems this fixes
1. **Sliders are the wrong control for ordering quantities.** Every
   `<input type="range">` is replaced with a **stepper** (`− value +`). Resource
   cards add **quick-add presets** (`+10t / +50t / +100t / Clear`) so you can reach
   large kg totals without dragging; structures/pads/colonists use a plain integer
   stepper. Exact value + live cost are always visible.
2. **"A pile of different things in one block."** Cards are now differentiated by
   type and given a fixed anatomy:
   - **Resource cards** (Life Support / Materials / High-tech) show a
     **goods-vs-delivery cost split** (chips + bar). This surfaces that delivery is
     ~99% of landed cost — e.g. steel is $2/kg goods but ~$51,667/kg landed — which
     is the real "build locally" signal, previously buried in a prose sub-line.
   - **Structure cards** (Import) get a **hero landed cost**, a cost breakdown,
     power/housing pills, and a **prereq lock badge** (Nuclear stays locked until a
     Waste Pad is ordered/built).
   - **Pad cards** (Logistics) turn the prose into labeled **stat chips**
     (payload / upkeep / explode-risk); the R&D card shows a lock badge.
   - **Technology** lists buyable techs up top and **collapses** the locked ones
     into a `Locked (N)` section instead of a wall of identical gray cards.
3. **Live order-summary bar** on the tab: total $ committed, ship mass, and (if you
   pass `windowSubsidy`) an over-budget flag — the same live-consequences pattern
   as the construction tab.

## Store API used — all already on `ColonyStore`
`resQty`, `catalog`, `deliveryPerKg`, `pricePerKg`, `setRes`,
`autoSparesEnabled` / `toggleAutoSpares`, `autoPharmaEnabled` / `toggleAutoPharma`,
`structures`, `importQty`, `importUnitPlan`, `importPrereqMet`, `builtCount`,
`setImportQty`, `techOwned`, `padClassFor` (engine), `fleet`, `launch`,
`padPriceNow`, `padQty`, `setPad`, `padScrapQty`, `setPadScrap`, `refuelRnD`,
`rndLocked`, `unlockRefuelDraft`, `toggleUnlockRefuel`, `techs`, `techBuyable`,
`unlockTechDraft`, `setUnlockTech`, `techPriceNow`, `maxColonists`,
`colonistPriceNow`, `colonists`, `setColonists`, `cohortWaveWarning`, `subscribe`.
Struct fields used: `id`, `name`, `energy`, `housing`, `prereq`, `techGate`.

All the setters take an **absolute** value (`setRes(r, n)`, `setImportQty(id, n)`,
`setPad(tech, n)`, `setColonists(n)`), so the steppers just compute `current ± step`
and clamp — no new store methods needed.

## The one optional input: `windowSubsidy`
The summary bar shows total + mass always. To also show the **subsidy** and the
**over-budget** flag, pass the window subsidy ($) — source it from wherever the
shared commit footer (`colony-app.ts`) already gets its budget number
(`store.status()` / `store.plan()`):

```ts
html`<earth-tab .store=${this.store} .windowSubsidy=${this.store.status().M}></earth-tab>`
```

Omit it and the bar degrades gracefully to total + mass, leaving feasibility to the
footer (which still owns commit-time validation). The `orderCost()` helper computes
the total locally from the same per-line math the cards use, so it always matches
what `commit()` will bill.

## New i18n keys to add (EN + RU)
```
earth.orderTotal        "Order total"      / "Итого заказ"
earth.windowSubsidy     "Window subsidy"   / "Субсидия окна"
earth.shipMass          "Ship mass"        / "Масса к отправке"
earth.clearAll          "Clear all"        / "Очистить всё"
earth.overBy            "Over by {v}"      / "Превышение на {v}"
earth.goods             "goods"            / "товар"
earth.delivery          "delivery"         / "доставка"
earth.landed            "Landed"           / "С доставкой"
earth.isDelivery        "is delivery"      / "доставка"
earth.perUnitLanded     "per unit, landed" / "за ед. с доставкой"
earth.lineTotal         "Line total"       / "Строка"
earth.perPad            "per pad"          / "за площадку"
earth.clear             "Clear"            / "Сброс"
earth.payload           "payload"          / "полезн. нагр."
earth.upkeep            "upkeep"           / "обслуж."
earth.explodeRisk       "explode risk"     / "риск взрыва"
earth.turnkeyBreakdown  "structure {cost} + delivery {delivery} · {mass}, {tech}"
                        / "структура {cost} + доставка {delivery} · {mass}, {tech}"
mars.collapse           "collapse"         / "скрыть"        (shared w/ construction handoff)
mars.showRequirements   "show requirements"/ "показать требования"
```
Reused existing keys: `earth.tab*`, `earth.auto`, `earth.n2Note`,
`earth.autoSparesLabel/Note`, `earth.autoPharmaLabel`, `earth.have`,
`earth.needTech/needFirst`, `earth.padHave/padLine/scrapLabel`,
`earth.rndTitle/rndStage/rndDesc1/rndDesc2/rndLockedNote/rndOrder`,
`earth.techOrder/techLockedNote/techTreeIntro/techTreeEmpty/techWarn`,
`earth.importIntro`, `earth.colonistsLabel/noHousing/perHead/lineCostNoDelivery/cohortWave`,
`mars.locked`, `status.kg`, `status.wnd`, `status.housing`.
(The old `earth.priceLine` / `earth.turnkeyLine` single-string formats are replaced
by the split chips + `earth.turnkeyBreakdown`; you can retire them.)

## Theme tokens
Uses existing `tokens` vars plus a few referenced with fallbacks — promote to real
tokens for consistency: `--c-violet`, `--c-violet-text`, `--c-violet-text2`,
`--c-violet-fill`, `--c-violet-border`.

## Behavior preserved
- All the pricing math (`pricePerKg`, tare-inclusive delivery, inflation-aware
  `padPriceNow`/`techPriceNow`) is carried over verbatim, so displayed costs match
  `commit()`.
- Auto-spares / auto-pharma toggles, N₂ note, pad-scrap control, R&D ladder,
  cohort-wave warning, and the empty-techs.csv case are all retained.

## Suggested order of work
1. Copy `earth-tab.proposed.ts` → `ui/components/earth-tab.ts`.
2. Add the new i18n keys (EN + RU).
3. Pass `.windowSubsidy=${...}` from `colony-app.ts` (optional — degrades gracefully).
4. Add the `--c-violet*` tokens (or keep inline fallbacks).
5. Verify against your real `catalog()` prices and `structures()` list — the
   prototype's numbers are illustrative; the component reads live values.
