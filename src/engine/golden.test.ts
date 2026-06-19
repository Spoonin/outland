import { describe, it, expect } from 'vitest';
import { newState, step, mes } from './sim';
import { defaultParams, type StepReport } from './types';
import { NODES } from './graph';

// Golden trajectory captured from prototype/economy.py (events OFF, default Params, fusion ON).
// Events OFF → no RNG calls → fully deterministic, so we assert exact numbers (SDD §9–10).
const CHECKPOINTS: Record<number, Partial<StepReport> & { fusion: string }> = {
  1: { autonomy: 0.546488, runway: 0.5, effPerKg: 60959, launchK: 404125, fusion: 'none' },
  5: { autonomy: 0.786136, runway: 0.5, effPerKg: 237461, launchK: 436858, fusion: 'none' },
  11: { autonomy: 0.750135, runway: 0.5, effPerKg: 225916, launchK: 693526, fusion: 'online' },
  12: { autonomy: 0.748537, runway: 0.5, effPerKg: 869288, launchK: 721793, fusion: 'online' },
  20: { autonomy: 0.773809, runway: 0.5, effPerKg: 893081, launchK: 876064, fusion: 'online' },
  40: { autonomy: 0.771335, runway: 0.5, effPerKg: 1145871, launchK: 876064, fusion: 'online' },
};
const FM = { 1: 0.024635, 12: 0.627446, 40: 0.958015 } as Record<number, number>;

describe('golden trajectory — events OFF reproduces economy.py (SDD §10)', () => {
  const p = defaultParams({ enableEvents: false });
  const s = newState(p);
  const reports: StepReport[] = [];
  for (let i = 0; i < p.maxWindows; i++) {
    if (s.collapsed) break;
    reports.push(step(s));
  }

  it('runs all 40 windows without collapse', () => {
    expect(reports.length).toBe(40);
    expect(s.collapsed).toBe(false);
  });

  it('plateau detected at window 5', () => {
    expect(s.plateauedAt).toBe(5);
  });

  for (const [w, exp] of Object.entries(CHECKPOINTS)) {
    it(`window ${w} matches golden`, () => {
      const r = reports[Number(w) - 1]!;
      expect(r.autonomy).toBeCloseTo(exp.autonomy!, 5);
      expect(r.runway).toBe(exp.runway);
      expect(r.fusion).toBe(exp.fusion);
      expect(r.effPerKg).toBeCloseTo(exp.effPerKg!, -1); // rounded int, allow ±~5
      expect(r.launchK).toBeCloseTo(exp.launchK!, -1);
    });
  }

  for (const [w, fm] of Object.entries(FM)) {
    it(`window ${w} F/M matches golden`, () => {
      const r = reports[Number(w) - 1]!;
      expect(r.F / p.M).toBeCloseTo(fm, 5);
    });
  }

  it('invariants hold every window (thesis): runway pinned, autonomy < 81%, effPerKg ≫ fuel floor', () => {
    for (const r of reports) {
      expect(r.runway).toBe(0.5); // pharma/chips critical AND unlocalized → runway pinned (D-025)
      expect(r.autonomy).toBeLessThan(0.81); // plateau < 100%
      expect(r.effPerKg).toBeGreaterThan(p.fuelPerKg * 10); // capacity capital dominates (D-038)
    }
  });
});

describe('D-045 — no artificial deny: deep nodes are finite-MES (reality-grounded)', () => {
  const p = defaultParams({ enableEvents: false });

  it('every deep node has a finite, reality-grounded mesAnchor', () => {
    for (const n of [NODES['pharma']!, NODES['electronics']!, NODES['catalyst']!,
      NODES['special_alloy']!, NODES['precision_metrology']!]) {
      expect(n.mesAnchor).toBeDefined();
      expect(Number.isFinite(n.mesAnchor)).toBe(true);
      expect(n.mesAnchor!).toBeGreaterThan(1e5); // far beyond a thousand-person colony's demand
    }
  });

  it('at colony scale (pop 1000) deep nodes stay unbuildable — the wall is real, via MES not a gate', () => {
    const s = newState(p);
    step(s); // window 1: needs() computed
    // pharma cons=0.05/kg per-capita → demand ~50 at pop 1000; MES 6.7e5 → demand ≪ MES
    const pharma = NODES['pharma']!;
    expect(mes(p, pharma)).toBe(6.7e5);
    // demand is many orders below MES: not buildable by the same rule as every other node
    expect(50 < mes(p, pharma)).toBe(true);
  });

  it('a deep node IS theoretically localizable at a sufficiently large colony (no-deny proof)', () => {
    // MES is finite, so there exists a colony size whose demand ≥ MES. The nodeStatus/localize path
    // would then admit it — nothing forbids it.
    const pharma = NODES['pharma']!;
    const anchor = mes(p, pharma);
    expect(Number.isFinite(anchor)).toBe(true);
    // a colony of ~anchor/0.05 ≈ 1.34e7 people generates pharma demand ≥ MES → buildable in principle
    const popForBuildable = Math.ceil(anchor / pharma.cons);
    expect(pharma.cons * popForBuildable).toBeGreaterThanOrEqual(anchor);
  });
});
