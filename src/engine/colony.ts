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
import { parseCsv, num } from '../data/csv';
import resourcesCsv from '../data/resources.csv?raw';
import storytellerCsv from '../data/storyteller.csv?raw';
import {
  STRUCT_BY_ID,
  resolveColonyEnergy,
  structureFlows,
  spareUpkeep,
  housingCapacity,
  structuralN2Leak,
  type BuiltCounts,
  type Condition,
  type StructureDiag,
} from './structures';
import {
  rollEvent,
  effectMultiplier,
  priceMultFor,
  decayEffects,
  type ActiveEffect,
  type WindowEvent,
} from './events';

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
  mortFactor: number; // shortfall → death sensitivity (stock resources: food/water/o2/n2)
  energyMortFactor: number; // shortfall → death sensitivity for unpowered life support (D-060);
  // deliberately softer than mortFactor — energy has no stock buffer between windows (a shortfall is
  // instant + total every window it persists), so the same rate as food/water would be far deadlier
  // for what's conceptually the same kind of danger.
  wearRate: number; // condition lost/window for a fully-unmaintained structure (V6)
  birthRate: number; // per-window growth when a supplied medbay is running (D-030)
  popEnergyPerCapita: number; // life-support energy draw per colonist (priority 0)
  catalog: ResourceCatalog;
  launch: LaunchParams;
  startPads: number;
  startStockWindows: number; // initial life-support buffer, in windows of consumption
  maxWindows: number;
  seed: number; // RNG seed (pad explosions, storyteller events)
  eventStartWindow: number; // storyteller (D-063): 0 chance before this window (bootstrap grace)
  eventRampPerWindow: number; // linear chance increase per window past eventStartWindow
  eventChanceCap: number; // ceiling on per-window event chance
  eventPopRef: number; // population at which event severity reaches its full magnitude range (D-063)
}

export interface Transit {
  stocks: Stocks;
  colonists: number;
  structures: Record<string, number>; // pre-built structures in transit (V8 import)
}

export interface ColonyState {
  window: number;
  pop: number;
  stocks: Stocks;
  inTransit: Transit;
  fleet: Fleet;
  collapsed: boolean;
  everHadPop: boolean; // true once pop has been > 0 — guards extinction collapse before first landing (V7)
  built: BuiltCounts; // structures built on Mars (id → count)
  condition: Condition; // per-structure-type wear 0..1 (V6)
  rngState: number; // seeded RNG state (explosions, storyteller) — a number so state stays JSON-able
  chronicle: ColonyReport[]; // per-window diegetic report history (D-061) — the game's memory
  activeEffects: ActiveEffect[]; // rolling storyteller effects still counting down (D-063)
  holdTransit: Transit | null; // a convoy delayed by a skip_window event, merges into the next launch
  lastEvent: { id: string; window: number } | null; // for the "not two windows in a row" rule
  milestones: Partial<Record<MilestoneId, number>>; // id → window first achieved (D-064)
  p: ColonyParams;
}

/** Earth order for one window (the slider manifest). */
export interface EarthOrder {
  resources: Partial<Stocks>; // kg to order per resource
  padsToBuild: Record<LaunchTech, number>; // pads to build this window, per class
  unlockRefuel: boolean; // pay R&D to unlock the refuel pad class (D-039)
  colonists: number;
  structures: Partial<Record<string, number>>; // pre-built structures to import (V8, D-057)
}

/** An empty order (no goods, no pads, no colonists, no structure imports). */
export function emptyOrder(): EarthOrder {
  return { resources: {}, padsToBuild: { classic: 0, refuel: 0 }, unlockRefuel: false, colonists: 0, structures: {} };
}

// ---- params -------------------------------------------------------------

/** Loads the resource catalog from data/resources.csv (D-058) — a balance spreadsheet, not code.
 * TOY numbers — playable/tunable; real calibration in a later balance pass. NB at honest scale,
 * importing food for 1000+ is mass-impossible → farms mandatory (V4). */
