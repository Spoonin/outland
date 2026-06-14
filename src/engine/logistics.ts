// Launch logistics (v2, D-043 / colony-sim.md §5). The concrete, tactile form of D-038's abstract
// launch-capacity capital: explicit pads (built capital, idle 25/26 mos between windows), rockets
// (payload/launch; Gen0 expendable → Gen1 reusable+ISRU after R&D, D-039) and fuel. Throughput per
// window = pads × launches/pad × payload — orders can't exceed it (build pads or cut the convoy).

export type LaunchTech = 'classic' | 'reusable';

export interface TechSpec {
  payload: number; // kg landed on Mars per launch
  launchCost: number; // money per launch (rocket + fuel); expendable Gen0 is dear, reusable Gen1 cheap
}

export interface LaunchParams {
  launchesPerPadPerWindow: number; // 1/day × 5-day window = 5
  padCapex: number; // money to build one pad
  padMaintFrac: number; // per-window amortization on every built pad (paid even when idle)
  classic: TechSpec;
  reusable: TechSpec;
  reusableRnDCost: number; // R&D to unlock Gen1 (D-039 mini-megaproject)
}

export interface Fleet {
  pads: number;
  tech: LaunchTech;
}

/** Calibrated illustrative defaults (references §3: FH ~16.8t/$97M, Starship ~100t target). */
export function defaultLaunchParams(overrides: Partial<LaunchParams> = {}): LaunchParams {
  return {
    launchesPerPadPerWindow: 5,
    padCapex: 1.5e8,
    padMaintFrac: 0.1,
    classic: { payload: 16_800, launchCost: 9.7e7 },
    reusable: { payload: 100_000, launchCost: 1.2e7 },
    reusableRnDCost: 5.0e10,
    ...overrides,
  };
}

export function techSpec(p: LaunchParams, tech: LaunchTech): TechSpec {
  return tech === 'reusable' ? p.reusable : p.classic;
}

/** Max launches a fleet can fly in one synodic window. */
export function maxLaunches(fleet: Fleet, p: LaunchParams): number {
  return fleet.pads * p.launchesPerPadPerWindow;
}

/** Max mass (kg) shippable this window = maxLaunches × payload. The throughput ceiling. */
export function throughputMass(fleet: Fleet, p: LaunchParams): number {
  return maxLaunches(fleet, p) * techSpec(p, fleet.tech).payload;
}

/** Launches required to ship a given mass (whole launches, rounded up). */
export function launchesNeeded(massKg: number, p: LaunchParams, tech: LaunchTech): number {
  return Math.ceil(Math.max(0, massKg) / techSpec(p, tech).payload);
}

/** One-time capex to build n pads. */
export function padBuildCost(n: number, p: LaunchParams): number {
  return Math.max(0, n) * p.padCapex;
}

export interface LaunchCost {
  launches: number; // launches actually flown (capped by pads)
  shippedMass: number; // kg actually shipped (launches × payload)
  flightCost: number; // launches × per-launch cost
  padMaint: number; // amortization on ALL built pads (idle penalty, D-038)
  total: number; // flightCost + padMaint (recurring; pad capex is separate)
  effPerKg: number; // total / shippedMass — derived, balloons when pads sit idle
  capped: boolean; // true if the requested mass exceeded throughput
}

/** Recurring launch cost to ship `massKg` this window with the given fleet. */
export function launchCost(fleet: Fleet, p: LaunchParams, massKg: number): LaunchCost {
  const spec = techSpec(p, fleet.tech);
  const want = launchesNeeded(massKg, p, fleet.tech);
  const cap = maxLaunches(fleet, p);
  const launches = Math.min(want, cap);
  const shippedMass = launches * spec.payload;
  const flightCost = launches * spec.launchCost;
  const padMaint = p.padMaintFrac * p.padCapex * fleet.pads;
  const total = flightCost + padMaint;
  return {
    launches,
    shippedMass,
    flightCost,
    padMaint,
    total,
    effPerKg: shippedMass > 0 ? total / shippedMass : 0,
    capped: want > cap,
  };
}
