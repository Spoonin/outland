// Pure simulation functions (SDD §6–7). Mirrors prototype/economy.py.
// Built incrementally across Phase 1 parts A–F.

import type {
  EndReason,
  GameState,
  Node,
  NodeStatus,
  Params,
  StepReport,
  WindowDecision,
} from './types';
import { GRAPH, NODES, CONSUMERS } from './graph';
import { makeRng } from './rng';
import { greedyAllocate } from './policy';

/** Minimum effective scale of a node: Infinity for black, else mes0·k^(tier-1) (SDD §6). */
export function mes(p: Params, node: Node): number {
  return node.black ? Infinity : p.mes0 * Math.pow(p.k, node.tier - 1);
}

/** Maintenance tail: a localized node still imports this fraction, rising with age to tailMax. */
export function tailFrac(p: Params, age: number): number {
  return p.tailMax * (1.0 - Math.exp(-age / p.tailRamp));
}

/**
 * Per-node demand = consumption (cons·pop) + derived (from localized consumers). DAG, memoized.
 * Importing a finished good creates NO derived demand for its inputs (D-029, SDD §6).
 */
export function needs(s: GameState): Record<string, number> {
  const memo: Record<string, number> = {};
  const need = (name: string): number => {
    const cached = memo[name];
    if (cached !== undefined) return cached;
    const n = NODES[name]!;
    let total = n.cons * s.pop;
    for (const [consName, qty] of CONSUMERS[name]!) {
      if (s.localized[consName]) total += qty * need(consName);
    }
    memo[name] = total;
    return total;
  };
  for (const n of GRAPH) need(n.name);
  return memo;
}

/**
 * Imported portion of every node (D-038, SDD §6). Returns:
 *  - fImp: intrinsic earthCost + marginal fuel shipping, inflation/spike-adjusted;
 *  - shipMass: total imported kg/window (drives launch-capacity need).
 * Launch-capacity maintenance is added separately in step() (it's sunk, not per-import).
 */
export function importBreakdown(
  s: GameState,
  nd: Record<string, number>,
  priceMult = 1.0,
): { fImp: number; shipMass: number } {
  const p = s.p;
  let f = 0.0;
  let w = 0.0;
  for (const n of GRAPH) {
    const importedUnits = nd[n.name]! * (s.localized[n.name] ? tailFrac(p, s.age[n.name]!) : 1.0);
    f += importedUnits * (n.earthCost + n.mass * p.fuelPerKg) * priceMult;
    w += importedUnits * n.mass;
  }
  if (s.fusion === 'online') {
    f = f * (1.0 - p.fusionDiscount) + p.fusionMaintM * p.M * (s.pop / p.pop0);
  }
  return { fImp: f, shipMass: w };
}

/** Per-window amortization on built capacity — paid even when idle (no Earth reuse). D-038. */
export function launchMaint(s: GameState): number {
  return s.p.launchMaintFrac * s.p.launchCapexPerKg * s.launchK;
}

/** Autonomy by mass (D-025): fraction of demand-mass covered locally. Seductive headline metric. */
export function autonomyByMass(s: GameState, nd: Record<string, number>): number {
  const p = s.p;
  let tot = 0.0;
  let loc = 0.0;
  for (const n of GRAPH) {
    tot += nd[n.name]! * n.mass;
    if (s.localized[n.name]) loc += nd[n.name]! * (1.0 - tailFrac(p, s.age[n.name]!)) * n.mass;
  }
  return tot ? loc / tot : 0.0;
}

/**
 * Self-sufficiency (D-025): ~windows survivable if imports cut now. Liebig's law — gated by the
 * WORST-covered critical node (crit>=0.5), not the average. Pharma/chips are critical AND black →
 * worst coverage ≈ 0 → runway pinned near the stockpile floor however high autonomy climbs.
 */