export function defaultCatalog(): ResourceCatalog {
  const cat = {} as ResourceCatalog;
  for (const row of parseCsv(resourcesCsv)) {
    cat[row.id as ResourceKind] = {
      earthPerKg: num(row.earthPerKg),
      perCapita: num(row.perCapita),
      recycle: num(row.recycle),
      tare: num(row.tare),
    };
  }
  return cat;
}

export function defaultColonyParams(overrides: Partial<ColonyParams> = {}): ColonyParams {
  return {
    // ≈ треть бюджета NASA за синодическое окно ($25B/год × 2.17 года × ~37%, D-060) — раньше был весь
    // бюджет агентства целиком, из-за чего импорт еды/воды навсегда оставался незаметной строчкой
    // расходов при любой достижимой популяции: НАСА не тратит на один марсианский проект вообще всё.
    M: 2.0e10,
    inflation: 0.03,
    pop0: 0, // start from nothing — the player orders their own first colonists (V7 redesign)
    colonistCost: 3.0e8,
    colonistMass: 2000,
    mortFactor: 0.8,
    energyMortFactor: 0.3, // softer than mortFactor (D-060) — a slower death spiral, not instant wipeout
    wearRate: 0.12,
    birthRate: 0.05,
    popEnergyPerCapita: 0.05,
    catalog: defaultCatalog(),
    launch: defaultLaunchParams(),
    startPads: 5,
    startStockWindows: 1.0,
    maxWindows: 40,
    seed: 1,
    // storyteller escalation (D-063): ≈0 chance through the grace windows (bootstrap is hard enough
    // already), ramping to a ceiling by the late game — never telegraphed, only the chronicle after.
    // Curve + severity popRef live in data/storyteller.csv (D-063: "все кривые и числа — в CSV").
    ...storytellerDefaults(),
    ...overrides,
  };
}

/** Loads the storyteller escalation curve from data/storyteller.csv (D-058/D-063). */
function storytellerDefaults(): Pick<
  ColonyParams,
  'eventStartWindow' | 'eventRampPerWindow' | 'eventChanceCap' | 'eventPopRef'
> {
  const row = parseCsv(storytellerCsv)[0] ?? {};
  return {
    eventStartWindow: num(row.eventStartWindow),
    eventRampPerWindow: num(row.eventRampPerWindow),
    eventChanceCap: num(row.eventChanceCap),
    eventPopRef: num(row.eventPopRef),
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
    inTransit: { stocks: emptyStocks(0), colonists: 0, structures: {} },
    fleet: newFleet(p.launch, p.startPads),
    collapsed: false,
    everHadPop: p.pop0 > 0,
    built: {},
    condition: {},
    rngState: p.seed >>> 0,
    chronicle: [],
    activeEffects: [],
    holdTransit: null,
    lastEvent: null,
    milestones: {},
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
  structCost: number; // pre-built structures imported this window (V8, D-057)
  padCapex: number; // capex to build pads this window
  rndCost: number; // refuel R&D unlock this window
  launchTotal: number; // flight cost + pad maintenance (whole fleet)
  total: number;
  mass: number; // kg to ship (goods + colonists + imported structures)
  throughput: number; // max shippable with fleet (incl. pads being built + refuel unlock)
  capped: boolean; // mass exceeds throughput
  overBudget: boolean;
  budget: number;
  effPerKg: number;
  futureFleet: Fleet; // fleet after this window's pad builds / unlock (for the UI)
}

/** Mass+cost of importing a structure fully built: priced at its `capex` (a complex, durable,
 * space-rated life-support unit is not the sum of its raw metal — D-057, repurposing the field
 * D-054 left unused for exactly this). Shipped mass is still its buildMaterials-equivalent (that's
 * the physical bulk landing on the pad), so delivery cost is layered on top per D-038/039. */
export function structureImportPlan(
  p: ColonyParams,
  structures: Partial<Record<string, number>>,
  mult: number,
): { mass: number; cost: number } {
  let mass = 0;
  let cost = 0;
  for (const id of Object.keys(structures)) {
    const n = Math.max(0, Math.floor(structures[id] ?? 0));
    const st = STRUCT_BY_ID[id];
    if (n <= 0 || !st) continue;
    cost += st.capex * n * mult;
    for (const r of Object.keys(st.buildMaterials) as ResourceKind[]) {
      const qty = (st.buildMaterials[r] ?? 0) * n;
      mass += qty * (1 + p.catalog[r].tare);
    }
  }
  return { mass, cost };
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
    // price_spike (D-063): an active event can multiply one resource category's earth price
    goodsCost += qty * p.catalog[r].earthPerKg * priceMultFor(s.activeEffects, r) * mult;
  }
  const colonists = Math.max(0, Math.floor(order.colonists));
  const colonistCost = colonists * p.colonistCost * mult;
  const struct = structureImportPlan(p, order.structures, mult);
  const mass = goodsMass + colonists * p.colonistMass + struct.mass;

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

  const total = goodsCost + colonistCost + struct.cost + padCapex + rndCost + launchTotal;
  // subsidy_cut (D-063): an active event can shrink the window's effective budget
  const budget = p.M * effectMultiplier(s.activeEffects, 'subsidy');
  return {
    goodsCost,
    colonistCost,
    structCost: struct.cost,
    padCapex,
    rndCost,
    launchTotal,
    total,
    mass,
    throughput,
    capped: mass > throughput,
    overBudget: total > budget,
    budget,
    effPerKg: mass > 0 ? (launchTotal + padCapex) / mass : 0,
    futureFleet,
  };
}

