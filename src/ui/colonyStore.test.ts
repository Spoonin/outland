import { describe, it, expect } from 'vitest';
import { ColonyStore, type KV } from './colonyStore';
import { defaultColonyParams, defaultCatalog, cohortAgingForecast } from '../engine';

function memKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** D-085: zeroes out food/pharma spoilage — for tests about something else entirely (housing
 * plumbing, D-056) where spoilage eating an otherwise-exact bootstrap food buffer would cause
 * incidental mortality and shift every headcount-derived assertion. Same spirit as illnessProb:0.
 * NOTE: zeroing the catalog rate alone is NOT enough for food — colony.ts floors the effective
 * rate at ColonyParams.minSpoilRate (0.05 default, meant to stop food_silo from ever reaching
 * zero) regardless of the base catalog value, so callers must ALSO pass `minSpoilRate: 0`. */
function noSpoilCatalog(): ReturnType<typeof defaultCatalog> {
  const cat = defaultCatalog();
  return { ...cat, food: { ...cat.food, spoilRate: 0 }, pharma: { ...cat.pharma, spoilRate: 0 } };
}

describe('ColonyStore (v2 Earth ordering)', () => {
  it('an empty draft stays feasible even once mandatory pad maintenance dwarfs the budget (D-079)', () => {
    // playtest-4's real soft-lock: 60 windows of inflation on an over-built pad fleet pushed
    // mandatory maintenance past the ENTIRE subsidy, and the game had no way to even skip a window.
    // Reproduced with deterministic 100%/window inflation — by ~window 9 the default 5 classic
    // pads' upkeep alone exceeds the default $20B budget, with zero colonists involved at all.
    const store = new ColonyStore(defaultColonyParams({ inflationMin: 1, inflationMax: 1 }), memKV());
    for (let w = 0; w < 15; w++) {
      expect(store.plan().feasible).toBe(true); // an empty draft must ALWAYS be committable
      store.commit();
    }
    expect(store.status().window).toBe(15); // time actually advanced every single window
    expect(store.plan().earth.total).toBeGreaterThan(store.plan().earth.budget); // maintenance really is ruinous by now
  });

  it('draft → preview reflects ordered goods', () => {
    const store = new ColonyStore(defaultColonyParams(), memKV());
    store.setRes('food', 100_000);
    const pv = store.preview();
    expect(pv.mass).toBeCloseTo(110_000, 0); // food tare 0.1
    expect(pv.total).toBeGreaterThan(0);
  });

  it('commit advances a window, lands the convoy next window, clears draft', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }), memKV()); // Mars presence (D-078)
    store.setRes('food', 60_000);
    store.commit();
    expect(store.status().window).toBe(1);
    expect(store.resQty('food')).toBe(0); // draft cleared
    store.commit(); // convoy lands
    expect(store.lastReport()?.landed.stocks.food).toBe(60_000);
  });

  it('status exposes all resource stocks with per-window net & cover', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 2 }), memKV());
    const res = store.status().resources;
    expect(res.length).toBe(19); // all resources shown in the dashboard (incl. fuel D-074, regolith/hydrogen/co2 D-089, composite/components D-090, specialists D-093)
    const food = res.find((c) => c.kind === 'food')!;
    expect(food.windows).toBeCloseTo(2, 1); // ~2 windows of food at start (draining, no farm)
    expect(food.net).toBeLessThan(0);
    expect(res.find((c) => c.kind === 'chips')).toBeDefined();
  });

  it('status exposes crewCoverage — reads straight through from the engine (D-075)', () => {
    // the understaffed-throttle MATH itself is exercised precisely at the engine level
    // (colony.test.ts, "understaffed colony throttles..." / "pop===0 ... not a labor collapse") —
    // this just guards the store's read-through wiring on the common, well-staffed case.
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 2 }), memKV());
    expect(store.status().crewCoverage).toBe(1); // no structures built — nothing to staff
  });

  it('R&D unlock is locked before any colonist has landed, unlocked after (D-077)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV()); // pop0 defaults to 0
    expect(store.rndLocked).toBe(true);
    store.toggleUnlockRefuel();
    expect(store.plan().rndBlocked).toBe(true);
    expect(store.plan().feasible).toBe(false);
    store.toggleUnlockRefuel(); // uncheck — plan.feasible only reflects a REAL attempt
    store.commit(); // just advances the window, nothing landed
    expect(store.rndLocked).toBe(true); // still nobody there

    store.setImportQty('habitat', 1);
    store.setColonists(10);
    store.commit(); // ships
    store.commit(); // lands
    expect(store.rndLocked).toBe(false);
    store.toggleUnlockRefuel();
    expect(store.plan().rndBlocked).toBe(false);
  });

  it('tech tree store plumbing: draft round-trips through order(), clears on commit, unknown ids stay inert (D-088)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    expect(store.techs().length).toBeGreaterThan(0); // D-089/P1: real content now (was [] at P0)
    expect(store.unlockTechDraft()).toBeUndefined();
    expect(store.order().unlockTech).toBeUndefined();

    store.setUnlockTech('nonexistent_tech'); // an unknown/stale id — the DRAFT slot still works
    expect(store.unlockTechDraft()).toBe('nonexistent_tech');
    expect(store.order().unlockTech).toBe('nonexistent_tech');
    expect(store.techBuyable('nonexistent_tech')).toBe(false); // not in the catalog
    expect(store.techPriceNow('nonexistent_tech')).toBe(0); // unbuyable ⇒ free preview, never charged

    store.setUnlockTech('nonexistent_tech'); // clicking the same id again deselects it
    expect(store.unlockTechDraft()).toBeUndefined();

    store.setUnlockTech('nonexistent_tech');
    store.commit(); // stale/unbuyable id is silently dropped by commitWindow's own techBuyable gate
    expect(store.unlockTechDraft()).toBeUndefined(); // draft cleared regardless
  });

  it('a real P1 tech (isru_extraction) is locked below minPop, buyable and priced once population/Mars presence clear the gate (D-089)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV()); // pop0 defaults to 0
    expect(store.techOwned('isru_extraction')).toBe(false);
    expect(store.techBuyable('isru_extraction')).toBe(false); // nobody on Mars yet (D-077)
    expect(store.techPriceNow('isru_extraction')).toBe(0);

    const grown = new ColonyStore(defaultColonyParams({ pop0: 25, startStockWindows: 5 }), memKV());
    expect(grown.techBuyable('isru_extraction')).toBe(true); // minPop 20 met, Mars presence established
    expect(grown.techPriceNow('isru_extraction')).toBeGreaterThan(0);
    grown.setUnlockTech('isru_extraction');
    grown.commit();
    expect(grown.techOwned('isru_extraction')).toBe(true);
    expect(grown.unlockTechDraft()).toBeUndefined(); // draft cleared after commit
  });

  it('cargo alone is bootstrap-blocked before any colonist has landed, freely once established (D-078)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV()); // pop0 defaults to 0
    store.setRes('steel', 20_000); // resources, no colonists in the draft
    expect(store.plan().bootstrapBlocked).toBe(true);
    expect(store.plan().feasible).toBe(false);

    store.setColonists(1); // maxColonists() is 0 (no housing) — this alone won't help, but confirms
    expect(store.colonists).toBe(0); // clamped — can't add colonists without housing yet either

    // the legal path: housing + colonists together unblocks everything in the SAME manifest
    store.setImportQty('base_block', 1);
    store.setColonists(20);
    expect(store.plan().bootstrapBlocked).toBe(false);
    store.commit(); // ships
    store.commit(); // lands — presence established

    // now a resource-only order (no colonists) ships freely
    store.setRes('spares', 300);
    expect(store.plan().bootstrapBlocked).toBe(false);
  });

  it('Mars build queue feeds the commit plan and builds structures', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }), memKV()); // Mars presence (D-078)
    // need materials in stock to build — order them, land them first (60t ≤ 75t throughput, D-067)
    store.setRes('steel', 30_000);
    store.setRes('glass', 30_000);
    store.commit(); // ship materials
    store.commit(); // they land
    store.addBuild('solar_plant');
    expect(store.buildQueue()).toContain('solar_plant');
    expect(store.plan().feasible).toBe(true); // materials in stock, prereq ok, money-free build
    store.commit();
    expect(store.builtCount('solar_plant')).toBe(1);
    expect(store.buildQueue().length).toBe(0); // queue cleared after commit
  });

  it('pad scrap draft: clamped to what exists, net cost shows in the plan, fleet shrinks on commit (D-080/082)', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000 }), memKV());
    expect(store.fleet().pads.classic).toBe(5); // startPads default
    store.setPadScrap('classic', 99); // way more than owned
    expect(store.padScrapQty('classic')).toBe(5); // clamped to what's actually there
    expect(store.padScrapCostNow()).toBeGreaterThan(0); // a real expense, not a refund (D-082)
    expect(store.plan().feasible).toBe(true); // scrapping alone is always affordable (D-079-style exemption)
    store.commit();
    expect(store.fleet().pads.classic).toBe(0);
  });

  it('demolish queue: clamped to built count, materials recycle on commit (D-081)', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }), memKV());
    store.setRes('steel', 30_000);
    store.setRes('glass', 30_000);
    store.commit();
    store.commit();
    store.addBuild('solar_plant');
    store.commit();
    expect(store.builtCount('solar_plant')).toBe(1);

    expect(store.demolishable('solar_plant')).toBe(1);
    store.addDemolish('solar_plant');
    expect(store.demolishQueue()).toContain('solar_plant');
    store.addDemolish('solar_plant'); // only 1 exists — queuing a 2nd must not be allowed
    expect(store.queuedDemolishCount('solar_plant')).toBe(1);
    expect(store.demolishable('solar_plant')).toBe(0);

    const steelBefore = store.stocks().steel;
    store.commit();
    expect(store.builtCount('solar_plant')).toBe(0);
    expect(store.stocks().steel).toBeGreaterThan(steelBefore); // recycled material landed
    expect(store.demolishQueue().length).toBe(0); // queue cleared after commit
  });

  it('plan flags missing prerequisite (nuclear needs waste pad)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    store.addBuild('nuclear_plant');
    expect(store.plan().prereqMissing).toContain('nuclear_plant');
    expect(store.plan().feasible).toBe(false);
  });

  it('colonist order is hard-capped by free housing (V8)', () => {
    // illnessProb 0 (D-083): this tests housing plumbing — one background illness death between
    // commits would free a slot and shift every expected count by one
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5, illnessProb: 0, minSpoilRate: 0, catalog: noSpoilCatalog() }), memKV());
    expect(store.maxColonists()).toBe(0); // no habitat built yet — can't order anyone
    store.setColonists(50);
    expect(store.colonists).toBe(0);

    // establish Mars presence first (D-078: nothing ships alone before it) — BOOTSTRAP GUARANTEE
    // recipe (food + spares from day one — an unmaintained block wears the very window it lands)
    // so all 20 land with zero mortality and base_block's own 20 housing is exactly full
    store.setImportQty('base_block', 1);
    store.setColonists(20);
    store.setRes('food', 20_000);
    store.setRes('spares', 500);
    store.commit(); // ship
    store.commit(); // land — base_block built, 20 colonists alive, housing exactly full

    // NOW import a second habitat (200 housing) — an import-only shipment is legal once presence
    // exists. maxColonists() already credits IN-TRANSIT housing (not just landed, see the sibling
    // test), so check it right after shipping — no need to survive a 4th real window for this.
    store.setImportQty('habitat', 1);
    store.commit(); // ship habitat alone — no colonists in this manifest

    expect(store.maxColonists()).toBe(200); // habitat's 200 — base_block's 20 already filled
    store.setColonists(500); // over the cap
    expect(store.colonists).toBe(200); // clamped
  });

  // D-097 #3: a big single-window colonist batch quietly seeds a synchronized old-age wave decades
  // out (each colonist's deathAge is rolled independently, but they all arrive at nearly the same
  // age) — this warns the player at ORDER time, using the same cohortAgingForecast the engine test
  // suite already pins numerically.
  it('cohortWaveWarning is undefined for a small/no draft, and names the forecast numbers once the draft crosses the batch threshold', () => {
    const p = defaultColonyParams();
    const store = new ColonyStore(p, memKV());
    store.setImportQty('habitat', 1);
    store.setImportQty('solar_plant', 1);
    expect(store.cohortWaveWarning()).toBeUndefined(); // draft is 0

    store.setColonists(5);
    expect(store.cohortWaveWarning()).toBeUndefined(); // below the batch threshold

    store.setColonists(30);
    const warning = store.cohortWaveWarning();
    const { peakWindows, spreadWindows } = cohortAgingForecast(p);
    expect(warning).toBeDefined();
    expect(warning?.colonists).toBe(30);
    expect(warning?.peakWindows).toBe(peakWindows);
    expect(warning?.spreadWindows).toBe(spreadWindows);
  });

  it('import a structure fully built from Earth — lands built, and unblocks colonist ordering same manifest (V8)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    expect(store.maxColonists()).toBe(0);
    store.setImportQty('habitat', 1);
    store.setImportQty('solar_plant', 1); // power them: isolate housing/import plumbing from energy mortality (D-060)
    expect(store.maxColonists()).toBeGreaterThan(0); // housing counted before it even lands
    store.setColonists(10); // fits the 75t/window expendable throughput (D-067) and the $20B budget
    expect(store.colonists).toBe(10);
    // feed them so the check isolates the housing/import plumbing, not starvation mortality —
    // honest per-capita masses (D-066): 10 people/window ≈ 5 t food, 16.8 t water net, 4.6 t O₂
    // net (n2 covers the imported habitat's own structural hull leak, D-048); whole manifest ≈ 74 t
    store.setRes('food', 6_000);
    store.setRes('water', 17_000);
    store.setRes('o2', 5_000);
    store.setRes('n2', 600);

    store.commit(); // ship habitat + colonists + life support together
    expect(store.builtCount('habitat')).toBe(0); // still in transit
    store.commit(); // land: habitat built, colonists arrive
    expect(store.builtCount('habitat')).toBe(1);
    expect(store.status().pop).toBe(10);
  });

  it('BOOTSTRAP GUARANTEE: base_block + 20 colonists + food buffer fits one window (D-057/D-060/D-067)', () => {
    // The canonical first move must stay feasible through any balance pass: honest masses (D-066)
    // and honest launch economics (D-067) both squeeze it — this is the regression tripwire.
    const store = new ColonyStore(defaultColonyParams({ }), memKV());
    store.setImportQty('base_block', 1);
    expect(store.maxColonists()).toBe(20); // the block's housing counts before it lands
    store.setColonists(20);
    store.setRes('food', 20_000); // 2 windows of food for 20 (base_block covers water/O₂/N₂)
    store.setRes('spares', 500); // ЗИП from day one — an unmaintained block wears the very window it lands
    const plan = store.plan();
    expect(plan.earth.capped).toBe(false); // ~68t ≤ 75t expendable throughput
    expect(plan.overBudget).toBe(false); // ≤ $20B window subsidy
    expect(plan.feasible).toBe(true);

    store.commit(); // ship
    store.commit(); // land: block built, colonists alive on its life support
    expect(store.builtCount('base_block')).toBe(1);
    expect(store.status().pop).toBe(20); // zero mortality on arrival
  });

  it('housing already in transit from an earlier order counts toward maxColonists (V8)', () => {
    // illnessProb 0 (D-083) — housing plumbing test, background deaths would shift the counts
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5, illnessProb: 0, minSpoilRate: 0, catalog: noSpoilCatalog() }), memKV());
    // establish Mars presence first (D-078) — the FIRST shipment must carry colonists;
    // BOOTSTRAP GUARANTEE recipe (food + spares from day one) for zero mortality on arrival
    store.setImportQty('base_block', 1);
    store.setColonists(20);
    store.setRes('food', 20_000);
    store.setRes('spares', 500);
    store.commit(); // ship
    store.commit(); // land — base_block built, 20 colonists alive, housing exactly full

    // a LATER shipment (presence already established) can send more housing alone, no colonists —
    // checked while still IN TRANSIT (one commit only), so the 2-window food buffer isn't in play
    store.setImportQty('habitat', 1);
    store.commit(); // ship habitat alone — no colonists in this manifest
    expect(store.builtCount('habitat')).toBe(0); // still in transit, not landed yet

    // habitat lands at the start of THIS coming commit — before any colonists ordered in the
    // current draft would themselves land (they wait one more cycle) — so it must already count
    // toward free housing now. Otherwise the player is wrongly blocked the window right after
    // sending a housing module on its own (only the same-manifest case was covered before).
    expect(store.maxColonists()).toBe(200); // habitat's 200 — base_block's 20 already filled
    store.setColonists(200);
    expect(store.colonists).toBe(200);
  });

  it('exposes a live buffer gauge that ignores the in-progress draft (D-062)', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 0 }), memKV());
    const before = store.status().buffer;
    store.setRes('food', 500_000); // draft a huge order — not yet committed
    expect(store.status().buffer).toBe(before); // buffer reflects committed state only, cached by window
    store.commit();
    // after a real commit the window advances and the convoy hasn't landed yet — cache must recompute
    expect(store.status().window).toBe(1);
  });

  it('exposes the chronicle — one entry per committed window (D-061)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    expect(store.chronicle().length).toBe(0);
    store.commit();
    store.commit();
    expect(store.chronicle().length).toBe(2);
    expect(store.chronicle()[1]).toBe(store.lastReport());
  });

  it('autosaves and reloads', () => {
    const kv = memKV();
    const a = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), kv);
    a.setRes('water', 50_000);
    a.commit();
    const b = new ColonyStore(undefined, kv);
    expect(b.status().window).toBe(1);
  });
});

