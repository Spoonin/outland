// Colony v2 model (colony-sim.md) — integrates resources (V1) + logistics (V2) into a window:
// Earth order → charge money (budget M, inflation D-031) → ship within launch throughput → goods
// land NEXT window (Tsiolkovsky lag) → consume life-support → resolve stocks → mortality / runway.
// V3: no local production yet (everything imported) — structures add production in V4/V5.

import {
  applyFlows,
  emptyStocks,
  RESOURCES,
  type Stocks,
  type ResourceKind,
} from './resources';
import {
  defaultLaunchParams,
  newFleet,
  shipPlan,
  rollExplosions,
  throughputMass,
  padMaintTotal,
  padBuildCost,
  TECHS,
  type Fleet,
  type LaunchParams,
  type LaunchTech,
} from './logistics';
import { makeRng } from './rng';
import {
  STRUCT_BY_ID,
  resolveColonyEnergy,
  structureFlows,
  spareUpkeep,
  type BuiltCounts,
  type Condition,
} from './structures';

/** Per-resource catalog: earth price ($/kg) + per-capita life-support consumption (kg/window). */
export interface ResourceSpec {
  earthPerKg: number;
  perCapita: number; // life-support draw per colonist per window (0 = not life-support)
  recycle: number; // η recovered fraction (ECLSS)
  tare: number; // extra SHIP mass per kg for containment (gases: tank ≥ gas → ~1.0). Imports only.
}

export type ResourceCatalog = Record<ResourceKind, ResourceSpec>;

export interface ColonyParams {
  M: number; // per-window subsidy (D-021)
  inflation: number; // D-031 erosion
  pop0: number;
  colonistCost: number; // money per colonist
  colonistMass: number; // kg per colonist (life-support kit + body)
  mortFactor: number; // shortfall → death sensitivity
  wearRate: number; // condition lost/window for a fully-unmaintained structure (V6)
  birthRate: number; // per-window growth when a supplied medbay is running (D-030)
  popEnergyPerCapita: number; // life-support energy draw per colonist (priority 0)
  catalog: ResourceCatalog;
  launch: LaunchParams;
  startPads: number;
  startStockWindows: number; // initial life-support buffer, in windows of consumption
  maxWindows: number;
  seed: number; // RNG seed (pad explosions)
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
  built: BuiltCounts; // structures built on Mars (id → count)
  condition: Condition; // per-structure-type wear 0..1 (V6)
  rngState: number; // seeded RNG state (explosions) — kept as a number so state stays JSON-able
  p: ColonyParams;
}

/** Earth order for one window (the slider manifest). */
export interface EarthOrder {
  resources: Partial<Stocks>; // kg to order per resource
  padsToBuild: Record<LaunchTech, number>; // pads to build this window, per class
  unlockRefuel: boolean; // pay R&D to unlock the refuel pad class (D-039)
  colonists: number;
}

/** An empty order (no goods, no pads, no colonists). */
export function emptyOrder(): EarthOrder {
  return { resources: {}, padsToBuild: { classic: 0, refuel: 0 }, unlockRefuel: false, colonists: 0 };
}

// ---- params -------------------------------------------------------------

export function defaultCatalog(): ResourceCatalog {
  const z: ResourceSpec = { earthPerKg: 5, perCapita: 0, recycle: 0, tare: 0 };
  const cat = Object.fromEntries(RESOURCES.map((r) => [r, { ...z }])) as ResourceCatalog;
  // life-support (TOY numbers — playable/tunable; real calibration in a later balance pass.
  // NB at honest scale, importing food for 1000+ is mass-impossible → farms mandatory, V4).
  cat.food = { earthPerKg: 50, perCapita: 50, recycle: 0, tare: 0.1 }; // сублимат/космо-рацион
  cat.water = { earthPerKg: 2, perCapita: 100, recycle: 0.3, tare: 0.05 }; // пассивный минимум; ЖО-рециклер даёт остальное (V6)
  cat.o2 = { earthPerKg: 20, perCapita: 20, recycle: 0.3, tare: 1.0 }; // газ + криобак; MOXIE даёт остальное
  cat.n2 = { earthPerKg: 15, perCapita: 5, recycle: 0.0, tare: 1.0 }; // газ + сосуд под давлением
  // materials (consumed by construction in V4+)
  cat.steel = { earthPerKg: 2, perCapita: 0, recycle: 0, tare: 0 };
  cat.metals = { earthPerKg: 8, perCapita: 0, recycle: 0, tare: 0 };
  cat.polymers = { earthPerKg: 40, perCapita: 0, recycle: 0, tare: 0 };
  cat.glass = { earthPerKg: 3, perCapita: 0, recycle: 0, tare: 0 };
  cat.spares = { earthPerKg: 50, perCapita: 0, recycle: 0, tare: 0 };
  // hi-tech — import-only, light & ruinously dear (D-045/D-046)
  cat.pharma = { earthPerKg: 3000, perCapita: 0, recycle: 0, tare: 0.2 };
  cat.chips = { earthPerKg: 50000, perCapita: 0, recycle: 0, tare: 0 };
  cat.catalyst = { earthPerKg: 8000, perCapita: 0, recycle: 0, tare: 0.1 };
  return cat;
}

