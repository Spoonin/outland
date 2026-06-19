// Authored dependency graph (~28 nodes), mirrors documents/graph.md and economy.py GRAPH.
// Bulk = heavy/cheap/shallow (shipping-dominated); black = light/dear/deep (intrinsic-dominated).

import type { Node } from './types';

const node = (
  name: string,
  tier: number,
  mass: number,
  earthCost: number,
  cons: number,
  inputs: ReadonlyArray<readonly [string, number]> = [],
  opts: { black?: boolean; crit?: number; mesAnchor?: number } = {},
): Node => ({
  name, tier, mass, earthCost, cons, inputs,
  black: opts.black ?? false,
  mesAnchor: opts.mesAnchor,
  crit: opts.crit ?? 0,
});

export const GRAPH: readonly Node[] = [
  // T1 — ISRU bulk
  node('water', 1, 100, 1, 2.0, [], { crit: 1.0 }),
  node('oxygen', 1, 20, 1, 1.0, [['water', 0.3]], { crit: 1.0 }),
  node('regolith', 1, 300, 0.5, 0.0, [], { crit: 0.1 }),
  node('co2', 1, 5, 0.2, 0.0, [], { crit: 0.2 }),
  node('nitrogen', 1, 8, 0.5, 0.0, [], { crit: 0.3 }),
  // T2 — primary processing
  node('hydrogen', 2, 2, 5, 0.0, [['water', 1.0]], { crit: 0.3 }),
  node('steel', 2, 200, 2, 0.3, [['regolith', 0.6]], { crit: 0.4 }),
  node('structural_metal', 2, 60, 8, 0.0, [['regolith', 0.5]], { crit: 0.3 }),
  node('silica_glass', 2, 80, 3, 0.1, [['regolith', 0.4]], { crit: 0.2 }),
  // T3 — chemistry (catalyst is a root input → poisoner)
  node('methane_fuel', 3, 30, 30, 0.2, [['hydrogen', 0.5], ['co2', 0.3], ['catalyst', 0.03]], { crit: 0.3 }),
  node('ammonia', 3, 8, 15, 0.0, [['hydrogen', 0.3], ['nitrogen', 0.2], ['catalyst', 0.02]], { crit: 0.4 }),
  node('ceramics', 3, 40, 10, 0.1, [['silica_glass', 0.4], ['regolith', 0.2]], { crit: 0.2 }),
  node('base_polymer', 3, 15, 40, 0.2, [['methane_fuel', 0.2], ['catalyst', 0.05]], { crit: 0.3 }),
  // T4 — agro + advanced materials
  node('fertilizer', 4, 10, 20, 0.0, [['ammonia', 0.5], ['catalyst', 0.05]], { crit: 0.6 }),
  node('food', 4, 50, 5, 1.5, [['water', 0.5], ['fertilizer', 0.2]], { crit: 1.0 }),
  node('epoxy', 4, 12, 120, 0.3, [['base_polymer', 0.4], ['catalyst', 0.05]], { crit: 0.3 }),
  node('battery', 4, 20, 200, 0.2, [['structural_metal', 0.3], ['electronics', 0.05], ['ceramics', 0.1]], { crit: 0.5 }),
  node('electric_motor', 4, 35, 150, 0.1, [['special_alloy', 0.1], ['electronics', 0.1], ['structural_metal', 0.3]], { crit: 0.5 }),
  // T5 — machinery + infra (forever pull black inputs)
  node('machinery', 5, 40, 80, 0.3, [['steel', 0.5], ['electric_motor', 0.1], ['special_alloy', 0.1]], { crit: 0.6 }),
  node('solar_panel', 5, 25, 300, 0.2, [['silica_glass', 0.3], ['electronics', 0.1], ['special_alloy', 0.05]], { crit: 0.6 }),
  node('medical_infra', 5, 30, 500, 0.0, [['electronics', 0.05], ['machinery', 0.1], ['pharma', 0.05]], { crit: 0.7 }), // → births
  node('precision_mech', 5, 5, 400, 0.0, [['special_alloy', 0.05], ['precision_metrology', 0.02]], { crit: 0.4 }),
  // Deep nodes: light, DEAR intrinsic, finite-but-huge MES from physical reality (references §4,
  // D-045). `black` flags them as "no current build path" at colony scale (demand ≪ MES), but the
  // MES is a real number — they ARE localizable at a sufficiently large colony. Nothing forbidden.
  //   pharma:        API plant breakeven ~200 t/yr ÷ ~0.3 kg per-capita ≈ 6.7e5
  //   electronics:   chip fab serves world market vs. colony grams ≈ 1e6
  //   catalyst:      PGM-scarce (dispersed on Mars) but importable feedstock (D-032) ≈ 3e5
  //   special_alloy: specialty metallurgy line ≈ 2e5
  //   precision_metrology: calibration/metrology chain ≈ 2e5
  node('special_alloy', 6, 12, 1.5e8, 0.0, [], { black: true, crit: 0.4, mesAnchor: 2.0e5 }),
  node('catalyst', 6, 0.5, 8.0e7, 0.0, [], { black: true, crit: 0.9, mesAnchor: 3.0e5 }),
  node('precision_metrology', 6, 1, 1.2e8, 0.0, [], { black: true, crit: 0.5, mesAnchor: 2.0e5 }),
  node('electronics', 7, 0.2, 2.5e8, 0.05, [], { black: true, crit: 0.9, mesAnchor: 1.0e6 }),
  node('pharma', 7, 0.3, 2.0e8, 0.05, [], { black: true, crit: 1.0, mesAnchor: 6.7e5 }),
];

/** Index by name. */
export const NODES: Readonly<Record<string, Node>> = Object.fromEntries(
  GRAPH.map((n) => [n.name, n]),
);

/** Reverse edges: who consumes node `n` as an input, and how much per unit. */
export const CONSUMERS: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = (() => {
  const m: Record<string, Array<readonly [string, number]>> = {};
  for (const n of GRAPH) m[n.name] = [];
  for (const n of GRAPH) {
    for (const [inp, qty] of n.inputs) m[inp]!.push([n.name, qty]);
  }
  return m;
})();