describe('no win state — collapse or finish only (D-064)', () => {
  it('never ends on a window count alone — maxWindows is a technical test parameter, not a limit', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 200, startStockWindows: 5, maxWindows: 3 }), memKV());
    store.commit();
    store.commit();
    store.commit();
    store.commit(); // past the old maxWindows=3 — must still be playable
    expect(store.status().ended).toBe(false);
    expect(store.status().window).toBe(4);
  });

  it('finish() ends the run without collapsing the colony', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 200, startStockWindows: 5 }), memKV());
    store.commit();
    expect(store.status().ended).toBe(false);
    store.finish();
    expect(store.status().ended).toBe(true);
    expect(store.status().collapsed).toBe(false);
    expect(store.debrief()?.reason).toBe('finished');
  });

  it('a player-opened debrief closes back into play — «дебриф по кнопке в любой момент» (D-064)', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 200, startStockWindows: 5 }), memKV());
    store.commit();
    store.finish();
    expect(store.status().ended).toBe(true);
    store.resume();
    expect(store.status().ended).toBe(false);
    store.commit(); // still playable
    expect(store.status().window).toBe(2);
  });

  it('a collapse is never resumable', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 50, startStockWindows: 0 }), memKV());
    for (let i = 0; i < 10 && !store.status().collapsed; i++) store.commit();
    expect(store.status().collapsed).toBe(true);
    store.resume();
    expect(store.status().ended).toBe(true); // still over
  });

  it('debrief() is undefined until the run has actually ended', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 200, startStockWindows: 5 }), memKV());
    store.commit();
    expect(store.debrief()).toBeUndefined();
  });

  it('debrief reports the milestone checklist and time series from the chronicle', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 150, startStockWindows: 5 }), memKV());
    store.commit();
    store.commit();
    store.finish();
    const d = store.debrief()!;
    expect(d.milestones.length).toBe(19); // D-089/D-090/D-091 added 4, D-095 (P6) added 5, D-096 (P7) added 1, D-097 (#5) added 1
    expect(d.milestones.find((m) => m.id === 'pop_100')?.window).toBe(1);
    expect(d.populationSeries.length).toBe(2);
    expect(d.autonomySeries.length).toBe(2);
    expect(d.stockSeries.food.length).toBe(2);
    expect(d.collapseCause).toEqual({}); // colony didn't collapse — no cause to name
  });

  it('reset clears a finished run back to playable', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 200, startStockWindows: 5 }), memKV());
    store.finish();
    expect(store.status().ended).toBe(true);
    store.reset();
    expect(store.status().ended).toBe(false);
  });

  it('debrief names a collapse cause from the terminal death spiral', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 50, startStockWindows: 0 }), memKV());
    let ended = false;
    for (let i = 0; i < 10 && !ended; i++) {
      store.commit();
      ended = store.status().collapsed;
    }
    expect(ended).toBe(true);
    const d = store.debrief()!;
    expect(d.reason).toBe('collapsed');
    expect(Object.keys(d.collapseCause).length).toBeGreaterThan(0);
  });
});

