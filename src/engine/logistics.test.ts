import { describe, it, expect } from 'vitest';
import {
  defaultLaunchParams,
  maxLaunches,
  throughputMass,
  launchesNeeded,
  padBuildCost,
  launchCost,
  type Fleet,
} from './logistics';

const p = defaultLaunchParams();

describe('throughput (D-043, colony-sim §5)', () => {
  it('5 pads → 25 launches/window', () => {
    expect(maxLaunches({ pads: 5, tech: 'classic' }, p)).toBe(25);
  });

  it('throughput mass = launches × payload', () => {
    expect(throughputMass({ pads: 5, tech: 'classic' }, p)).toBe(25 * 16_800);
  });

  it('reusable tech lifts payload (Starship vs Falcon Heavy)', () => {
    const classic = throughputMass({ pads: 5, tech: 'classic' }, p);
    const reusable = throughputMass({ pads: 5, tech: 'reusable' }, p);
    expect(reusable).toBeGreaterThan(classic);
  });

  it('launchesNeeded rounds up to whole launches', () => {
    expect(launchesNeeded(16_800, p, 'classic')).toBe(1);
    expect(launchesNeeded(16_801, p, 'classic')).toBe(2);
    expect(launchesNeeded(0, p, 'classic')).toBe(0);
  });
});

describe('cost (D-043)', () => {
  it('pad build cost scales with count', () => {
    expect(padBuildCost(3, p)).toBe(3 * p.padCapex);
  });

  it('reusable cheaper per kg than classic at full utilisation', () => {
    const fleetC: Fleet = { pads: 5, tech: 'classic' };
    const fleetR: Fleet = { pads: 5, tech: 'reusable' };
    const c = launchCost(fleetC, p, throughputMass(fleetC, p));
    const r = launchCost(fleetR, p, throughputMass(fleetR, p));
    expect(r.effPerKg).toBeLessThan(c.effPerKg);
  });

  it('idle pads inflate effective $/kg (D-038 idle penalty)', () => {
    const fleet: Fleet = { pads: 10, tech: 'classic' };
    const busy = launchCost(fleet, p, throughputMass(fleet, p)); // all 10 pads × 5 used
    const idle = launchCost(fleet, p, 16_800); // 1 launch, 10 pads maintained
    expect(idle.effPerKg).toBeGreaterThan(busy.effPerKg);
    expect(idle.padMaint).toBe(p.padMaintFrac * p.padCapex * 10);
  });

  it('caps at throughput when the convoy exceeds pad capacity', () => {
    const fleet: Fleet = { pads: 2, tech: 'classic' }; // 10 launches max
    const huge = throughputMass(fleet, p) * 3;
    const lc = launchCost(fleet, p, huge);
    expect(lc.capped).toBe(true);
    expect(lc.launches).toBe(maxLaunches(fleet, p));
    expect(lc.shippedMass).toBe(throughputMass(fleet, p));
  });
});
