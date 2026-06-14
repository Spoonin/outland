import { describe, it, expect } from 'vitest';
import { GameStore } from './store';
import { defaultParams } from '../engine';

describe('GameStore (UI pub/sub over the engine)', () => {
  it('advances windows and notifies subscribers', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    let pings = 0;
    store.subscribe(() => pings++);
    store.advance();
    expect(pings).toBe(1);
    expect(store.latest()?.window).toBe(1);
  });

  it('snapshot omits survival runway (D-025 — debrief only)', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    store.advance();
    const snap = store.snapshot();
    expect(snap).not.toHaveProperty('runway');
    expect(snap.nodes.length).toBe(27);
    expect(snap.autonomy).toBeGreaterThan(0);
  });

  it('stops advancing at maxWindows', () => {
    const store = new GameStore(defaultParams({ enableEvents: false, maxWindows: 3 }));
    store.advance();
    store.advance();
    store.advance();
    expect(store.ended).toBe(true);
    store.advance(); // no-op
    expect(store.latest()?.window).toBe(3);
  });

  it('reset clears history', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    store.advance();
    store.reset();
    expect(store.getHistory().length).toBe(0);
    expect(store.snapshot().window).toBe(0);
  });

  it('manifest playthrough: pick → commit advances window and localizes', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    const plan = store.plan();
    const pick = plan.eligible.slice(0, 2).map((e) => e.name); // e.g. water, oxygen
    pick.forEach((n) => store.toggleLocalize(n));
    expect(pick.every((n) => store.isPicked(n))).toBe(true);
    store.setColonists(50);
    store.commit();
    expect(store.latest()?.window).toBe(1);
    for (const n of pick) expect(store.latest()?.localizedThis).toContain(n);
    expect(store.snapshot().autonomy).toBeGreaterThan(0);
    // draft cleared after commit
    expect(store.draftColonistCount).toBe(0);
    expect(store.isPicked(pick[0]!)).toBe(false);
  });

  it('exposes Earth inflation eroding real M (D-031)', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    expect(store.snapshot().erosionPct).toBe(0); // window 0
    for (let i = 0; i < 10; i++) store.advance();
    const snap = store.snapshot();
    expect(snap.erosionPct).toBeGreaterThan(20); // ~26% by window 10 at 3%/window
    expect(snap.realM).toBeLessThan(snap.M);
  });

  it('object-tree drill-down: focus, expand, econ, localize hookup', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    store.setFocus('food');
    expect(store.focus).toBe('food');
    store.toggleExpand('food');
    expect(store.isExpanded('food')).toBe(true);
    // econ of a black input is intrinsic-cost dominated
    const cat = store.econOf('catalyst');
    expect(cat.unitEarth).toBeGreaterThan(cat.unitShipping);
    expect(store.canLocalize('pharma')).toBe(false); // black
    store.setFocus(null);
    expect(store.focus).toBeNull();
  });

  it('debrief names the survival runway and the black ceiling (D-025/§7.5)', () => {
    const store = new GameStore(defaultParams({ enableEvents: false, maxWindows: 5 }));
    for (let i = 0; i < 5; i++) store.advance();
    const d = store.debrief();
    expect(d.reason).not.toBe('none');
    expect(d.runwayWindows).toBe(0.5);
    expect(d.runwayMonths).toBe(13);
    expect(d.blackCeiling).toContain('pharma');
    expect(d.blackCeiling).toContain('electronics');
    expect(d.autonomyCurve.length).toBe(5);
  });

  it('black nodes always report status "black"', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    const snap = store.snapshot();
    const pharma = snap.nodes.find((n) => n.name === 'pharma')!;
    expect(pharma.status).toBe('black');
  });
});
