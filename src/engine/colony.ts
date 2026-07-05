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
  padScrapRefund,
  nextRefuelStage,
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
  generationInputGate,
  structureFlows,
  spareUpkeep,
  laborDemand,
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
  M: number; // per-window subsidy (D-021), grows with milestones (D-076) — see ColonyState.subsidyBonus
  inflationMin: number; // D-076: rolled fresh each window, replacing the flat D-031 rate — every
  inflationMax: number; // window is its own economic surprise, not a smooth predictable curve
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
  subsidyBonus: number; // D-076: cumulative $ added to p.M by qualifying milestones — lives in
  // STATE, not params, because save/load always rebuilds p from defaults (colony-save.ts) and this
  // must survive a reload like everything else earned in-game.
  p: ColonyParams;
}

/** Earth order for one window (the slider manifest). */
export interface EarthOrder {
  resources: Partial<Stocks>; // kg to order per resource
  padsToBuild: Record<LaunchTech, number>; // pads to build this window, per class
  padsToScrap: Record<LaunchTech, number>; // D-080: pads to decommission this window, per class —
  // refunds a fraction of capex, relieves the idle-maintenance floor (D-038) that over-building traps you in
  unlockRefuel: boolean; // buy the NEXT refuel R&D stage this window (staged ladder, D-039/D-068)
  colonists: number;
  structures: Partial<Record<string, number>>; // pre-built structures to import (V8, D-057)
}