// ---- the window ---------------------------------------------------------

/** Named mortality cause for the chronicle (D-061): the binding life-support resource (Liebig),
 * energy brownout, or an epidemic event (D-063). */
export type MortalityCause = ResourceKind | 'energy' | 'epidemic';

export interface ColonyReport {
  window: number;
  pop: number;
  runway: number; // production-aware: windows of cover if imports cut (Infinity = self-sufficient)
  stocks: Stocks;
  landed: Transit; // what arrived this window
  deficit: Partial<Stocks>;
  mortality: number;
  mortalityBreakdown: Partial<Record<MortalityCause, number>>; // named causes (D-061), sums to ~mortality
  births: number; // colonists born this window (medbay growth, D-030) — 0 if none
  spent: number;
  capped: boolean;
  built: string[]; // structures completed this window
  explosions: Record<LaunchTech, number>; // pads lost to on-pad explosions this window
  energyGen: number;
  energyDemand: number;
  energyDeficit: number;
  avgCondition: number; // mean structure condition 0..1 (V6)
  sparesCoverage: number; // fraction of spares upkeep met this window
  housingCapacity: number; // total colonist slots from habitat structures (V7); 0 = unconstrained
  n2LeakKg: number; // kg N₂ leaked from hull this window (V7)
  structDiag: Record<string, StructureDiag>; // per-structure-type output breakdown (D-061)
  autonomyByMass: number; // 0..1: local production mass ÷ (local production + landed import mass) this window
  event?: WindowEvent; // storyteller event that fired this window, if any (D-063)
  milestones: MilestoneId[]; // newly achieved this window, if any (D-064)
  buffer?: number; // D-062 gauge as of this window's end (absent inside runway simulations)
  collapsed: boolean;
}

// ---- milestones (D-064): a recorded first, never a reward — no win state exists. --------------

export type MilestoneId =
  | 'first_landing'
  | 'first_birth'
  | 'pop_100'
  | 'bulk_autonomy'
  | 'buffer_2'
  | 'event_survived'
  | 'refuel_unlocked'
  | 'zero_import';

export interface MilestoneSpec {
  id: MilestoneId;
  name: string;
  icon: string;
}

/** Order matches D-064's decision text. `zero_import` is the "finale-boss" — full independence
 * (D-046) as a visible far star, never an ending. */