describe('auto-spares — floors the order at upkeep, manual can still add margin (playtest finding)', () => {
  it('off by default: no spares ordered unless the player sets some', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    expect(store.autoSparesEnabled).toBe(false);
    expect(store.resQty('spares')).toBe(0);
  });

  it('on: floors the order at spareUpkeep(built) even with the slider at 0', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }), memKV()); // Mars presence (D-078)
    store.setRes('steel', 30_000);
    store.setRes('glass', 30_000);
    store.commit();
    store.commit(); // materials land
    store.addBuild('solar_plant'); // upkeepSpares=300/window (structures.csv)
    store.commit(); // built

    store.toggleAutoSpares();
    expect(store.autoSparesEnabled).toBe(true);
    expect(store.resQty('spares')).toBe(300); // solar_plant's upkeepSpares, slider untouched
    expect(store.order().resources.spares).toBe(300); // flows through to the actual order
  });

  it('manual slider can still ask for MORE than the auto floor, never less', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }), memKV()); // Mars presence (D-078)
    store.setRes('steel', 30_000);
    store.setRes('glass', 30_000);
    store.commit();
    store.commit();
    store.addBuild('solar_plant');
    store.commit();
    store.toggleAutoSpares();

    store.setRes('spares', 1000); // above the 300 floor
    expect(store.resQty('spares')).toBe(1000);
    store.setRes('spares', 10); // below the floor — auto still wins
    expect(store.resQty('spares')).toBe(300);
  });
});