/** An empty order (no goods, no pads, no colonists, no structure imports). */
export function emptyOrder(): EarthOrder {
  return {
    resources: {},
    padsToBuild: { classic: 0, refuel: 0 },
    padsToScrap: { classic: 0, refuel: 0 },
    unlockRefuel: false,
    colonists: 0,
    structures: {},
  };
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
    inflationMin: 0.01, // D-076: was a flat 3%/window; widened to a rolled 1–7% range per window
    inflationMax: 0.07,
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
    subsidyBonus: 0,
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

/** Can a structure be LOCALLY BUILT now? (prereq already standing AND minPop reached, D-074/075:
 * minPop is a construction-labor gate — a 20-person outpost has no trained crew to erect a reactor
 * from raw steel on-site). */
export function prereqMet(s: ColonyState, id: string): boolean {
  const st = STRUCT_BY_ID[id];
  if (!st) return false;
  const prereqOk = !st.prereq || (s.built[st.prereq] ?? 0) > 0;
  const popOk = !st.minPop || s.pop >= st.minPop;
  return prereqOk && popOk;
}

/** Can a structure be IMPORTED (pre-built from Earth, D-057) right now? Only the structure prereq
 * applies — it ships ready-to-run with no local assembly step, so minPop (a LOCAL build-labor gate)
 * doesn't apply: nobody on Mars needs to erect a turnkey unit from raw materials (D-075). Its
 * ongoing opsCrew still counts once it lands, same as anything built locally. */
export function importPrereqMet(s: ColonyState, id: string): boolean {
  const st = STRUCT_BY_ID[id];
  if (!st) return false;
  return !st.prereq || (s.built[st.prereq] ?? 0) > 0;
}

/** Why a structure is locked right now, if it is (D-074) — prereqMet only answers yes/no; the
 * UI needs to tell "build the prereq first" apart from "grow the colony first". */
export interface LockReason {
  missingStructure?: string; // s.prereq, if that structure isn't standing yet
  minPopNeeded?: number; // st.minPop, if current pop falls short
}
export function lockReason(s: ColonyState, id: string): LockReason | undefined {
  const st = STRUCT_BY_ID[id];
  if (!st) return undefined;
  const missingStructure = st.prereq && (s.built[st.prereq] ?? 0) <= 0 ? st.prereq : undefined;
  const minPopNeeded = st.minPop && s.pop < st.minPop ? st.minPop : undefined;
  return missingStructure || minPopNeeded ? { missingStructure, minPopNeeded } : undefined;
}

// ---- order preview (for the UI manifest) --------------------------------

export interface OrderPreview {
  goodsCost: number;
  colonistCost: number;
  structCost: number; // pre-built structures imported this window (V8, D-057)
  padCapex: number; // capex to build pads this window
  padScrapRefund: number; // D-080: cash refunded for pads decommissioned this window
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

/** D-076: the rate rolled for one specific window — a pure function of (seed, window), not a
 * sequential RNG draw, so it never perturbs the event-roll RNG stream (`s.rngState`) and stays
 * reproducible from `s.window` alone, exactly like the old flat rate — tests that fast-forward by
 * setting `s.window` directly keep working unchanged. */
function windowInflationRate(window: number, seed: number, min: number, max: number): number {
  const mixed = (Math.imul(seed ^ window, 0x9e3779b1) ^ window) >>> 0;
  return min + makeRng(mixed).random() * (max - min);
}

/** Cumulative price multiplier as of the current window — product of every window's own
 * independently-rolled rate (D-076), replacing the old flat compounding (D-031). Window 0 has
 * elapsed no windows yet, so it's always exactly 1 (no inflation), matching prior behavior. */
export function priceMult(s: ColonyState): number {
  let mult = 1;
  for (let w = 1; w <= s.window; w++) {
    mult *= 1 + windowInflationRate(w, s.p.seed, s.p.inflationMin, s.p.inflationMax);
  }
  return mult;
}

/** How many pads of a class an order actually decommissions — clamped so you can never scrap
 * more than you own (D-080). */
function padsScrapped(s: ColonyState, order: EarthOrder, t: LaunchTech): number {
  return Math.min(s.fleet.pads[t], Math.max(0, Math.floor(order.padsToScrap[t])));
}

/** How many pads of a class an order actually builds — refuel only counts once at least the
 * first R&D stage is (being) bought. Shared by fleetAfter and the capex charge (D-080) so build
 * and scrap are ALWAYS priced independently off real counts, never a net delta — otherwise
 * scrapping ≥ what you build in the same order would make the build itself silently free. */
function padsBuilt(s: ColonyState, order: EarthOrder, t: LaunchTech): number {
  const requested = Math.max(0, Math.floor(order.padsToBuild[t]));
  if (t !== 'refuel') return requested;
  const next = nextRefuelStage(s.fleet, s.p.launch);
  const stage = s.fleet.refuelStage + (order.unlockRefuel && next ? 1 : 0);
  return stage > 0 ? requested : 0;
}

/** Apply an order's pad builds/scraps + next-R&D-stage purchase to a fleet copy (no mutation, D-068/080). */
function fleetAfter(s: ColonyState, order: EarthOrder): Fleet {
  const next = nextRefuelStage(s.fleet, s.p.launch);
  const stage = s.fleet.refuelStage + (order.unlockRefuel && next ? 1 : 0);
  return {
    refuelStage: stage,
    pads: {
      classic: s.fleet.pads.classic + padsBuilt(s, order, 'classic') - padsScrapped(s, order, 'classic'),
      refuel: s.fleet.pads.refuel + padsBuilt(s, order, 'refuel') - padsScrapped(s, order, 'refuel'),
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
  // D-080: build and scrap are priced off their own ACTUAL counts, never a net delta — building 3
  // and scrapping 5 in the same order charges capex for the 3 AND refunds the 5, rather than
  // netting to "shrank by 2, nothing changes hands" (which would make the 3 built pads free).
  let padCapex = 0;
  for (const t of TECHS) padCapex += padBuildCost(p.launch, t, padsBuilt(s, order, t));
  padCapex *= mult;
  let padScrapRefundTotal = 0;
  for (const t of TECHS) padScrapRefundTotal += padScrapRefund(p.launch, t, padsScrapped(s, order, t));
  padScrapRefundTotal *= mult;
  const nextStage = nextRefuelStage(s.fleet, p.launch);
  const rndCost = order.unlockRefuel && nextStage ? nextStage.stage.cost * mult : 0;

  const plan = shipPlan(futureFleet, p.launch, mass);
  const maintCost = padMaintTotal(futureFleet, p.launch) * mult; // idle-pad upkeep (D-038) — owed
  // regardless of what ships this window, same as every other pad already built
  const launchTotal = plan.flightCost * mult + maintCost;
  const throughput = throughputMass(futureFleet, p.launch);

  const total = Math.max(
    0,
    goodsCost + colonistCost + struct.cost + padCapex + rndCost + launchTotal - padScrapRefundTotal,
  );
  // subsidy_cut (D-063): an active event can shrink the window's effective budget;
  // subsidyBonus (D-076): milestones raise the baseline itself, permanently
  const budget = (p.M + s.subsidyBonus) * effectMultiplier(s.activeEffects, 'subsidy');
  // D-079: mandatory idle-pad maintenance alone must never block committing — a colony that asked
  // for NOTHING beyond upkeep on its existing fleet has to be able to let the window pass, or an
  // over-built fleet (D-038's own "idle capital" trap) plus unbounded inflation (D-076) can wedge
  // the game into a permanent soft-lock with no possible feasible order, not even an empty one.
  // Anything genuinely requested beyond that floor is still checked against budget as before.
  const discretionary = total - maintCost;
  return {
    goodsCost,
    colonistCost,
    structCost: struct.cost,
    padCapex,
    padScrapRefund: padScrapRefundTotal,
    rndCost,
    launchTotal,
    total,
    mass,
    throughput,
    capped: mass > throughput,
    overBudget: discretionary > 0 && total > budget,
    budget,
    effPerKg: mass > 0 ? (launchTotal + padCapex) / mass : 0,
    futureFleet,
  };
}

// ---- the window ---------------------------------------------------------

/** Named mortality cause for the chronicle (D-061): the binding life-support resource (Liebig),
 * energy brownout, or an epidemic event (D-063). */
export type MortalityCause = ResourceKind | 'energy' | 'epidemic' | 'breach' | 'radiation' | 'crash';

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
  demolished: string[]; // D-081: structures torn down this window
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
  subsidyBonus?: number; // D-076: permanent $ added to the subsidy when first achieved — a dry
  // economic fact (Earth funds a proven colony more), not a "reward" banner; still no win state,
  // still a checklist first (D-064) — reserved for milestones that demonstrate genuine SCALE, not
  // early/automatic/luck ones (first landing, first birth, surviving an event get none).
}

/** Order matches D-064's decision text. `zero_import` is the "finale-boss" — full independence
 * (D-046) as a visible far star, never an ending. */
export const MILESTONES: readonly MilestoneSpec[] = [
  { id: 'first_landing', name: 'Первая высадка', icon: '🛬' },
  { id: 'first_birth', name: 'Первое рождение', icon: '🐣' },
  { id: 'pop_100', name: '100 колонистов', icon: '👥', subsidyBonus: 3.0e9 },
  { id: 'bulk_autonomy', name: 'Балк-автономия', icon: '🌾', subsidyBonus: 3.0e9 },
  { id: 'buffer_2', name: 'Запас без завоза ≥ 2 окон', icon: '🛡', subsidyBonus: 2.0e9 },
  { id: 'event_survived', name: 'Пережили событие без потерь', icon: '🕊' },
  { id: 'refuel_unlocked', name: 'Орбитальная заправка', icon: '⛽', subsidyBonus: 4.0e9 },
  { id: 'zero_import', name: 'Окно без единого завоза', icon: '🌌', subsidyBonus: 3.0e9 },
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
export function commitWindow(
  s: ColonyState,
  order: EarthOrder,
  build: string[] = [],
  demolish: string[] = [], // D-081: Mars structures to tear down this window, one entry per unit —
  // money-free (command economy, D-054), same shape as `build`; costs one-time colonist labor,
  // recycles a fraction of buildMaterials back to local stock
): ColonyReport {
  const p = s.p;
  // price the order at the window the player planned it in — BEFORE advancing — so the preview
  // shown in the UI/CLI is exactly the charge; incrementing first silently repriced everything
  // +1 inflation step and let near-budget orders pass the plan() check yet die inside commit
  const pv = previewOrder(s, order);
  s.window += 1;

  // Mars build plan: materials + prerequisites only — command economy, no money capex (D-054).
  // The dollar (subsidy) is Earth-side procurement; building on Mars costs local materials + labour.
  const matNeed = marsPlanMaterials(build);
  const materialsOk = (Object.keys(matNeed) as ResourceKind[]).every(
    (r) => s.stocks[r] >= (matNeed[r] ?? 0),
  );
  const importIds = Object.keys(order.structures).filter((id) => (order.structures[id] ?? 0) > 0);
  // imports skip the minPop labor gate (D-075) — a turnkey unit ships pre-built, no local crew to erect it
  const prereqsOk = build.every((id) => prereqMet(s, id)) && importIds.every((id) => importPrereqMet(s, id));
  // R&D needs Mars presence already established (D-077) — "campaigns" testing propellant transfer/EDL
  // are meaningless with nobody there to run them; everHadPop = at least one colonist has landed, ever.
  const rndOk = !order.unlockRefuel || s.everHadPop;
  // D-078: same principle, wider — nothing ships to Mars ALONE before population is ever
  // established (no free pre-colonist stockpiling of materials/structures/pads); the first
  // shipment of anything else must carry colonists in the SAME order. Once population has ever
  // existed, cargo flows freely again (an established colony still needs feeding forever).
  const shippingCargo =
    RESOURCES.some((r) => Math.max(0, order.resources[r] ?? 0) > 0) ||
    importIds.length > 0 ||
    Math.max(0, Math.floor(order.padsToBuild.classic)) > 0 ||
    Math.max(0, Math.floor(order.padsToBuild.refuel)) > 0;
  const bootstrapOk = !shippingCargo || s.everHadPop || Math.floor(order.colonists) > 0;

  const feasible = !pv.overBudget && !pv.capped && materialsOk && prereqsOk && rndOk && bootstrapOk;
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

  // solar_flare (D-072): SPE — the colony shelters under regolith for the window: ALL structure
  // output and generation take the hit at once (the "cascade" disaster class), same-window like
  // the other Mars-physical events.
  let allMult = 1;
  if (roll?.spec.effect === 'radiation') {
    allMult = 1 - roll.mag;
    genMult *= 1 - roll.mag;
  }

  // struct_outage (D-072): one working organ of the colony stops cold (MOXIE, recycler, farm…).
  // Candidates are built structure types that actually produce/consume something — pure power
  // plants stay the dust storm's prey, housing has nothing to stop. Lingering outages from past
  // windows keep the same type down via activeEffects.
  const outMult: Record<string, number> = {};
  for (const e of s.activeEffects) {
    if (e.effect === 'outage' && e.windowsLeft > 0 && e.target) outMult[e.target] = 0;
  }
  let outageTarget: string | undefined;
  if (roll?.spec.effect === 'outage') {
    const candidates = Object.keys(s.built).filter((id) => {
      const spec = STRUCT_BY_ID[id];
      return (
        (s.built[id] ?? 0) > 0 &&
        spec !== undefined &&
        (Object.keys(spec.produces).length > 0 || Object.keys(spec.consumes).length > 0)
      );
    });
    if (candidates.length > 0) {
      outageTarget = rng.choice(candidates);
      outMult[outageTarget] = 0;
    }
  }

  // convoy_crash (D-072): EDL failure — the convoy the player has watched "в пути" burns on entry.
  // A rolled fraction of everything aboard is lost the moment it lands; colonists aboard die (named
  // cause `crash`, they never join s.pop). `landed` keeps the PRE-crash manifest: zero_import must
  // judge what was SENT, not what survived.
  let landedEff = landed;
  let crashDeaths = 0;
  let crashLostKg = 0;
  if (roll?.spec.effect === 'crash') {
    const keep = 1 - roll.mag;
    const kept = emptyStocks(0);
    for (const r of RESOURCES) {
      const v = landed.stocks[r] ?? 0;
      kept[r] = v * keep;
      crashLostKg += v - kept[r];
    }
    const keptStructures: Record<string, number> = {};
    for (const id of Object.keys(landed.structures)) {
      keptStructures[id] = Math.round((landed.structures[id] ?? 0) * keep);
    }
    crashDeaths = Math.round(landed.colonists * roll.mag);
    landedEff = { stocks: kept, colonists: landed.colonists - crashDeaths, structures: keptStructures };
  }

  const demolishedThis: string[] = [];
  let demolitionLaborThisWindow = 0; // D-081: one-time surge added to this window's labor demand below

  if (feasible) {
    // apply pad builds + refuel unlock (futureFleet already computed in the preview)
    s.fleet = { refuelStage: pv.futureFleet.refuelStage, pads: { ...pv.futureFleet.pads } };
    // build structures: consume local materials, raise counts
    for (const r of Object.keys(matNeed) as ResourceKind[]) s.stocks[r] -= matNeed[r] ?? 0;
    for (const id of build) {
      if (STRUCT_BY_ID[id]) {
        s.built[id] = (s.built[id] ?? 0) + 1;
        if (s.condition[id] === undefined) s.condition[id] = 1; // fresh type starts at full condition
        builtThis.push(id);
      }
    }

    // demolish structures (D-081): recycle a fraction of their build materials back to stock, and
    // charge the one-time teardown labor against this window's shared labor pool (laborRatio below)
    for (const id of demolish) {
      const spec = STRUCT_BY_ID[id];
      if (!spec || (s.built[id] ?? 0) <= 0) continue;
      s.built[id] -= 1;
      demolitionLaborThisWindow += spec.demolishCrew ?? 0;
      const recycle = spec.recycleFrac ?? 0;
      for (const r of Object.keys(spec.buildMaterials) as ResourceKind[]) {
        s.stocks[r] += (spec.buildMaterials[r] ?? 0) * recycle;
      }
      demolishedThis.push(id);
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

  // colonists from the landed convoy arrive (post-crash survivors, D-072)
  s.pop += landedEff.colonists;

  // imported structures from the landed convoy arrive ready-to-run (no local assembly step, D-057)
  for (const id of Object.keys(landedEff.structures)) {
    const n = landedEff.structures[id] ?? 0;
    if (n <= 0 || !STRUCT_BY_ID[id]) continue;
    s.built[id] = (s.built[id] ?? 0) + n;
    if (s.condition[id] === undefined) s.condition[id] = 1;
    for (let i = 0; i < n; i++) builtThis.push(id);
  }

  // available resources this window = stock + landed convoy
  const avail: Partial<Stocks> = {};
  for (const r of RESOURCES) avail[r] = s.stocks[r] + (landedEff.stocks[r] ?? 0);

  // wear (V6): spares maintain condition; shortfall → structures degrade (output falls → cascade)
  const upkeep = spareUpkeep(s.built);
  const sparesCoverage = upkeep > 0 ? Math.min(1, (avail.spares ?? 0) / upkeep) : 1;
  for (const s2 of Object.keys(s.built)) {
    if ((s.built[s2] ?? 0) <= 0) continue;
    const c = s.condition[s2] ?? 1;
    s.condition[s2] = Math.max(0, Math.min(1, c - p.wearRate * (1 - sparesCoverage)));
  }

  // labor (D-075): total colonist-hours the colony's built structures need to stay staffed, vs what's
  // actually on hand — recomputed fresh every window from CURRENT pop, not a persistent per-structure
  // assignment: a mass-casualty event thins every structure's output proportionally the same window,
  // no "who got reassigned first" bookkeeping. Folded into the existing uniform-throttle slots
  // (genMult/allMult) rather than a new parameter — same shape as solar_flare's allMult.
  // pop===0 is "not colonized yet", not "workforce wiped out" — a robotically pre-deployed
  // solar_plant sitting there before the first colonists ever land must not read as a total
  // blackout; the mechanic is meant to catch DEGRADATION from an established headcount, not the
  // absence of any headcount ever having existed (same absence≠penalty convention as condOf/energyPower).
  const laborNeed = laborDemand(s.built) + demolitionLaborThisWindow; // D-081: teardown is a surge, not a persistent job
  const laborRatio = s.pop > 0 && laborNeed > 0 ? Math.min(1, s.pop / laborNeed) : 1;
  genMult *= laborRatio;
  allMult *= laborRatio;

  // energy (priority brownout) + input availability (hi-tech) + condition (wear) → structure output;
  // dust_storm/blight (D-063) throttle generation/food-producers via genMult/farmMult above;
  // struct_outage/solar_flare (D-072) via outMult/allMult; a reactor out of fuel (D-074) via genGate;
  // understaffed colony (D-075) via genMult/allMult too (laborRatio folded in just above)
  const lifeSupportDemand = p.popEnergyPerCapita * s.pop;
  const genGate = generationInputGate(s.built, s.condition, avail);
  const energy = resolveColonyEnergy(s.built, lifeSupportDemand, s.condition, genMult, genGate);
  const sf = structureFlows(s.built, energy.served, avail, s.condition, farmMult, outMult, allMult);

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
    arrivals: landedEff.stocks,
    production: sf.production,
    consumption: combinedCons,
    recycleEff: recycle,
  });
  s.stocks = stocks;

  // hull_breach (D-072): decompression vents a rolled fraction of the N₂ bank the same window —
  // the stock hit lands after flows resolve (the hole doesn't care what the recyclers did today)
  if (roll?.spec.effect === 'breach') {
    s.stocks.n2 = Math.max(0, s.stocks.n2 * (1 - roll.mag));
  }

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
  // hull_breach casualties (D-072): decompression deaths, patch crews cut them down with the parts
  // they actually have on hand — the same ЗИП that maintains condition doubles as damage control.
  // Graduated by sparesCoverage rather than a covered/uncovered binary (playtest-3): autoSpares
  // floors the order at EXACT upkeep, and the 1-window shipping lag means colonies that grow between
  // orders sit at ~0.85-0.95 coverage almost permanently — a >=1 cliff would pay out the full
  // uncovered deathMag nearly every time regardless of how well-stocked the player actually is.
  let breachFrac = 0;
  if (roll?.spec.effect === 'breach') {
    breachFrac = roll.spec.deathMag - (roll.spec.deathMag - roll.spec.coveredMag) * sparesCoverage;
  }
  // solar_flare casualties (D-072): acute radiation — medbay + pharma (anti-rad meds) cover it
  // like an epidemic, with the same one-time pharma draw.
  let radFrac = 0;
  let radCovered = false;
  if (roll?.spec.effect === 'radiation') {
    radCovered = (s.built['medbay'] ?? 0) > 0 && (avail['pharma'] ?? 0) > 0;
    radFrac = radCovered ? roll.spec.coveredMag : roll.spec.deathMag;
  }

  const mortality =
    s.pop *
    (1 - (1 - consumableFrac) * (1 - energyFrac) * (1 - epidemicFrac) * (1 - breachFrac) * (1 - radFrac));
  s.pop -= mortality;
  if ((epidemicCovered || radCovered) && roll) {
    s.stocks.pharma = Math.max(0, s.stocks.pharma - roll.spec.pharmaCost * s.pop);
  }

  // named attribution (D-061): split `mortality` between its independent risks proportionally to
  // their (pre-combination) fractions — consumableFrac has exactly one binding resource (Liebig).
  // Crash deaths (D-072) sit OUTSIDE the soft-OR: those colonists died on entry, never joined s.pop.
  const mortalityBreakdown: Partial<Record<MortalityCause, number>> = {};
  const causeWeight = consumableFrac + energyFrac + epidemicFrac + breachFrac + radFrac;
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
    if (breachFrac > 0) {
      mortalityBreakdown.breach = Math.round(mortality * (breachFrac / causeWeight));
    }
    if (radFrac > 0) {
      mortalityBreakdown.radiation = Math.round(mortality * (radFrac / causeWeight));
    }
  }
  if (crashDeaths > 0) mortalityBreakdown.crash = crashDeaths;

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
    importedMass += landedEff.stocks[r] ?? 0;
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
  } else if (roll && roll.spec.effect === 'outage' && outageTarget && roll.dur > 1) {
    // the knocked-out type stays down for the remainder (bit this window already, like storms)
    s.activeEffects.push({ id: roll.spec.id, effect: 'outage', mag: roll.mag, windowsLeft: roll.dur - 1, target: outageTarget });
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
    if (roll.spec.effect === 'breach') {
      windowEvent.coverage = sparesCoverage;
      windowEvent.deaths = mortalityBreakdown.breach ?? 0;
    }
    if (roll.spec.effect === 'radiation') {
      windowEvent.covered = radCovered;
      windowEvent.deaths = mortalityBreakdown.radiation ?? 0;
    }
    if (roll.spec.effect === 'outage') windowEvent.target = outageTarget;
    if (roll.spec.effect === 'crash') {
      windowEvent.deaths = crashDeaths;
      windowEvent.lostKg = Math.round(crashLostKg);
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
      // D-076: a qualifying milestone permanently raises the subsidy baseline — Earth funds a
      // colony that's demonstrated real scale/viability more than a fresh outpost.
      const bonus = MILESTONES.find((m) => m.id === id)?.subsidyBonus;
      if (bonus) s.subsidyBonus += bonus;
    }
  };
  // buffer gauge measured once per REAL window (the simulating guard stops the recursion — the
  // gauge itself runs commitWindow on a clone) — stored in the report so the store reads it for
  // free and the debrief gets a historical series (D-062/D-064).
  const buffer = simulating ? undefined : bufferRunway(s);
  if (landedEff.colonists > 0) mark('first_landing'); // someone must land ALIVE (D-072 crash)
  if (births > 0) mark('first_birth');
  if (s.pop >= 100) mark('pop_100');
  if (bulkAutonomyOk) mark('bulk_autonomy');
  if (buffer !== undefined && buffer >= 2) mark('buffer_2');
  // "survive an event with zero deaths" counts only windows where a DEADLY effect actually applied:
  // a storm/blight throttling output, an epidemic, or the supply gap a skipped convoy left behind.
  // Economic events (subsidy/price) can't kill in their own window — surviving them is no feat.
  const deadlyApplied =
    genMult < 1 ||
    farmMult < 1 ||
    allMult < 1 ||
    Object.keys(outMult).length > 0 ||
    roll?.spec.effect === 'epidemic' ||
    roll?.spec.effect === 'breach' ||
    (roll?.spec.effect === 'crash' && (landed.colonists > 0 || crashLostKg > 0)) ||
    skipGapWindow;
  if (deadlyApplied && mortality === 0 && crashDeaths === 0 && s.pop > 0) mark('event_survived');
  if (s.fleet.refuelStage > 0) mark('refuel_unlocked'); // first rung — the demo campaigns (D-068)
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
    landed: landedEff, // what actually arrived (post-crash, D-072) — the event line reports the loss
    deficit,
    mortality: Math.round(mortality) + crashDeaths,
    mortalityBreakdown,
    births,
    spent,
    capped: pv.capped,
    built: builtThis,
    demolished: demolishedThis,
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