export const MILESTONES: readonly MilestoneSpec[] = [
  { id: 'first_landing', name: 'Первая высадка', icon: '🛬' },
  { id: 'first_birth', name: 'Первое рождение', icon: '🐣' },
  { id: 'pop_100', name: '100 колонистов', icon: '👥' },
  { id: 'bulk_autonomy', name: 'Балк-автономия', icon: '🌾' },
  { id: 'buffer_2', name: 'Запас без завоза ≥ 2 окон', icon: '🛡' },
  { id: 'event_survived', name: 'Пережили событие без потерь', icon: '🕊' },
  { id: 'refuel_unlocked', name: 'Орбитальная заправка', icon: '⛽' },
  { id: 'zero_import', name: 'Окно без единого завоза', icon: '🌌' },
];

// N₂ included: habitat hull leak → N₂ shortage → mortality (V7); no habitats → leak=0 → no effect
const LIFE_R: ResourceKind[] = ['food', 'water', 'o2', 'n2'];

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

/** Combine two convoys into one (D-063 skip_window: a held convoy merges into the next launch). */
function mergeTransit(a: Transit, b: Transit | null): Transit {
  if (!b) return a;
  const stocks = emptyStocks(0);
  for (const r of RESOURCES) stocks[r] = a.stocks[r] + (b.stocks[r] ?? 0);
  const structures: Record<string, number> = { ...a.structures };
  for (const id of Object.keys(b.structures)) structures[id] = (structures[id] ?? 0) + (b.structures[id] ?? 0);
  return { stocks, colonists: a.colonists + b.colonists, structures };
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

  // Mars build plan: materials + prerequisites only — command economy, no money capex (D-054).
  // The dollar (subsidy) is Earth-side procurement; building on Mars costs local materials + labour.
  const matNeed = marsPlanMaterials(build);
  const materialsOk = (Object.keys(matNeed) as ResourceKind[]).every(
    (r) => s.stocks[r] >= (matNeed[r] ?? 0),
  );
  const importIds = Object.keys(order.structures).filter((id) => (order.structures[id] ?? 0) > 0);
  const prereqsOk = build.every((id) => prereqMet(s, id)) && importIds.every((id) => prereqMet(s, id));

  const feasible = !pv.overBudget && !pv.capped && materialsOk && prereqsOk;
  const spent = feasible ? pv.total : 0; // only the Earth order costs money
  const builtThis: string[] = [];

  // capture the PREVIOUS convoy (it lands this window) BEFORE re-queuing
  const landed = s.inTransit;

  const explosions: Record<LaunchTech, number> = { classic: 0, refuel: 0 };

  // storyteller (D-063): rolled once per window, regardless of feasibility — a blind order still
  // meets the same Mars. Mars-physical events (dust storm, blight — like the epidemic) bite the
  // SAME window they roll: the player has already committed; announcing first would hand them a
  // free reaction turn (Mars builds are instant, so a "surprise" storm could be neutralized by
  // committing extra solar plants — the telegraph D-063 forbids). Earth-economic events (subsidy,
  // price) squeeze the NEXT manifest by nature: this window's order is already priced and paid.
  const rng = makeRng(s.rngState);
  const excludeId = s.lastEvent && s.lastEvent.window === s.window - 1 ? s.lastEvent.id : undefined;
  // the window right after a skip_window is the supply gap it created (nothing lands) — read by
  // the event_survived milestone, and excluded from the zero_import finale-boss
  const skipGapWindow = excludeId === 'skip_window';
  const roll = rollEvent(s.window, s.pop, p, excludeId, rng);
  let genMult = effectMultiplier(s.activeEffects, 'energy');
  let farmMult = effectMultiplier(s.activeEffects, 'farm');
  if (roll?.spec.effect === 'energy') genMult *= 1 - roll.mag;
  if (roll?.spec.effect === 'farm') farmMult *= 1 - roll.mag;

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

    // on-pad explosions for this window's launches → pads lost for FUTURE windows (D-043)
    const plan = shipPlan(s.fleet, p.launch, pv.mass);
    const lost = rollExplosions(s.fleet, p.launch, plan, rng);
    for (const t of TECHS) {
      s.fleet.pads[t] = Math.max(0, s.fleet.pads[t] - lost[t]);
      explosions[t] = lost[t];
    }
  }
  s.rngState = rng.state();

  // this window's shipment (empty if the order was infeasible — nothing goes out)
  const shipped = emptyStocks(0);
  const shippedStructures: Record<string, number> = {};
  if (feasible) {
    for (const r of RESOURCES) shipped[r] = Math.max(0, order.resources[r] ?? 0);
    for (const id of importIds) shippedStructures[id] = Math.floor(order.structures[id] ?? 0);
  }
  const newShipment: Transit = {
    stocks: shipped,
    colonists: feasible ? Math.max(0, Math.floor(order.colonists)) : 0,
    structures: shippedStructures,
  };
  // skip_window (D-063): this window's convoy does not launch — whatever was already held launches
  // now instead (merges with nothing, i.e. lands on its own), and the new shipment is held one extra
  // window ("arrives together with the next one", per the decision).
  if (roll?.spec.effect === 'delay') {
    s.inTransit = s.holdTransit ?? { stocks: emptyStocks(0), colonists: 0, structures: {} };
    s.holdTransit = newShipment;
  } else {
    s.inTransit = mergeTransit(newShipment, s.holdTransit);
    s.holdTransit = null;
  }

  // colonists from the landed convoy arrive
  s.pop += landed.colonists;

  // imported structures from the landed convoy arrive ready-to-run (no local assembly step, D-057)
  for (const id of Object.keys(landed.structures)) {
    const n = landed.structures[id] ?? 0;
    if (n <= 0 || !STRUCT_BY_ID[id]) continue;
    s.built[id] = (s.built[id] ?? 0) + n;
    if (s.condition[id] === undefined) s.condition[id] = 1;
    for (let i = 0; i < n; i++) builtThis.push(id);
  }

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

  // energy (priority brownout) + input availability (hi-tech) + condition (wear) → structure output;
  // dust_storm/blight (D-063) throttle generation/food-producers via genMult/farmMult above
  const lifeSupportDemand = p.popEnergyPerCapita * s.pop;
  const energy = resolveColonyEnergy(s.built, lifeSupportDemand, s.condition, genMult);
  const sf = structureFlows(s.built, energy.served, avail, s.condition, farmMult);

  // life-support + structure consumption + spares upkeep; arrivals + structure production
  const cons = consumption(s);
  const combinedCons: Partial<Stocks> = { ...cons };
  for (const r of Object.keys(sf.consumption) as ResourceKind[]) {
    combinedCons[r] = (combinedCons[r] ?? 0) + (sf.consumption[r] ?? 0);
  }
  combinedCons.spares = (combinedCons.spares ?? 0) + upkeep;
  // N₂ structural hull leak: each habitat module bleeds N₂ regardless of occupancy (V7)
  const n2LeakKg = structuralN2Leak(s.built);
  if (n2LeakKg > 0) combinedCons.n2 = (combinedCons.n2 ?? 0) + n2LeakKg;
  const recycle = recycleMap(p);
  const { stocks, deficit } = applyFlows(s.stocks, {
    arrivals: landed.stocks,
    production: sf.production,
    consumption: combinedCons,
    recycleEff: recycle,
  });
  s.stocks = stocks;

  // mortality from the worst life-support shortfall (Liebig), stock resources only (food/water/o2/n2);
  // track WHICH resource is binding — Liebig means only the worst one drives consumableFrac, so it's
  // also the one true "cause" to name in the chronicle (D-061).
  let worstRatio = 0;
  let worstResource: ResourceKind | undefined;
  for (const r of LIFE_R) {
    const need = combinedCons[r] ?? 0;
    if (need > 0 && deficit[r]) {
      const ratio = deficit[r]! / need;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstResource = r;
      }
    }
  }
  // baseline life-support power (heating, CO₂ scrubbing, water pumping — D-059) is a SEPARATE risk
  // with its own (softer) rate: unlike stocks, energy carries no buffer between windows — a shortfall
  // is instant and total every window it persists, so reusing mortFactor would make it far deadlier
  // than running dry on food/water despite representing the same kind of danger (D-060 grill).
  const energyRatio = lifeSupportDemand > 0 ? 1 - (energy.served['lifesupport'] ?? 1) : 0;
  const consumableFrac = Math.min(0.9, p.mortFactor * worstRatio);
  const energyFrac = Math.min(0.9, p.energyMortFactor * energyRatio);

  // epidemic (D-063): a third independent risk, folded into the same soft-OR — medbay + pharma on
  // hand cuts it down to a minimal covered rate plus a one-time pharma draw, uncovered it bites hard.
  let epidemicFrac = 0;
  let epidemicCovered = false;
  if (roll?.spec.effect === 'epidemic') {
    epidemicCovered = (s.built['medbay'] ?? 0) > 0 && (avail['pharma'] ?? 0) > 0;
    epidemicFrac = epidemicCovered ? roll.spec.coveredMag : roll.mag;
  }

  const mortality = s.pop * (1 - (1 - consumableFrac) * (1 - energyFrac) * (1 - epidemicFrac));
  s.pop -= mortality;
  if (epidemicCovered && roll) {
    s.stocks.pharma = Math.max(0, s.stocks.pharma - roll.spec.pharmaCost * s.pop);
  }

  // named attribution (D-061): split `mortality` between its independent risks proportionally to
  // their (pre-combination) fractions — consumableFrac has exactly one binding resource (Liebig).
  const mortalityBreakdown: Partial<Record<MortalityCause, number>> = {};
  const causeWeight = consumableFrac + energyFrac + epidemicFrac;
  if (causeWeight > 0) {
    if (consumableFrac > 0 && worstResource) {
      mortalityBreakdown[worstResource] = Math.round(mortality * (consumableFrac / causeWeight));
    }
    if (energyFrac > 0) {
      mortalityBreakdown.energy = Math.round(mortality * (energyFrac / causeWeight));
    }
    if (epidemicFrac > 0) {
      mortalityBreakdown.epidemic = Math.round(mortality * (epidemicFrac / causeWeight));
    }
  }

  // births: medbay + pharma enable growth (D-030); gated by housing (V7) and a fully-fed, fully-powered
  // colony (no growth mid-famine or mid-brownout)
  const housing = housingCapacity(s.built);
  const housingOk = housing === 0 || s.pop < housing * 0.9;
  const popBeforeBirths = s.pop;
  if ((s.built['medbay'] ?? 0) > 0 && (avail['pharma'] ?? 0) > 0 && housingOk && worstRatio === 0 && energyRatio === 0) {
    s.pop *= 1 + p.birthRate;
  }
  const births = Math.round(s.pop - popBeforeBirths);

  // extinction: mortality decays multiplicatively and never reaches exactly 0 on its own —
  // snap a dying-out colony (<1 person) to literal 0 and collapse, once colonists ever existed
  if (s.pop > 0) s.everHadPop = true;
  if (s.pop < 1) s.pop = 0;
  if (s.everHadPop && s.pop <= 0) s.collapsed = true;

  // autonomy by mass this window (D-061/glossary): local production vs. landed imports, by kg moved.
  let localMass = 0;
  let importedMass = 0;
  for (const r of RESOURCES) {
    localMass += sf.production[r] ?? 0;
    importedMass += landed.stocks[r] ?? 0;
  }
  const autonomyByMass = localMass + importedMass > 0 ? localMass / (localMass + importedMass) : 0;

  // storyteller bookkeeping (D-063): existing effects decay one window; what the fresh roll leaves
  // behind depends on its nature. Physical effects (energy/farm) already bit this window directly —
  // only their REMAINDER keeps rolling; economic effects (subsidy/price) start next window whole;
  // delay/epidemic fully resolved above. `lastEvent` feeds the "not two windows in a row" exclusion.
  s.activeEffects = decayEffects(s.activeEffects);
  if (roll && (roll.spec.effect === 'subsidy' || roll.spec.effect === 'price')) {
    s.activeEffects.push({ id: roll.spec.id, effect: roll.spec.effect, mag: roll.mag, windowsLeft: roll.dur, category: roll.category });
  } else if (roll && (roll.spec.effect === 'energy' || roll.spec.effect === 'farm') && roll.dur > 1) {
    s.activeEffects.push({ id: roll.spec.id, effect: roll.spec.effect, mag: roll.mag, windowsLeft: roll.dur - 1 });
  }
  let windowEvent: WindowEvent | undefined;
  if (roll) {
    windowEvent = {
      id: roll.spec.id,
      name: roll.spec.name,
      icon: roll.spec.icon,
      effect: roll.spec.effect,
      mag: roll.mag,
      windows: roll.dur,
      category: roll.category,
    };
    if (roll.spec.effect === 'epidemic') {
      windowEvent.covered = epidemicCovered;
      windowEvent.deaths = mortalityBreakdown.epidemic ?? 0;
    }
    s.lastEvent = { id: roll.spec.id, window: s.window };
  }

  // milestones (D-064): a checklist, never a reward — recorded once, first time only.
  const bulkAutonomyOk =
    s.pop > 0 &&
    LIFE_R.every((r) => (combinedCons[r] ?? 0) * (1 - (recycle[r] ?? 0)) <= (sf.production[r] ?? 0));
  const noNewImports =
    RESOURCES.every((r) => (landed.stocks[r] ?? 0) <= 0) &&
    landed.colonists === 0 &&
    Object.values(landed.structures).every((n) => (n ?? 0) <= 0);
  const milestonesThis: MilestoneId[] = [];
  const mark = (id: MilestoneId) => {
    if (s.milestones[id] === undefined) {
      s.milestones[id] = s.window;
      milestonesThis.push(id);
    }
  };
  // buffer gauge measured once per REAL window (the simulating guard stops the recursion — the
  // gauge itself runs commitWindow on a clone) — stored in the report so the store reads it for
  // free and the debrief gets a historical series (D-062/D-064).
  const buffer = simulating ? undefined : bufferRunway(s);
  if (landed.colonists > 0) mark('first_landing');
  if (births > 0) mark('first_birth');
  if (s.pop >= 100) mark('pop_100');
  if (bulkAutonomyOk) mark('bulk_autonomy');
  if (buffer !== undefined && buffer >= 2) mark('buffer_2');
  // "survive an event with zero deaths" counts only windows where a DEADLY effect actually applied:
  // a storm/blight throttling output, an epidemic, or the supply gap a skipped convoy left behind.
  // Economic events (subsidy/price) can't kill in their own window — surviving them is no feat.
  const deadlyApplied = genMult < 1 || farmMult < 1 || roll?.spec.effect === 'epidemic' || skipGapWindow;
  if (deadlyApplied && mortality === 0 && s.pop > 0) mark('event_survived');
  if (s.fleet.refuelUnlocked) mark('refuel_unlocked');
  // finale-boss: a LIVING, built colony passing a window where nothing landed AND nothing was
  // ordered — an empty manifest by choice. A rejected (infeasible) order and the gap window after
  // a skip_window both land nothing too, but neither is independence — they don't count.
  const emptyManifest =
    feasible &&
    RESOURCES.every((r) => (order.resources[r] ?? 0) <= 0) &&
    Math.floor(order.colonists) <= 0 &&
    importIds.length === 0;
  const anythingBuilt = Object.keys(s.built).some((id) => (s.built[id] ?? 0) > 0);
  if (s.pop > 0 && anythingBuilt && noNewImports && emptyManifest && !skipGapWindow) mark('zero_import');

  const report: ColonyReport = {
    window: s.window,
    pop: Math.round(s.pop),
    runway: colonyRunway(s.stocks, cons, sf.production, recycle),
    stocks: { ...s.stocks },
    landed,
    deficit,
    mortality: Math.round(mortality),
    mortalityBreakdown,
    births,
    spent,
    capped: pv.capped,
    built: builtThis,
    explosions,
    energyGen: energy.generation,
    energyDemand: energy.generation + energy.deficit,
    energyDeficit: energy.deficit,
    avgCondition: avgCondition(s),
    sparesCoverage,
    housingCapacity: housing,
    n2LeakKg,
    structDiag: sf.diag,
    autonomyByMass,
    event: windowEvent,
    milestones: milestonesThis,
    buffer,
    collapsed: s.collapsed,
  };
  s.chronicle.push(report);
  return report;
}

