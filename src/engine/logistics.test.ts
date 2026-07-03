import { describe, it, expect } from 'vitest';
import {
  defaultLaunchParams,
  newFleet,
  maxLaunches,
  throughputMass,
  padMaintTotal,
  padBuildCost,
  shipPlan,
  rollExplosions,
  type Fleet,
} from './logistics';
import { makeRng } from './rng';

const p = defaultLaunchParams();

describe('throughput & pads (D-043, two classes)', () => {
  it('5 classic pads → 25 launches → 75t throughput (D-067: 3t landed per expendable launch)', () => {
    const f = newFleet(p, 5);
    expect(maxLaunches(f, p, 'classic')).toBe(25);
    expect(throughputMass(f, p)).toBe(25 * 3_000);
  });

  it('refuel pads add big-payload capacity', () => {
    const f: Fleet = { pads: { classic: 5, refuel: 1 }, refuelUnlocked: true };
    expect(throughputMass(f, p)).toBe(25 * 3_000 + 5 * 100_000);
  });

  it('maintenance is paid on every built pad of both classes', () => {
    const f: Fleet = { pads: { classic: 2, refuel: 1 }, refuelUnlocked: true };
    expect(padMaintTotal(f, p)).toBe(2 * 0.1 * 1.5e8 + 1 * 0.12 * 5.0e8);
  });

  it('pad build cost differs by class', () => {
    expect(padBuildCost(p, 'classic', 2)).toBe(2 * 1.5e8);
    expect(padBuildCost(p, 'refuel', 1)).toBe(5.0e8);
  });
});

describe('shipPlan — cheapest-$/kg class first', () => {
  it('fills refuel before classic (refuel far cheaper per kg)', () => {
    const f: Fleet = { pads: { classic: 5, refuel: 2 }, refuelUnlocked: true };
    const plan = shipPlan(f, p, 150_000); // refuel cap 2×100k=200k covers it
    expect(plan.launches.refuel).toBeGreaterThan(0);
    expect(plan.launches.classic).toBe(0);
    expect(plan.capped).toBe(false);
  });

  it('falls back to classic once refuel capacity is exhausted', () => {
    const f: Fleet = { pads: { classic: 5, refuel: 1 }, refuelUnlocked: true };
    // refuel: 1 pad × 5 launches × 100k = 500k cap; 600k spills into classic
    const plan = shipPlan(f, p, 600_000);
    expect(plan.launches.refuel).toBe(5);
    expect(plan.launches.classic).toBeGreaterThan(0);
  });

  it('caps at total throughput', () => {
    const f = newFleet(p, 2); // 10 launches × 3t = 30t
    const plan = shipPlan(f, p, 500_000);
    expect(plan.capped).toBe(true);
    expect(plan.deliveredMass).toBe(throughputMass(f, p));
  });
});

describe('rollExplosions — pad loss', () => {
  it('certain explosion loses a pad (prob 1)', () => {
    const params = defaultLaunchParams({
      classic: { ...p.classic, explodeProb: 1 },
    });
    const f = newFleet(params, 3);
    const plan = shipPlan(f, params, 3_000); // 1 classic launch
    const lost = rollExplosions(f, params, plan, makeRng(1));
    expect(lost.classic).toBe(1);
  });

  it('never loses more pads than exist', () => {
    const params = defaultLaunchParams({ classic: { ...p.classic, explodeProb: 1 } });
    const f = newFleet(params, 2); // 2 pads, 10 launches all explode-rolled
    const plan = shipPlan(f, params, throughputMass(f, params));
    const lost = rollExplosions(f, params, plan, makeRng(1));
    expect(lost.classic).toBeLessThanOrEqual(2);
  });

  it('zero probability → no losses', () => {
    const params = defaultLaunchParams({ classic: { ...p.classic, explodeProb: 0 } });
    const f = newFleet(params, 5);
    const plan = shipPlan(f, params, throughputMass(f, params));
    expect(rollExplosions(f, params, plan, makeRng(7)).classic).toBe(0);
  });
});