export function defaultColonyParams(overrides: Partial<ColonyParams> = {}): ColonyParams {
  return {
    M: 5.4e10, // ≈ бюджет NASA за синодическое окно ($25B/год × 2.17 года) — деньги реально жмут (D-053)
    inflation: 0.03,
    pop0: 1000,
    colonistCost: 3.0e8,
    colonistMass: 2000,
    mortFactor: 0.8,
    wearRate: 0.12,
    birthRate: 0.05,
    popEnergyPerCapita: 0.05,
    catalog: defaultCatalog(),
    launch: defaultLaunchParams(),
    startPads: 5,
    startStockWindows: 1.0,
    maxWindows: 40,
    seed: 1,
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
    fleet: newFleet(p.launch, p.startPads),
    collapsed: false,
    built: {},
    condition: {},
    rngState: p.seed >>> 0,
    p,
  };
}

// ---- Mars build helpers (for the Mars tab) -----------------------------

/** Money to build the queued structures (inflation-adjusted). */
export function marsPlanCost(s: ColonyState, build: string[]): number {
  const mult = priceMult(s);
  return build.reduce((sum, id) => sum + (STRUCT_BY_ID[id]?.capex ?? 0) * mult, 0);
}

/** Aggregate local materials a build queue consumes. */
export function marsPlanMaterials(build: string[]): Partial<Stocks> {
  const need: Partial<Stocks> = {};
  for (const id of build) {
    const st = STRUCT_BY_ID[id];
    if (!st) continue;
    for (const r of Object.keys(st.buildMaterials) as ResourceKind[]) {
      need[r] = (need[r] ?? 0) + (st.buildMaterials[r] ?? 0);
    }
  }
  return need;
}

/** Can a structure be built now? (prereq already standing). */
export function prereqMet(s: ColonyState, id: string): boolean {
  const st = STRUCT_BY_ID[id];
  if (!st) return false;
  return !st.prereq || (s.built[st.prereq] ?? 0) > 0;
}

// ---- order preview (for the UI manifest) --------------------------------

export interface OrderPreview {
  goodsCost: number;
  colonistCost: number;
  padCapex: number; // capex to build pads this window
  rndCost: number; // refuel R&D unlock this window
  launchTotal: number; // flight cost + pad maintenance (whole fleet)
  total: number;
  mass: number; // kg to ship (goods + colonists)
  throughput: number; // max shippable with fleet (incl. pads being built + refuel unlock)
  capped: boolean; // mass exceeds throughput
  overBudget: boolean;
  budget: number;
  effPerKg: number;
  futureFleet: Fleet; // fleet after this window's pad builds / unlock (for the UI)
}

export function priceMult(s: ColonyState): number {
  return Math.pow(1 + s.p.inflation, s.window);
}

/** Apply an order's pad builds + refuel unlock to a fleet copy (no mutation). */
function fleetAfter(s: ColonyState, order: EarthOrder): Fleet {
  const unlocked = s.fleet.refuelUnlocked || order.unlockRefuel;
  return {
    refuelUnlocked: unlocked,
    pads: {
      classic: s.fleet.pads.classic + Math.max(0, Math.floor(order.padsToBuild.classic)),
      // refuel pads only count if the class is (being) unlocked
      refuel: s.fleet.pads.refuel + (unlocked ? Math.max(0, Math.floor(order.padsToBuild.refuel)) : 0),
    },
  };
}

