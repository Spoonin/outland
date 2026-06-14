import { describe, it, expect } from 'vitest';
import { needs, importBreakdown, launchMaint, autonomyByMass, survivalRunway } from './sim';
import { mkState } from './_testutil';

describe('importBreakdown / launchMaint (D-038, SDD §6) — golden vs prototype', () => {
  it('fresh colony fImp + shipMass', () => {
    const s = mkState({ pop: 1000 });
    const { fImp, shipMass } = importBreakdown(s, needs(s), 1.0);
    expect(shipMass).toBeCloseTo(404125, 0);
    expect(fImp).toBeCloseTo(22661851400, 0);
  });

  it('launchMaint scales with built capacity', () => {
    const s = mkState({ launchK: 1e6 });
    expect(launchMaint(s)).toBe(3.2e9); // 0.08 · 4e4 · 1e6
  });

  it('fusion online discounts imports and adds its own floor', () => {
    const base = mkState({ pop: 1000 });
    const fused = mkState({ pop: 1000, fusion: 'online' });
    const nd = needs(base);
    const f0 = importBreakdown(base, nd, 1.0).fImp;
    const f1 = importBreakdown(fused, nd, 1.0).fImp;
    const p = base.p;
    expect(f1).toBeCloseTo(f0 * (1 - p.fusionDiscount) + p.fusionMaintM * p.M, 0);
  });
});

describe('autonomyByMass (D-025)', () => {
  it('fresh colony = 0 (nothing localized)', () => {
    const s = mkState({ pop: 1000 });
    expect(autonomyByMass(s, needs(s))).toBe(0);
  });

  it('localizing heavy bulk lifts autonomy (golden: water+steel)', () => {
    const s = mkState({ pop: 1000 });
    s.localized['water'] = true;
    s.localized['steel'] = true;
    expect(autonomyByMass(s, needs(s))).toBeCloseTo(0.567531, 5);
  });
});

describe('survivalRunway (D-025, Liebig) — pinned at 0.5', () => {
  it('fresh colony = 0.5', () => {
    const s = mkState({ pop: 1000 });
    expect(survivalRunway(s, needs(s))).toBe(0.5);
  });

  it('still 0.5 with heavy bulk localized (pharma/chips critical AND black)', () => {
    const s = mkState({ pop: 1000 });
    s.localized['water'] = true;
    s.localized['steel'] = true;
    expect(survivalRunway(s, needs(s))).toBe(0.5);
  });
});