/** Mean condition across built structure types (1 if nothing built). */
function avgCondition(s: ColonyState): number {
  const ids = Object.keys(s.built).filter((id) => (s.built[id] ?? 0) > 0);
  if (!ids.length) return 1;
  return ids.reduce((a, id) => a + (s.condition[id] ?? 1), 0) / ids.length;
}

// ---- self-sufficiency simulation (D-062) --------------------------------------------------------
// Honest, not analytic: the old per-resource "windows of cover" is a snapshot that can't see
// cascades (ZIP → wear → output, energy → brownout). Instead clone the state and run the REAL
// engine forward with zero new orders — whatever's already in transit still lands (Tsiolkovsky lag
// is physical, cutting future orders doesn't recall a convoy already in flight) — counting windows.

// commitWindow's own milestone check calls bufferRunway (buffer_2), which itself runs commitWindow
// on a clone — without a guard that's unbounded recursive blowup (each simulated window would run
// its OWN buffer_2 check, cloning and simulating again, ad infinitum). This flag makes a simulated
// commitWindow skip that one recursive sub-check; every other milestone check stays cheap and safe.
let simulating = false;

/** Run the real engine on a throwaway clone with zero new orders until `stop` fires or `maxWindows`
 * is reached (saturating cap, so a self-sufficient colony doesn't loop forever). */