export function survivalRunway(s: GameState, nd: Record<string, number>): number {
  const p = s.p;
  let worst = 1.0;
  for (const n of GRAPH) {
    if (n.crit < 0.5) continue;
    const d = nd[n.name]!;
    if (d <= 0) continue;
    const local = s.localized[n.name] ? d * (1.0 - tailFrac(p, s.age[n.name]!)) : 0.0;
    worst = Math.min(worst, local / d);
  }
  return Math.round((0.5 + worst * 3.0) * 10) / 10; // 0.5-window stockpile + best-case scaling
}

/** Cumulative Earth-inflation multiplier at the current window (D-031). */
export function priceMultNow(s: GameState): number {
  return Math.pow(1.0 + s.p.inflation, s.window);
}

/** Cumulative erosion of the subsidy's real value, 0..1 (D-031 — the trillion shrinks). */
export function subsidyErosion(s: GameState): number {
  return 1.0 - 1.0 / priceMultNow(s);
}

/**
 * Classify the game ending (§7.4, D-017): collapse (pop crash) / cancellation (Earth pulls
 * funding as inflation erodes the subsidy past cancelErosion) / stall (asymptotic calm —
 * survived to the horizon, frozen below 100% autonomy, perpetual import). 'none' = ongoing.
 */
export function endReason(s: GameState): EndReason {
  if (s.collapsed) return 'collapse';
  if (s.window >= s.p.maxWindows) {
    return subsidyErosion(s) >= s.p.cancelErosion ? 'cancellation' : 'stall';
  }
  return 'none';
}

export interface NodeEconomics {
  demandUnits: number; // total per-window demand (consumption + derived)
  unitEarth: number; // intrinsic $/unit (inflation-adjusted)
  unitShipping: number; // fuel shipping $/unit (mass·fuelPerKg, inflation-adjusted)
  unitPrice: number; // unitEarth + unitShipping
  importedUnits: number; // units actually imported (full, or maintenance tail if localized)
  shipMass: number; // imported kg/window
  fContribution: number; // money this node adds to the import floor F
}

/** Per-node import economics for the object tree / import panel (D-038 price dichotomy). */
export function nodeEconomics(
  s: GameState,
  nd: Record<string, number>,
  node: Node,
  priceMult = 1.0,
): NodeEconomics {
  const p = s.p;
  const importedUnits = nd[node.name]! * (s.localized[node.name] ? tailFrac(p, s.age[node.name]!) : 1.0);
  const unitEarth = node.earthCost * priceMult;
  const unitShipping = node.mass * p.fuelPerKg * priceMult;
  const unitPrice = unitEarth + unitShipping;
  return {
    demandUnits: nd[node.name]!,
    unitEarth,
    unitShipping,
    unitPrice,
    importedUnits,
    shipMass: importedUnits * node.mass,
    fContribution: importedUnits * unitPrice,
  };
}

/** Visible status of a node given current demand (D-014, SDD): drives 🟢🟡🔴⚫ in the UI. */
export function nodeStatus(s: GameState, nd: Record<string, number>, node: Node): NodeStatus {
  if (node.black) return 'black';
  if (s.localized[node.name]) return 'local';
  if (nd[node.name]! >= mes(s.p, node)) return 'buildable';
  return 'import';
}

export interface EligibleNode {
  name: string;
  tier: number;
  demand: number;
  cost: number; // localization capex
}

export interface PlanView {
  M: number;
  projectedF: number; // import floor + capacity maintenance at next-window prices
  projectedFree: number; // M − F − projected capacity capex
  shipMass: number;
  colonistCost: number;
  eligible: EligibleNode[]; // buildable now (demand ≥ MES, not black, not localized)
}

/**
 * Deterministic planning preview for the window manifest (mechanics §7.2 "plan under uncertainty").
 * Uses next-window inflation but no RNG — events/lag realize only on commit (step()).
 */
