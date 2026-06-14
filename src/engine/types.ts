// Engine data model (SDD §4). Pure types + Params defaults. Mirrors prototype/economy.py.

/** Deterministic RNG (rng.ts). Seedable; not Python-compatible — see SDD §9. */
export interface Rng {
  random(): number; // [0, 1)
  choice<T>(arr: readonly T[]): T;
}

/** A node in the authored dependency graph (graph.ts / graph.md, D-026). */
export interface Node {
  readonly name: string;
  readonly tier: number; // depth → MES = mes0 * k^(tier-1)
  readonly mass: number; // kg/unit — autonomy-by-mass + launch-capacity load
  readonly earthCost: number; // intrinsic $/unit (no shipping)
  readonly cons: number; // per-capita consumption (0 = pure intermediate)
  readonly inputs: ReadonlyArray<readonly [string, number]>; // BOM: [input name, qty/unit]
  readonly black: boolean; // MES = Infinity, never localizes
  readonly crit: number; // criticality weight (survival runway); >=0.5 counts in Liebig
}

/** Tunable economy parameters. Defaults via defaultParams() (SDD §6). */
export interface Params {
  M: number;
  // D-038: shipping is launch CAPITAL, not a price `c`.
  fuelPerKg: number;
  launchCapexPerKg: number;
  launchMaintFrac: number;
  mes0: number;
  k: number;
  capitalFactor: number;
  tailMax: number;
  tailRamp: number;
  pop0: number;
  mortFactor: number;
  revertHysteresis: number;
  // population lever (D-030)
  colonistCost: number;
  colonistFrac: number;
  colonistReserve: number;
  birthRate: number;
  // Earth side (D-031)
  inflation: number;
  earthEventProb: number;
  earthCut: number;
  earthSpike: number;
  // events (§12)
  enableEvents: boolean;
  seed: number;
  breakdownBase: number;
  breakdownMargin: number;
  // megaproject fusion (§11 / D-033)
  enableFusion: boolean;
  fusionCostM: number;
  fusionSaveFrac: number;
  fusionDiscount: number;
  fusionMaintM: number;
  maxWindows: number;
}

/** Calibrated defaults (D-037/D-038); identical to economy.py Params. */
export function defaultParams(overrides: Partial<Params> = {}): Params {
  return {
    M: 1.0e12,
    fuelPerKg: 400.0,
    launchCapexPerKg: 4.0e4,
    launchMaintFrac: 0.08,
    mes0: 300.0,
    k: 2.0,
    capitalFactor: 5.0e7,
    tailMax: 0.18,
    tailRamp: 3.0,
    pop0: 1000.0,
    mortFactor: 0.8,
    revertHysteresis: 0.9,
    colonistCost: 3.0e8,
    colonistFrac: 0.25,
    colonistReserve: 0.15,
    birthRate: 0.06,
    inflation: 0.03,
    earthEventProb: 0.1,
    earthCut: 0.5,
    earthSpike: 1.6,
    enableEvents: true,
    seed: 1,
    breakdownBase: 0.03,
    breakdownMargin: 0.2,
    enableFusion: true,
    fusionCostM: 3.0,
    fusionSaveFrac: 0.6,
    fusionDiscount: 0.3,
    fusionMaintM: 0.1,
    maxWindows: 40,
    ...overrides,
  };
}

export type FusionState = 'none' | 'saving' | 'online';

/** Visible node status (D-014): 🟢 local, 🟡 buildable (demand≥MES), 🔴 import, ⚫ black. */
export type NodeStatus = 'local' | 'buildable' | 'import' | 'black';

/** Full mutable game state. One step() = one synodic window. */
export interface GameState {
  p: Params;
  window: number;
  pop: number;
  localized: Record<string, boolean>;
  age: Record<string, number>;
  collapsed: boolean;
  plateauedAt: number; // -1 until plateau detected
  lastAutonomy: number;
  rng: Rng;
  fusion: FusionState;
  fusionFund: number;
  launchK: number; // built launch capacity (kg/window), sunk + maintained (D-038)
}

/** Player's allocation for a window (Phase 3). Omit → greedy auto-policy stands in. */
export interface WindowDecision {
  localize: string[]; // node names to attempt to localize this window, in priority order
  colonists: number; // colonists to import this window
}

/** Per-window result returned by step() (SDD §7). */
export interface StepReport {
  window: number;
  year: number;
  pop: number;
  autonomy: number;
  runway: number;
  F: number;
  Meff: number;
  free: number;
  localizedThis: string[];
  reverted: string[];
  mortality: number;
  events: string[];
  fusion: FusionState;
  collapsed: boolean;
  launchK: number;
  launchCapex: number;
  effPerKg: number;
}