function simulateNoImport(s: ColonyState, maxWindows: number, stop: (r: ColonyReport) => boolean): number {
  if (s.pop <= 0) return 0;
  const sim = structuredClone(s);
  // the counterfactual measures the colony's BUFFERS, not its luck: simulated with the real
  // rngState the future would foresee the exact storms/epidemics about to roll (same seed, same
  // sequence) and the gauge would dip BEFORE they hit — a telegraph D-063 forbids. Storyteller off
  // in the sim; effects ALREADY rolling (an ongoing storm is known reality) still apply and decay.
  sim.p = { ...sim.p, eventChanceCap: 0 };
  const wasSimulating = simulating;
  simulating = true;
  try {
    for (let i = 0; i < maxWindows; i++) {
      const r = commitWindow(sim, emptyOrder(), []);
      if (stop(r)) return i;
    }
    return maxWindows;
  } finally {
    simulating = wasSimulating;
  }
}

/** Lookahead cap for the live buffer gauge (D-062) — 12 windows (~26 years) is far past any horizon
 * a player plans against; clearing it means "self-sufficient in every practical sense". */
export const BUFFER_LOOKAHEAD = 12;

/** Windows survivable with zero new imports before the FIRST death (D-062) — the live buffer gauge
 * («запас без завоза»). Saturates at BUFFER_LOOKAHEAD. */
export function bufferRunway(s: ColonyState): number {
  return simulateNoImport(s, BUFFER_LOOKAHEAD, (r) => r.mortality > 0);
}

/** Lookahead cap for the debrief's full collapse runway (D-064/glossary "collapse runway") — 60
 * windows (~130 years) comfortably separates "eventually collapses" from "effectively never". */
export const COLLAPSE_LOOKAHEAD = 60;

/** Windows survivable with zero new imports before full COLLAPSE (D-064/glossary) — the named
 * survival runway, debrief-only. A longer, grimmer sibling of bufferRunway (first death vs the end). */
export function collapseRunway(s: ColonyState): number {
  return simulateNoImport(s, COLLAPSE_LOOKAHEAD, (r) => r.collapsed);
}
