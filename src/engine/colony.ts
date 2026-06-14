// Colony v2 model (colony-sim.md) — integrates resources (V1) + logistics (V2) into a window:
// Earth order → charge money (budget M, inflation D-031) → ship within launch throughput → goods
// land NEXT window (Tsiolkovsky lag) → consume life-support → resolve stocks → mortality / runway.
// V3: no local production yet (everything imported) — structures add production in V4/V5.

import {
  applyFlows,
  runwayFromStocks,
  emptyStocks,
  RESOURCES,
  type Stocks,
  type ResourceKind,
} from './resources';
import {
  defaultLaunchParams,
  launchCost,
  throughputMass,
  padBuildCost,
  type Fleet,
  type LaunchParams,
} from './logistics';

/** Per-resource catalog: earth price ($/kg) + per-capita life-support consumption (kg/window). */
export interface ResourceSpec {
  earthPerKg: number;
  perCapita: number; // life-support draw per colonist per window (0 = not life-support)
  recycle: number; // η recovered fraction (ECLSS)
}

export type ResourceCatalog = Record<ResourceKind, ResourceSpec>;

export interface ColonyParams {
  M: number; // per-window subsidy (D-021)
  inflation: number; // D-031 erosion
  pop0: number;
  colonistCost: number; // money per colonist
  colonistMass: number; // kg per colonist (life-support kit + body)
  mortFactor: number; // shortfall → death sensitivity
  catalog: ResourceCatalog;
  launch: LaunchParams;
  startPads: number;
  startStockWindows: number; // initial life-support buffer, in windows of consumption
  maxWindows: number;
}

export interface Transit {
  stocks: Stocks;
  colonists: number;
}

export interface ColonyState {
  window: number;
  pop: number;
  stocks: Stocks;
  inTransit: Transit;
  fleet: Fleet;
  collapsed: boolean;
  p: ColonyParams;
}

/** Earth order for one window (the slider manifest). */
export interface EarthOrder {
  resources: Partial<Stocks>; // kg to order per resource
  padsToBuild: number;
  colonists: number;
}

// ---- params -------------------------------------------------------------

export function defaultCatalog(): ResourceCatalog {
  const z: ResourceSpec = { earthPerKg: 5, perCapita: 0, recycle: 0 };
  const cat = Object.fromEntries(RESOURCES.map((r) => [r, { ...z }])) as ResourceCatalog;
  // life-support (TOY numbers — playable/tunable; real calibration in a later balance pass.
  // NB at honest scale, importing food for 1000+ is mass-impossible → farms mandatory, V4).
  cat.food = { earthPerKg: 5, perCapita: 50, recycle: 0 };
  cat.water = { earthPerKg: 1, perCapita: 100, recycle: 0.9 };
  cat.o2 = { earthPerKg: 2, perCapita: 20, recycle: 0.95 };
  cat.n2 = { earthPerKg: 1, perCapita: 5, recycle: 0.0 };
  // materials (consumed by construction in V4+)
  cat.steel = { earthPerKg: 2, perCapita: 0, recycle: 0 };
  cat.metals = { earthPerKg: 8, perCapita: 0, recycle: 0 };
  cat.polymers = { earthPerKg: 40, perCapita: 0, recycle: 0 };
  cat.glass = { earthPerKg: 3, perCapita: 0, recycle: 0 };
  cat.spares = { earthPerKg: 50, perCapita: 0, recycle: 0 };
  return cat;
}

export function defaultColonyParams(overrides: Partial<ColonyParams> = {}): ColonyParams {
  return {
    M: 1.0e12,
    inflation: 0.03,
    pop0: 1000,
    colonistCost: 3.0e8,
    colonistMass: 2000,
    mortFactor: 0.8,
    catalog: defaultCatalog(),
    launch: defaultLaunchParams(),
    startPads: 5,
    startStockWindows: 1.0,
    maxWindows: 40,
    ...overrides,
  };
}

// ---- consumption / state ------------------------------------------------

/** Life-support consumption this window (kg per resource) for the current population. */
export function consumption(s: ColonyState): Partial<Stocks> {
  const c: Partial<Stocks> = {};
  for (const r of RESOURCES) {
    const per = s.p.catalog[r].perCapita;
    if (per > 0) c[r] = per * s.pop;
  }
  return c;
}

function recycleMap(p: ColonyParams): Partial<Stocks> {
  const m: Partial<Stocks> = {};
  for (const r of RESOURCES) if (p.catalog[r].recycle > 0) m[r] = p.catalog[r].recycle;
  return m;
}

export function newColony(p: ColonyParams): ColonyState {
  const stocks = emptyStocks(0);
  // seed a startStockWindows buffer of life-support for pop0
  for (const r of RESOURCES) {
    const per = p.catalog[r].perCapita;
    if (per > 0) stocks[r] = per * p.pop0 * p.startStockWindows;
  }
  return {
    window: 0,
    pop: p.pop0,
    stocks,
    inTransit: { stocks: emptyStocks(0), colonists: 0 },
    fleet: { pads: p.startPads, tech: 'classic' },
    collapsed: false,
    p,
  };
}