describe('inflation-accurate price display (playtest bug — cards showed window-0 prices forever)', () => {
  it('pricePerKg matches what previewOrder actually charges, and rises with inflation', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, inflationMin: 0.05, inflationMax: 0.05 }), memKV());
    const at0 = store.pricePerKg('food');
    store.setRes('food', 1000);
    expect(store.preview().goodsCost).toBeCloseTo(at0 * 1000, 0);
    for (let i = 0; i < 5; i++) store.commit();
    const atWindow5 = store.pricePerKg('food');
    expect(atWindow5).toBeGreaterThan(at0);
  });

  it('colonistPriceNow and padPriceNow rise with inflation too', () => {
    const store = new ColonyStore(defaultColonyParams({ inflationMin: 0.05, inflationMax: 0.05 }), memKV());
    const colonist0 = store.colonistPriceNow();
    const pad0 = store.padPriceNow('classic');
    for (let i = 0; i < 5; i++) store.commit();
    expect(store.colonistPriceNow()).toBeGreaterThan(colonist0);
    expect(store.padPriceNow('classic')).toBeGreaterThan(pad0);
  });

  it('deliveryPerKg reflects inflation, not just the window-0 launch price', () => {
    const store = new ColonyStore(defaultColonyParams({ inflationMin: 0.05, inflationMax: 0.05 }), memKV());
    const d0 = store.deliveryPerKg().perKg;
    for (let i = 0; i < 5; i++) store.commit();
    expect(store.deliveryPerKg().perKg).toBeGreaterThan(d0);
  });
});

