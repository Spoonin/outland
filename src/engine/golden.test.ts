import { describe, it, expect } from 'vitest';
import { newState, step } from './sim';
import { defaultParams, type StepReport } from './types';

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
      expect(r.runway).toBe(0.5); // pharma/chips critical AND black (D-025)
      expect(r.autonomy).toBeLessThan(0.81); // plateau < 100%
      expect(r.effPerKg).toBeGreaterThan(p.fuelPerKg * 10); // capacity capital dominates (D-038)
    }
  });
});