// ---- order preview (for the UI manifest) --------------------------------

export interface OrderPreview {
  goodsCost: number;
  colonistCost: number;
  padCapex: number;
  launchTotal: number;
  total: number;
  mass: number; // kg to ship (goods + colonists)
  throughput: number; // max shippable with fleet (incl. pads being built)
  capped: boolean; // mass exceeds throughput
  overBudget: boolean;
  budget: number;
  effPerKg: number;
}

export function priceMult(s: ColonyState): number {
  return Math.pow(1 + s.p.inflation, s.window);
}

export function previewOrder(s: ColonyState, order: EarthOrder): OrderPreview {
  const p = s.p;
  const mult = priceMult(s);
  let goodsMass = 0;
  let goodsCost = 0;
  for (const r of RESOURCES) {
    const qty = Math.max(0, order.resources[r] ?? 0);
    goodsMass += qty;
    goodsCost += qty * p.catalog[r].earthPerKg * mult;
  }
  const colonists = Math.max(0, Math.floor(order.colonists));
  const colonistMass = colonists * p.colonistMass;
  const colonistCost = colonists * p.colonistCost * mult;
  const mass = goodsMass + colonistMass;

  const padsToBuild = Math.max(0, Math.floor(order.padsToBuild));
  const padCapex = padBuildCost(padsToBuild, p.launch) * mult;
  const futureFleet: Fleet = { pads: s.fleet.pads + padsToBuild, tech: s.fleet.tech };
  const throughput = throughputMass(futureFleet, p.launch);
  const lc = launchCost(futureFleet, p.launch, mass);
  const launchTotal = lc.total * mult;

  const total = goodsCost + colonistCost + padCapex + launchTotal;
  const budget = p.M;
  return {
    goodsCost,
    colonistCost,
    padCapex,
    launchTotal,
    total,
    mass,
    throughput,
    capped: mass > throughput,
    overBudget: total > budget,
    budget,
    effPerKg: mass > 0 ? (launchTotal + padCapex) / mass : 0,
  };
}

// ---- the window ---------------------------------------------------------

export interface ColonyReport {
  window: number;
  pop: number;
  runway: number;
  stocks: Stocks;
  landed: Transit; // what arrived this window
  deficit: Partial<Stocks>;
  mortality: number;
  spent: number;
  capped: boolean;
  collapsed: boolean;
}

/**
 * Commit one synodic window: charge & ship the order (capped at throughput/budget), land the
 * PREVIOUS window's convoy, consume life-support, resolve stocks, apply mortality, advance pop.
 */
export function commitWindow(s: ColonyState, order: EarthOrder): ColonyReport {
  const p = s.p;
  s.window += 1;
  const pv = previewOrder(s, order);

  // affordability: if over budget or capped, the order is trimmed to what's feasible is the UI's
  // job; the engine ships only within throughput and only if affordable (else nothing ships).
  const feasible = !pv.overBudget && !pv.capped;
  const spent = feasible ? pv.total : 0;

  // build pads now (capacity for future windows)
  if (feasible && order.padsToBuild > 0) s.fleet.pads += Math.floor(order.padsToBuild);

  // land the PREVIOUS convoy (lag), then queue this order as the new convoy
  const landed = s.inTransit;
  if (feasible) {
    const shipped = emptyStocks(0);
    for (const r of RESOURCES) shipped[r] = Math.max(0, order.resources[r] ?? 0);
    s.inTransit = { stocks: shipped, colonists: Math.max(0, Math.floor(order.colonists)) };
  } else {
    s.inTransit = { stocks: emptyStocks(0), colonists: 0 };
  }

  // colonists arrive
  s.pop += landed.colonists;

  // consume life-support, fold in arrivals
  const cons = consumption(s);
  const { stocks, deficit } = applyFlows(s.stocks, {
    arrivals: landed.stocks,
    consumption: cons,
    recycleEff: recycleMap(p),
  });
  s.stocks = stocks;

  // mortality from the worst life-support shortfall (Liebig)
  let worstRatio = 0;
  for (const r of ['food', 'water', 'o2'] as ResourceKind[]) {
    const need = cons[r] ?? 0;
    if (need > 0 && deficit[r]) worstRatio = Math.max(worstRatio, deficit[r]! / need);
  }
  const mortality = s.pop * Math.min(0.9, p.mortFactor * worstRatio);
  s.pop -= mortality;
  if (s.pop < p.pop0 * 0.2) s.collapsed = true;

  return {
    window: s.window,
    pop: Math.round(s.pop),
    runway: runwayFromStocks(s.stocks, cons, recycleMap(p)),
    stocks: { ...s.stocks },
    landed,
    deficit,
    mortality: Math.round(mortality),
    spent,
    capped: pv.capped,
    collapsed: s.collapsed,
  };
}
