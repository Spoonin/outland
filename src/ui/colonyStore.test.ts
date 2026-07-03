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
    expect(res.length).toBe(12); // all resources shown in the dashboard
    const food = res.find((c) => c.kind === 'food')!;
    expect(food.windows).toBeCloseTo(2, 1); // ~2 windows of food at start (draining, no farm)
    expect(food.net).toBeLessThan(0);
    expect(res.find((c) => c.kind === 'chips')).toBeDefined();
  });

  it('Mars build queue feeds the commit plan and builds structures', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    // need materials in stock to build — order them, land them first
    store.setRes('steel', 50_000);
    store.setRes('glass', 50_000);
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

    // build a habitat (200 housing)
    store.setRes('steel', 50_000);
    store.setRes('glass', 50_000);
    store.setRes('polymers', 50_000);
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
    store.setColonists(30); // fits the $20B/window budget (D-060) alongside habitat+solar_plant capex
    expect(store.colonists).toBe(30);
    // feed them so the check isolates the housing/import plumbing, not starvation mortality —
    // honest per-capita masses (D-066): 30 people/window ≈ 15 t food, 50.4 t water net, 13.9 t O₂
    // net (n2 covers the imported habitat's own structural hull leak, D-048)
    store.setRes('food', 16_000);
    store.setRes('water', 55_000);
    store.setRes('o2', 15_000);
    store.setRes('n2', 600);

    store.commit(); // ship habitat + colonists + life support together
    expect(store.builtCount('habitat')).toBe(0); // still in transit
    store.commit(); // land: habitat built, colonists arrive
    expect(store.builtCount('habitat')).toBe(1);
    expect(store.status().pop).toBe(30);
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