export function previewOrder(s: ColonyState, order: EarthOrder): OrderPreview {
  const p = s.p;
  const mult = priceMult(s);
  let goodsMass = 0;
  let goodsCost = 0;
  for (const r of RESOURCES) {
    const qty = Math.max(0, order.resources[r] ?? 0);
    goodsMass += qty * (1 + p.catalog[r].tare); // ship mass = resource + container/tare
    goodsCost += qty * p.catalog[r].earthPerKg * mult;
  }
  const colonists = Math.max(0, Math.floor(order.colonists));
  const mass = goodsMass + colonists * p.colonistMass;
  const colonistCost = colonists * p.colonistCost * mult;

  const futureFleet = fleetAfter(s, order);
  let padCapex = 0;
  for (const t of TECHS) {
    const n = futureFleet.pads[t] - s.fleet.pads[t];
    if (n > 0) padCapex += padBuildCost(p.launch, t, n);
  }
  padCapex *= mult;
  const rndCost = order.unlockRefuel && !s.fleet.refuelUnlocked ? p.launch.refuelRnDCost * mult : 0;

  const plan = shipPlan(futureFleet, p.launch, mass);
  const launchTotal = (plan.flightCost + padMaintTotal(futureFleet, p.launch)) * mult;
  const throughput = throughputMass(futureFleet, p.launch);

  const total = goodsCost + colonistCost + padCapex + rndCost + launchTotal;
  return {
    goodsCost,
    colonistCost,
    padCapex,
    rndCost,
    launchTotal,
    total,
    mass,
    throughput,
    capped: mass > throughput,
    overBudget: total > p.M,
    budget: p.M,
    effPerKg: mass > 0 ? (launchTotal + padCapex) / mass : 0,
    futureFleet,
  };
}

// ---- the window ---------------------------------------------------------

export interface ColonyReport {
  window: number;
  pop: number;
  runway: number; // production-aware: windows of cover if imports cut (Infinity = self-sufficient)
  stocks: Stocks;
  landed: Transit; // what arrived this window
  deficit: Partial<Stocks>;
  mortality: number;
  spent: number;
  capped: boolean;
  built: string[]; // structures completed this window
  explosions: Record<LaunchTech, number>; // pads lost to on-pad explosions this window
  energyGen: number;
  energyDemand: number;
  energyDeficit: number;
  avgCondition: number; // mean structure condition 0..1 (V6)
  sparesCoverage: number; // fraction of spares upkeep met this window
  collapsed: boolean;
}

const LIFE_R: ResourceKind[] = ['food', 'water', 'o2'];

/** Production-aware runway: stock / (net consumption − local production), min over life-support. */
function colonyRunway(
  stocks: Stocks,
  cons: Partial<Stocks>,
  production: Partial<Stocks>,
  recycle: Partial<Stocks>,
): number {
  let worst = Infinity;
  for (const r of LIFE_R) {
    const netCons = (cons[r] ?? 0) * (1 - (recycle[r] ?? 0));
    const drain = netCons - (production[r] ?? 0);
    if (drain <= 0) continue; // locally self-sufficient for this resource
    worst = Math.min(worst, stocks[r] / drain);
  }
  return worst === Infinity ? Infinity : Math.round(worst * 10) / 10;
}

/**
 * Commit one synodic window: charge & ship the order + build Mars structures (within throughput
 * & budget), land the PREVIOUS convoy, resolve energy (priority brownout), run structure
 * production/consumption + life-support, resolve stocks, apply mortality, advance pop.
 */
