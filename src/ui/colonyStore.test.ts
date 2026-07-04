import { describe, it, expect } from 'vitest';
import { ColonyStore, type KV } from './colonyStore';
import { defaultColonyParams } from '../engine';

function memKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('ColonyStore (v2 Earth ordering)', () => {
  it('draft → preview reflects ordered goods', () => {
    const store = new ColonyStore(defaultColonyParams(), memKV());
    store.setRes('food', 100_000);
    const pv = store.preview();
    expect(pv.mass).toBeCloseTo(110_000, 0); // food tare 0.1
    expect(pv.total).toBeGreaterThan(0);
  });

  it('commit advances a window, lands the convoy next window, clears draft', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
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
    expect(res.length).toBe(13); // all resources shown in the dashboard (incl. fuel, D-074)
    const food = res.find((c) => c.kind === 'food')!;
    expect(food.windows).toBeCloseTo(2, 1); // ~2 windows of food at start (draining, no farm)
    expect(food.net).toBeLessThan(0);
    expect(res.find((c) => c.kind === 'chips')).toBeDefined();
  });

  it('Mars build queue feeds the commit plan and builds structures', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
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

  it('plan flags missing prerequisite (nuclear needs waste pad)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    store.addBuild('nuclear_plant');
    expect(store.plan().prereqMissing).toContain('nuclear_plant');
    expect(store.plan().feasible).toBe(false);
  });

  it('colonist order is hard-capped by free housing (V8)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    expect(store.maxColonists()).toBe(0); // no habitat built yet — can't order anyone
    store.setColonists(50);
    expect(store.colonists).toBe(0);

    // build a habitat (200 housing) — order just its materials (31.5t ≤ 75t throughput, D-067)
    store.setRes('steel', 10_000);
    store.setRes('glass', 10_000);
    store.setRes('polymers', 10_000);
    store.commit();
    store.commit(); // materials land
    store.addBuild('habitat');
    store.commit(); // habitat built

    expect(store.maxColonists()).toBe(200);
    store.setColonists(500); // over the cap
    expect(store.colonists).toBe(200); // clamped
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
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    store.setImportQty('base_block', 1);
    store.commit(); // ship base_block alone — no colonists in this manifest
    expect(store.builtCount('base_block')).toBe(0); // still in transit, not landed yet

    // base_block lands at the start of THIS coming commit — before any colonists ordered in the
    // current draft would themselves land (they wait one more cycle) — so it must already count
    // toward free housing now. Otherwise the player is wrongly blocked the window right after
    // sending a housing module on its own (only the same-manifest case was covered before).
    expect(store.maxColonists()).toBe(20);
    store.setColonists(20);
    expect(store.colonists).toBe(20);
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
    expect(d.milestones.length).toBe(8);
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
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
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
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
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
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, inflation: 0.05 }), memKV());
    const at0 = store.pricePerKg('food');
    store.setRes('food', 1000);
    expect(store.preview().goodsCost).toBeCloseTo(at0 * 1000, 0);
    for (let i = 0; i < 5; i++) store.commit();
    const atWindow5 = store.pricePerKg('food');
    expect(atWindow5).toBeGreaterThan(at0);
  });

  it('colonistPriceNow and padPriceNow rise with inflation too', () => {
    const store = new ColonyStore(defaultColonyParams({ inflation: 0.05 }), memKV());
    const colonist0 = store.colonistPriceNow();
    const pad0 = store.padPriceNow('classic');
    for (let i = 0; i < 5; i++) store.commit();
    expect(store.colonistPriceNow()).toBeGreaterThan(colonist0);
    expect(store.padPriceNow('classic')).toBeGreaterThan(pad0);
  });

  it('deliveryPerKg reflects inflation, not just the window-0 launch price', () => {
    const store = new ColonyStore(defaultColonyParams({ inflation: 0.05 }), memKV());
    const d0 = store.deliveryPerKg().perKg;
    for (let i = 0; i < 5; i++) store.commit();
    expect(store.deliveryPerKg().perKg).toBeGreaterThan(d0);
  });
});

describe('inTransit — visible cargo already shipped (playtest bug — this was invisible)', () => {
  it('reflects an order the window after it ships, empties out the window after it lands', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    expect(store.inTransit().colonists).toBe(0);
    store.setRes('food', 40_000);
    store.commit(); // ships
    expect(store.inTransit().stocks.food).toBe(40_000);
    store.commit(); // lands
    expect(store.inTransit().stocks.food).toBe(0);
  });
});