export function planView(s: GameState): PlanView {
  const p = s.p;
  const nd = needs(s);
  const priceMult = Math.pow(1.0 + p.inflation, s.window + 1);
  const { fImp, shipMass } = importBreakdown(s, nd, priceMult);
  const capex = shipMass > s.launchK ? (shipMass - s.launchK) * p.launchCapexPerKg : 0.0;
  const maint = p.launchMaintFrac * p.launchCapexPerKg * Math.max(s.launchK, shipMass);
  const projectedF = fImp + maint;
  const eligible: EligibleNode[] = GRAPH.filter(
    (n) => !n.black && !s.localized[n.name] && nd[n.name]! >= mes(p, n),
  ).map((n) => ({ name: n.name, tier: n.tier, demand: nd[n.name]!, cost: localizationCost(p, n) }));
  return {
    M: p.M,
    projectedF,
    projectedFree: p.M - projectedF - capex,
    shipMass,
    colonistCost: p.colonistCost,
    eligible,
  };
}

/** Fresh game state: pop0, nothing localized, seeded RNG (SDD §4). */
export function newState(p: Params): GameState {
  const localized: Record<string, boolean> = {};
  const age: Record<string, number> = {};
  for (const n of GRAPH) {
    localized[n.name] = false;
    age[n.name] = 0;
  }
  return {
    p,
    window: 0,
    pop: p.pop0,
    localized,
    age,
    collapsed: false,
    plateauedAt: -1,
    lastAutonomy: 0,
    rng: makeRng(p.seed),
    fusion: 'none',
    fusionFund: 0,
    launchK: 0,
  };
}

/** Localization capex for a node: capitalFactor · MES (Infinity for black). */
export function localizationCost(p: Params, node: Node): number {
  return p.capitalFactor * mes(p, node);
}

/** Player-directed localization: try each requested node in order, if eligible & affordable. */
function directedAllocate(
  s: GameState,
  capital: number,
  nd: Record<string, number>,
  localize: string[],
): { localizedThis: string[]; capitalLeft: number } {
  const p = s.p;
  const localizedThis: string[] = [];
  for (const name of localize) {
    const n = NODES[name];
    if (!n || s.localized[name] || n.black || nd[name]! < mes(p, n)) continue;
    const cost = localizationCost(p, n);
    if (cost > capital) continue;
    s.localized[name] = true;
    s.age[name] = 0;
    capital -= cost;
    localizedThis.push(name);
  }
  return { localizedThis, capitalLeft: capital };
}

/**
 * Advance one synodic window (SDD §7). Mutates state; returns a report.
 * `decision` = player allocation; omit → greedy auto-policy (golden tests, AI baseline).
 */
