import { describe, it, expect } from 'vitest';
import { newState, step, planView, mes } from './sim';
import { NODES } from './graph';
import { defaultParams } from './types';

describe('step(state, decision) — player-directed allocation (Phase 3)', () => {
  it('localizes only requested eligible nodes', () => {
    const s = newState(defaultParams({ enableEvents: false }));
    // water & oxygen are buildable at pop 1000; steel (MES 600 > demand 300) is not
    const r = step(s, { localize: ['water', 'oxygen', 'steel'], colonists: 0 });
    expect(r.localizedThis.sort()).toEqual(['oxygen', 'water']);
    expect(s.localized['water']).toBe(true);
    expect(s.localized['steel']).toBe(false); // below MES → refused
    expect(s.localized['food']).toBe(false); // not requested
  });

  it('refuses black nodes and below-MES nodes', () => {
    const s = newState(defaultParams({ enableEvents: false }));
    const r = step(s, { localize: ['pharma', 'machinery'], colonists: 0 });
    // pharma is black; machinery (tier5, MES 4800) demand far below at pop 1000 → both refused
    expect(r.localizedThis).toEqual([]);
    expect(s.localized['pharma']).toBe(false);
  });

  it('imports the requested colonists when affordable', () => {
    const s = newState(defaultParams({ enableEvents: false }));
    const before = s.pop;
    step(s, { localize: [], colonists: 100 });
    expect(s.pop).toBeCloseTo(before + 100, 6); // medical_infra not localized → no births
  });

  it('caps colonists by available capital', () => {
    const s = newState(defaultParams({ enableEvents: false, M: 1e9 })); // tiny subsidy
    const before = s.pop;
    step(s, { localize: [], colonists: 1_000_000 });
    expect(s.pop - before).toBeLessThan(1_000_000); // can't afford all
  });
});

describe('planView — manifest preview (deterministic, no RNG)', () => {
  it('lists buildable nodes with localization cost, excludes black/localized', () => {
    const s = newState(defaultParams({ enableEvents: false }));
    const pv = planView(s);
    const names = pv.eligible.map((e) => e.name);
    expect(names).toContain('water');
    expect(names).not.toContain('pharma'); // black
    const water = pv.eligible.find((e) => e.name === 'water')!;
    expect(water.cost).toBe(s.p.capitalFactor * mes(s.p, NODES['water']!));
  });

  it('projectedFree = M − F − capex (sane bounds)', () => {
    const s = newState(defaultParams({ enableEvents: false }));
    const pv = planView(s);
    expect(pv.projectedF).toBeGreaterThan(0);
    expect(pv.projectedFree).toBeLessThan(pv.M);
  });

  it('eligible shrinks after localizing (demand-driven derived may open new ones)', () => {
    const s = newState(defaultParams({ enableEvents: false }));
    const before = planView(s).eligible.length;
    step(s, { localize: ['water'], colonists: 0 });
    const after = planView(s).eligible.map((e) => e.name);
    expect(after).not.toContain('water'); // now localized
    void before;
  });
});

describe('golden trajectory still intact (decision omitted → greedy)', () => {
  it('window 1 autonomy unchanged', () => {
    const s = newState(defaultParams({ enableEvents: false }));
    const r = step(s); // no decision
    expect(r.autonomy).toBeCloseTo(0.546488, 5);
  });
});
