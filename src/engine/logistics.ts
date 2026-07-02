// Launch logistics (v2, D-043 / colony-sim.md §5). Two pad classes the player builds and maintains:
// CLASSIC multistage (expendable — cheap pad, small payload, dear per-launch, riskier) and REFUEL
// (orbital-refuelling reusable — unlocked by R&D, dearer pad, big payload, cheap per-launch, safer).
// Pads are capital: capex to build + per-window maintenance paid the whole time, even idle (D-038).
// A launch can lose its pad to an on-pad explosion (per-launch probability; classic riskier).

import type { Rng } from './types';

export type LaunchTech = 'classic' | 'refuel';
export const TECHS: readonly LaunchTech[] = ['classic', 'refuel'];

export interface PadClass {
  payload: number; // kg landed on Mars per launch
  launchCost: number; // money per launch (rocket + fuel)
  padCapex: number; // money to build one pad
  padMaintFrac: number; // per-window maintenance, fraction of capex (paid even idle)
  explodeProb: number; // per-launch chance the pad is lost to an explosion
}

export interface LaunchParams {
  launchesPerPadPerWindow: number; // 1/day × 5-day window = 5
  classic: PadClass;
  refuel: PadClass;
  refuelRnDCost: number; // one-time R&D to unlock the refuel class (D-039)
}

export interface Fleet {
  pads: Record<LaunchTech, number>;
  refuelUnlocked: boolean;
}

/** Calibrated illustrative defaults (references §3; explosion rates per D-043 discussion). */
export function defaultLaunchParams(overrides: Partial<LaunchParams> = {}): LaunchParams {
  return {
    launchesPerPadPerWindow: 5,
    classic: { payload: 16_800, launchCost: 9.7e7, padCapex: 1.5e8, padMaintFrac: 0.1, explodeProb: 0.0025 },
    refuel: { payload: 100_000, launchCost: 1.2e7, padCapex: 5.0e8, padMaintFrac: 0.12, explodeProb: 0.0005 },
    refuelRnDCost: 7.5e9, // ~37% субсидии-окна (D-053, пересчитано под M=$20B после D-060): крупная, но посильная ставка
    ...overrides,
  };
}

export function padClass(p: LaunchParams, tech: LaunchTech): PadClass {
  return tech === 'refuel' ? p.refuel : p.classic;
}

export function newFleet(p: LaunchParams, classicPads = 5): Fleet {
  void p;
  return { pads: { classic: classicPads, refuel: 0 }, refuelUnlocked: false };
}

/** Max launches a pad type can fly in one window. */
export function maxLaunches(fleet: Fleet, p: LaunchParams, tech: LaunchTech): number {
  return fleet.pads[tech] * p.launchesPerPadPerWindow;
}

/** Total mass (kg) shippable this window across both pad classes. */
export function throughputMass(fleet: Fleet, p: LaunchParams): number {
  return TECHS.reduce((sum, t) => sum + maxLaunches(fleet, p, t) * padClass(p, t).payload, 0);
}

/** Per-window maintenance on every built pad of every class (idle penalty, D-038). */
export function padMaintTotal(fleet: Fleet, p: LaunchParams): number {
  return TECHS.reduce((sum, t) => sum + fleet.pads[t] * padClass(p, t).padMaintFrac * padClass(p, t).padCapex, 0);
}

export function padBuildCost(p: LaunchParams, tech: LaunchTech, n: number): number {
  return Math.max(0, n) * padClass(p, tech).padCapex;
}

export interface ShipPlan {
  launches: Record<LaunchTech, number>; // launches flown per class
  deliveredMass: number; // kg actually delivered (≤ requested, capped by throughput)
  flightCost: number; // Σ launches × per-launch cost
  capped: boolean; // requested mass exceeded total throughput
}

/** Allocate a mass to launches, cheapest-$/kg class first (refuel before classic). */
export function shipPlan(fleet: Fleet, p: LaunchParams, massKg: number): ShipPlan {
  const order = [...TECHS].sort(
    (a, b) => padClass(p, a).launchCost / padClass(p, a).payload - padClass(p, b).launchCost / padClass(p, b).payload,
  );
  const launches: Record<LaunchTech, number> = { classic: 0, refuel: 0 };
  let remaining = Math.max(0, massKg);
  let flightCost = 0;
  let capacityUsed = 0;
  for (const t of order) {
    const cap = maxLaunches(fleet, p, t);
    const need = Math.ceil(remaining / padClass(p, t).payload);
    const n = Math.max(0, Math.min(cap, need));
    launches[t] = n;
    flightCost += n * padClass(p, t).launchCost;
    const m = n * padClass(p, t).payload;
    capacityUsed += m;
    remaining = Math.max(0, remaining - m);
  }
  return {
    launches,
    deliveredMass: Math.min(massKg, capacityUsed),
    flightCost,
    capped: remaining > 0,
  };
}

/** Roll on-pad explosions for the launches flown; returns pads lost per class (≤ pads available). */
export function rollExplosions(
  fleet: Fleet,
  p: LaunchParams,
  plan: ShipPlan,
  rng: Rng,
): Record<LaunchTech, number> {
  const lost: Record<LaunchTech, number> = { classic: 0, refuel: 0 };
  for (const t of TECHS) {
    const prob = padClass(p, t).explodeProb;
    for (let i = 0; i < plan.launches[t]; i++) {
      if (rng.random() < prob && lost[t] < fleet.pads[t]) lost[t] += 1;
    }
  }
  return lost;
}