describe('inTransit — visible cargo already shipped (playtest bug — this was invisible)', () => {
  it('reflects an order the window after it ships, empties out the window after it lands', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }), memKV()); // Mars presence (D-078)
    expect(store.inTransit().colonists).toBe(0);
    store.setRes('food', 40_000);
    store.commit(); // ships
    expect(store.inTransit().stocks.food).toBe(40_000);
    store.commit(); // lands
    expect(store.inTransit().stocks.food).toBe(0);
  });
});

// D-097 #4 (playtest-7 finding): food spoilage on a large stockpile is a silent tax — a city-sized
// insurance buffer loses real tonnage every window and nothing names it. projectionWarnings() now
// names it, but only when a silo would ACTUALLY help (not already floored at minSpoilRate) and the
// savings clear a noise floor (bootstrap-scale losses shouldn't nag the player every window).
describe('projectionWarnings — food spoilage hint (D-097 #4)', () => {
  it('no spoilage line when nothing has spoiled yet', () => {
    const store = new ColonyStore(defaultColonyParams(), memKV());
    expect(store.projectionWarnings().some((l) => l.includes('порча'))).toBe(false);
  });

  it('names the loss and the silo savings once a real stockpile is sitting there decaying', () => {
    const store = new ColonyStore(defaultColonyParams(), memKV());
    // BOOTSTRAP GUARANTEE recipe (D-057/D-060/D-067): base_block covers water/O₂/N₂ itself, only
    // food + spares needed — matches the canonical first-move fixture elsewhere in this file
    store.setImportQty('base_block', 1);
    store.setColonists(20);
    store.setRes('food', 20_000);
    store.setRes('spares', 500);
    store.commit(); // ships
    store.commit(); // lands — pop 20, food buffer in stock

    // a big surplus food order, well beyond what 20 people eat in a window — the kind of insurance
    // stockpile a growing colony keeps, and exactly what quietly rots without a silo
    store.setRes('food', 60_000);
    store.commit(); // ships
    store.commit(); // lands — large food stock now sitting in the store, no food_silo built

    const warnings = store.projectionWarnings();
    const spoilLine = warnings.find((l) => l.includes('порча'));
    expect(spoilLine).toBeDefined();
    expect(spoilLine).toContain('продсклад');
  });

  it('no spoilage line once already floored at minSpoilRate — a silo genuinely would not help further', () => {
    // spoilRate 0 + minSpoilRate 0 means foodSpoiledKg is always 0 — the cheapest way to pin the
    // "already at floor, nothing to suggest" branch without constructing several real food_silo units
    const store = new ColonyStore(defaultColonyParams({ minSpoilRate: 0, catalog: noSpoilCatalog() }), memKV());
    store.setImportQty('base_block', 1);
    store.setColonists(20);
    store.setRes('food', 20_000);
    store.setRes('spares', 500);
    store.commit();
    store.commit();
    expect(store.projectionWarnings().some((l) => l.includes('порча'))).toBe(false);
  });
});
