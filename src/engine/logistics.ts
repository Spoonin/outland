// Launch logistics (v2, D-043 / colony-sim.md §5). Two pad classes the player builds and maintains:
// CLASSIC multistage (expendable — cheap pad, small landed payload, dear per-kg, riskier) and REFUEL
// (orbital-refuelling reusable, unlocked through STAGED R&D, D-068 — see REFUEL_STAGES below).
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

/** One rung of the refuel R&D ladder (D-068): what a "launch" (a whole tanker campaign) delivers
 * and costs once this stage is bought. Pads themselves (capex/maintenance) don't change — the
 * SHIPS flying off them do, so existing refuel pads upgrade with the stage. */
export interface RefuelStage {
  name: string; // diegetic label for the UI
  cost: number; // R&D price at window-0 prices (inflation multiplies it at purchase time, D-031)
  payload: number;
  launchCost: number;
  explodeProb: number;
}

export interface LaunchParams {
  launchesPerPadPerWindow: number; // 1/day × 5-day window = 5
  classic: PadClass;
  refuelPad: { padCapex: number; padMaintFrac: number }; // the launch complex — stage-independent
  refuelStages: readonly RefuelStage[]; // sequential R&D ladder (D-068); stage N needs stages 1..N−1
  // D-082 (corrects D-080's mistake): decommissioning is a NET COST, matching reality — safely
  // tearing a launch complex down (residual propellant handling, structural teardown, site
  // remediation) costs more than the scrap you recover from it. One fraction of CURRENT capex,
  // charged as a cost — not a refund.
  padScrapCostFrac: number;
}

export interface Fleet {
  pads: Record<LaunchTech, number>;
  refuelStage: number; // 0 = locked; N = highest bought rung of refuelStages (D-068)
}

/** Calibrated to researched delivery economics (references §3, D-067/D-068).
 * CLASSIC = expendable heavy-lift (Falcon-Heavy-class): the old 16.8 t was the TMI throw mass —
 * EDL (entry/descent/landing) keeps only ~2–3 t of it on the surface; $150–160M per launch →
 * ~$52k per LANDED kg. REFUEL = one Starship-class Mars delivery CAMPAIGN (target ship + tanker
 * flights bundled into one abstract "launch"), unlocked in two R&D stages grounded in the real
 * program: SpaceX had spent >$15B through 2025 with the orbital propellant-transfer demo still
 * pending, and 100-t Mars EDL (supersonic retropropulsion) remains undemonstrated — so stage 1
 * (~$15B) buys reuse + the transfer demo at test-era economics, stage 2 (~$12B) buys the serial
 * tanker fleet, depot and Mars-scale EDL. The mature $130–300/kg, 150-t floor is a future V8 rung. */
export function defaultLaunchParams(overrides: Partial<LaunchParams> = {}): LaunchParams {
  return {
    launchesPerPadPerWindow: 5,
    classic: { payload: 3_000, launchCost: 1.55e8, padCapex: 1.5e8, padMaintFrac: 0.1, explodeProb: 0.0025 },
    refuelPad: { padCapex: 5.0e8, padMaintFrac: 0.12 },
    refuelStages: [
      // test-era campaigns: partial fills, conservative margins, vehicles still being lost
      { name: 'Дозаправка: демо-кампании', cost: 1.5e10, payload: 60_000, launchCost: 2.5e8, explodeProb: 0.005 },
      // serial tankers + cryo depot + 100-t Mars EDL proven → the D-067 commercial point
      { name: 'Серийный флот, депо и марсианский EDL', cost: 1.2e10, payload: 100_000, launchCost: 1.0e8, explodeProb: 0.0005 },
    ],
    // D-082: net cost ≈20% of current capex to decommission a pad — equivalent to ~2 windows of
    // maintenance (10-12%/window), so it's a real, worthwhile escape valve for an over-built fleet
    // (cheaper than paying upkeep forever) without being free money the way a straight refund was.
    padScrapCostFrac: 0.2,
    ...overrides,
  };
}

export function newFleet(p: LaunchParams, classicPads = 5): Fleet {
  void p;
  return { pads: { classic: classicPads, refuel: 0 }, refuelStage: 0 };
}