export function commitWindow(s: ColonyState, order: EarthOrder, build: string[] = []): ColonyReport {
  const p = s.p;
  s.window += 1;
  const pv = previewOrder(s, order);

  // Mars build plan: cost, materials, prerequisites
  const marsCost = marsPlanCost(s, build);
  const matNeed = marsPlanMaterials(build);
  const materialsOk = (Object.keys(matNeed) as ResourceKind[]).every(
    (r) => s.stocks[r] >= (matNeed[r] ?? 0),
  );
  const prereqsOk = build.every((id) => prereqMet(s, id));

  const feasible =
    !pv.overBudget && !pv.capped && pv.total + marsCost <= p.M && materialsOk && prereqsOk;
  const spent = feasible ? pv.total + marsCost : 0;
  const builtThis: string[] = [];

  // capture the PREVIOUS convoy (it lands this window) BEFORE re-queuing
  const landed = s.inTransit;

  const explosions: Record<LaunchTech, number> = { classic: 0, refuel: 0 };

  if (feasible) {
    // apply pad builds + refuel unlock (futureFleet already computed in the preview)
    s.fleet = { refuelUnlocked: pv.futureFleet.refuelUnlocked, pads: { ...pv.futureFleet.pads } };
    // build structures: consume local materials, raise counts
    for (const r of Object.keys(matNeed) as ResourceKind[]) s.stocks[r] -= matNeed[r] ?? 0;
    for (const id of build) {
      if (STRUCT_BY_ID[id]) {
        s.built[id] = (s.built[id] ?? 0) + 1;
        if (s.condition[id] === undefined) s.condition[id] = 1; // fresh type starts at full condition
        builtThis.push(id);
      }
    }
    const shipped = emptyStocks(0);
    for (const r of RESOURCES) shipped[r] = Math.max(0, order.resources[r] ?? 0);
    s.inTransit = { stocks: shipped, colonists: Math.max(0, Math.floor(order.colonists)) };

    // on-pad explosions for this window's launches → pads lost for FUTURE windows (D-043)
    const plan = shipPlan(s.fleet, p.launch, pv.mass);
    const rng = makeRng(s.rngState);
    const lost = rollExplosions(s.fleet, p.launch, plan, rng);
    s.rngState = rng.state();
    for (const t of TECHS) {
      s.fleet.pads[t] = Math.max(0, s.fleet.pads[t] - lost[t]);
      explosions[t] = lost[t];
    }
  } else {
    s.inTransit = { stocks: emptyStocks(0), colonists: 0 };
  }

  // colonists from the landed convoy arrive
  s.pop += landed.colonists;

  // available resources this window = stock + landed convoy
  const avail: Partial<Stocks> = {};
  for (const r of RESOURCES) avail[r] = s.stocks[r] + (landed.stocks[r] ?? 0);

  // wear (V6): spares maintain condition; shortfall → structures degrade (output falls → cascade)
  const upkeep = spareUpkeep(s.built);
  const sparesCoverage = upkeep > 0 ? Math.min(1, (avail.spares ?? 0) / upkeep) : 1;
  for (const s2 of Object.keys(s.built)) {
    if ((s.built[s2] ?? 0) <= 0) continue;
    const c = s.condition[s2] ?? 1;
    s.condition[s2] = Math.max(0, Math.min(1, c - p.wearRate * (1 - sparesCoverage)));
  }

  // energy (priority brownout) + input availability (hi-tech) + condition (wear) → structure output
  const lifeSupportDemand = p.popEnergyPerCapita * s.pop;
  const energy = resolveColonyEnergy(s.built, lifeSupportDemand, s.condition);
  const sf = structureFlows(s.built, energy.served, avail, s.condition);

  // life-support + structure consumption + spares upkeep; arrivals + structure production
  const cons = consumption(s);
  const combinedCons: Partial<Stocks> = { ...cons };
  for (const r of Object.keys(sf.consumption) as ResourceKind[]) {
    combinedCons[r] = (combinedCons[r] ?? 0) + (sf.consumption[r] ?? 0);
  }
  combinedCons.spares = (combinedCons.spares ?? 0) + upkeep;
  const recycle = recycleMap(p);
  const { stocks, deficit } = applyFlows(s.stocks, {
    arrivals: landed.stocks,
    production: sf.production,
    consumption: combinedCons,
    recycleEff: recycle,
  });
  s.stocks = stocks;

  // mortality from the worst life-support shortfall (Liebig)
  let worstRatio = 0;
  for (const r of LIFE_R) {
    const need = combinedCons[r] ?? 0;
    if (need > 0 && deficit[r]) worstRatio = Math.max(worstRatio, deficit[r]! / need);
  }
  const mortality = s.pop * Math.min(0.9, p.mortFactor * worstRatio);
  s.pop -= mortality;

  // births: a supplied, running medbay enables growth (D-030) — pulls pharma (hi-tech) forever
  if ((s.built['medbay'] ?? 0) > 0 && (avail['pharma'] ?? 0) > 0) {
    s.pop *= 1 + p.birthRate;
  }
  if (s.pop < p.pop0 * 0.2) s.collapsed = true;

  return {
    window: s.window,
    pop: Math.round(s.pop),
    runway: colonyRunway(s.stocks, cons, sf.production, recycle),
    stocks: { ...s.stocks },
    landed,
    deficit,
    mortality: Math.round(mortality),
    spent,
    capped: pv.capped,
    built: builtThis,
    explosions,
    energyGen: energy.generation,
    energyDemand: energy.generation + energy.deficit,
    energyDeficit: energy.deficit,
    avgCondition: avgCondition(s),
    sparesCoverage,
    collapsed: s.collapsed,
  };
}

/** Mean condition across built structure types (1 if nothing built). */
function avgCondition(s: ColonyState): number {
  const ids = Object.keys(s.built).filter((id) => (s.built[id] ?? 0) > 0);
  if (!ids.length) return 1;
  return ids.reduce((a, id) => a + (s.condition[id] ?? 1), 0) / ids.length;
}