export function step(s: GameState, decision?: WindowDecision): StepReport {
  const p = s.p;
  const rng = s.rng;
  s.window += 1;
  const events: string[] = [];

  // 1. Earth inflation: real erosion of the subsidy (D-031)
  const infl = Math.pow(1.0 + p.inflation, s.window);
  let priceMult = infl;
  let mEff = p.M;

  // 2. Earth event: cut subsidy or spike prices (D-031)
  if (p.enableEvents && rng.random() < p.earthEventProb) {
    if (rng.random() < 0.5) {
      mEff *= p.earthCut;
      events.push('земля: урезание субсидии');
    } else {
      priceMult *= p.earthSpike;
      events.push('земля: скачок цен');
    }
  }

  // 3. breakdown: revert a localized node (odds rise with fragility) (§12.4)
  let nd = needs(s);
  let fPre = importBreakdown(s, nd, priceMult).fImp + launchMaint(s);
  if (p.enableEvents && fPre > 0) {
    const bd = p.breakdownBase + p.breakdownMargin * Math.min(2.0, fPre / p.M);
    const loc = GRAPH.filter((n) => s.localized[n.name]).map((n) => n.name);
    if (loc.length && rng.random() < bd) {
      const t = rng.choice(loc);
      s.localized[t] = false;
      s.age[t] = 0;
      events.push(`поломка: ${t}`);
    }
  }

  // 4. import + launch capacity (D-038)
  nd = needs(s);
  const { fImp, shipMass } = importBreakdown(s, nd, priceMult);
  let launchCapexNow = 0.0;
  if (shipMass > s.launchK) {
    launchCapexNow = (shipMass - s.launchK) * p.launchCapexPerKg;
    s.launchK = shipMass;
  }
  const f = fImp + launchMaint(s); // recurring outflow (imports + idle-capacity amortization)
  let free = mEff - f - launchCapexNow; // capex competes in the single ledger

  // 5. megaproject fusion: save from surplus once autonomy plateaus (D-033)
  if (p.enableFusion && s.fusion === 'none' && !s.collapsed && s.plateauedAt > 0) {
    s.fusion = 'saving';
    events.push('⚡решение строить термояд');
  }
  if (s.fusion === 'saving' && free > 0) {
    const contrib = free * p.fusionSaveFrac;
    free -= contrib;
    s.fusionFund += contrib;
    if (s.fusionFund >= p.fusionCostM * p.M) {
      s.fusion = 'online';
      events.push('⚡термояд онлайн');
    }
  }

  let localizedThis: string[] = [];
  const reverted: string[] = [];
  let mortality = 0.0;

  // 6. localize / population, or mortality
  if (free >= 0) {
    if (decision) {
      // player-directed allocation (Phase 3)
      const alloc = directedAllocate(s, free, nd, decision.localize);
      localizedThis = alloc.localizedThis;
      const affordable = Math.min(
        Math.max(0, Math.floor(decision.colonists)),
        Math.floor(alloc.capitalLeft / p.colonistCost),
      );
      s.pop += affordable;
    } else {
      // greedy auto-policy
      const alloc = greedyAllocate(s, free, priceMult, nd);
      localizedThis = alloc.localizedThis;
      // population lever (D-030): import colonists from leftover surplus
      const spare = alloc.capitalLeft - p.colonistReserve * p.M;
      if (spare > p.colonistCost) {
        s.pop += (spare * p.colonistFrac) / p.colonistCost;
      }
    }
    // births only if medical infra localized
    if (s.localized['medical_infra']) s.pop *= 1.0 + p.birthRate;
  } else {
    const unmet = -free;
    const rate = f > 0 ? Math.min(0.9, (p.mortFactor * unmet) / f) : 0.0;
    mortality = s.pop * rate;
    s.pop -= mortality;
  }

  // 7. population below a localized node's MES → it goes dark (spiral, §5.6/§6.5)
  for (const n of GRAPH) {
    if (s.localized[n.name] && s.pop < mes(p, n) * p.revertHysteresis) {
      s.localized[n.name] = false;
      s.age[n.name] = 0;
      reverted.push(n.name);
    }
  }

  // 8. aging
  for (const n of GRAPH) if (s.localized[n.name]) s.age[n.name]! += 1;

  // 9. metrics
  nd = needs(s);
  const autonomy = autonomyByMass(s, nd);
  const runway = survivalRunway(s, nd);
  if (s.plateauedAt < 0 && s.window > 3 && autonomy <= s.lastAutonomy + 1e-9 && !localizedThis.length) {
    s.plateauedAt = s.window;
  }
  s.lastAutonomy = autonomy;
  if (s.pop < p.pop0 * 0.2) s.collapsed = true;

  const effPerKg = shipMass > 0 ? (fImp + launchMaint(s)) / shipMass : 0.0;
  return {
    window: s.window,
    year: Math.round(s.window * 2.17 * 10) / 10,
    pop: Math.round(s.pop),
    autonomy,
    runway,
    F: f,
    Meff: mEff,
    free,
    localizedThis,
    reverted,
    mortality: Math.round(mortality),
    events,
    fusion: s.fusion,
    collapsed: s.collapsed,
    launchK: Math.round(s.launchK),
    launchCapex: Math.round(launchCapexNow),
    effPerKg: Math.round(effPerKg),
  };
}