/** The NEXT refuel R&D rung still unbought, or null when the ladder is complete / for stage 0 the
 * first rung. Purchase order is strictly sequential (D-068). */
export function nextRefuelStage(fleet: Fleet, p: LaunchParams): { index: number; stage: RefuelStage } | null {
  const i = fleet.refuelStage;
  return i < p.refuelStages.length ? { index: i + 1, stage: p.refuelStages[i]! } : null;
}

/** Effective pad class for a fleet: classic is static; refuel payload/cost/risk come from the
 * highest bought R&D stage (existing pads fly the new ships — the complex itself is unchanged). */
export function padClassFor(fleet: Fleet, p: LaunchParams, tech: LaunchTech): PadClass {
  if (tech === 'classic') return p.classic;
  const stage = p.refuelStages[Math.max(0, Math.min(fleet.refuelStage, p.refuelStages.length) - 1)]!;
  return {
    payload: stage.payload,
    launchCost: stage.launchCost,
    explodeProb: stage.explodeProb,
    padCapex: p.refuelPad.padCapex,
    padMaintFrac: p.refuelPad.padMaintFrac,
  };
}

/** Max launches a pad type can fly in one window. */
export function maxLaunches(fleet: Fleet, p: LaunchParams, tech: LaunchTech): number {
  return fleet.pads[tech] * p.launchesPerPadPerWindow;
}

/** Total mass (kg) shippable this window across both pad classes. */
export function throughputMass(fleet: Fleet, p: LaunchParams): number {
  return TECHS.reduce((sum, t) => sum + maxLaunches(fleet, p, t) * padClassFor(fleet, p, t).payload, 0);
}

/** Per-window maintenance on every built pad of every class (idle penalty, D-038). */
export function padMaintTotal(fleet: Fleet, p: LaunchParams): number {
  return TECHS.reduce((sum, t) => {
    const c = padClassFor(fleet, p, t);
    return sum + fleet.pads[t] * c.padMaintFrac * c.padCapex;
  }, 0);
}

export function padBuildCost(p: LaunchParams, tech: LaunchTech, n: number): number {
  const capex = tech === 'refuel' ? p.refuelPad.padCapex : p.classic.padCapex;
  return Math.max(0, n) * capex;
}

/** D-082: cost to decommission `n` pads of a class — a NET expense (fraction of current capex),
 * matching real decommissioning economics (safe teardown costs more than the scrap you recover).
 * Still cheaper than paying idle maintenance forever, but never a source of profit. */
export function padScrapCost(p: LaunchParams, tech: LaunchTech, n: number): number {
  return padBuildCost(p, tech, n) * p.padScrapCostFrac;
}

export interface ShipPlan {
  launches: Record<LaunchTech, number>; // launches flown per class
  deliveredMass: number; // kg actually delivered (≤ requested, capped by throughput)
  flightCost: number; // Σ launches × per-launch cost
  capped: boolean; // requested mass exceeded total throughput
}

/** Allocate a mass to launches, cheapest-$/kg class first (refuel before classic). */
export function shipPlan(fleet: Fleet, p: LaunchParams, massKg: number): ShipPlan {
  const perKg = (t: LaunchTech) => {
    const c = padClassFor(fleet, p, t);
    return c.launchCost / c.payload;
  };
  const order = [...TECHS].sort((a, b) => perKg(a) - perKg(b));
  const launches: Record<LaunchTech, number> = { classic: 0, refuel: 0 };
  let remaining = Math.max(0, massKg);
  let flightCost = 0;
  let capacityUsed = 0;
  for (const t of order) {
    const c = padClassFor(fleet, p, t);
    const cap = maxLaunches(fleet, p, t);
    const need = Math.ceil(remaining / c.payload);
    const n = Math.max(0, Math.min(cap, need));
    launches[t] = n;
    flightCost += n * c.launchCost;
    const m = n * c.payload;
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
    const prob = padClassFor(fleet, p, t).explodeProb;
    for (let i = 0; i < plan.launches[t]; i++) {
      if (rng.random() < prob && lost[t] < fleet.pads[t]) lost[t] += 1;
    }
  }
  return lost;
}
