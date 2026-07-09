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
  padScrapCost,
  nextRefuelStage,
  TECHS,
  type Fleet,
  type LaunchParams,
  type LaunchTech,
} from './logistics';
import { makeRng } from './rng';
import {
  colonistRng,
  newArrival,
  newborn,
  probRound,
  removeRandom,
  shuffle,
  workforceCount,
  YEARS_PER_WINDOW,
  shieldAttenuation,
  effectiveDeathAge,
  type Colonist,
  type DemographicParams,
} from './colonists';
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
  shieldCapacity,
  sickBedCapacity,
  foodSpoilRateMult,
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
import { TECH_BY_ID, techMods, techBuyable } from './techs';

/** Per-resource catalog: earth price ($/kg) + per-capita life-support consumption (kg/window). */
export interface ResourceSpec {
  earthPerKg: number;
  perCapita: number; // life-support draw per colonist per window (0 = not life-support)
  recycle: number; // η recovered fraction (ECLSS)
  tare: number; // extra SHIP mass per kg for containment (gases: tank ≥ gas → ~1.0). Imports only.
  spoilRate: number; // D-085: passive fraction lost per window (food/pharma only; 0 = doesn't spoil)
  localOnly: boolean; // D-089 (P1): ISRU intermediate (regolith/hydrogen/co2) — produced AND
  // consumed on Mars, physically absurd to ship; previewOrder ignores any qty ordered for it.
}

export type ResourceCatalog = Record<ResourceKind, ResourceSpec>;

export interface ColonyParams extends DemographicParams {
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
  repairRate: number; // D-084: condition gained/window from spares ordered BEYOND upkeep, capped
  // at one extra upkeep's worth per window — deliberately a THIRD of wearRate: repair is heavier
  // than maintenance, not a free undo of neglect (D-052's pressure survives this).
  birthRate: number; // per-window growth when a supplied medbay is running (D-030)
  minSpoilRate: number; // D-085: floor on food's spoilage rate after food_silo multipliers —
  // spoilage pressure never fully zeroes out, same D-052 philosophy as repairRate never undoing wear for free
  baseFoodCapacity: number; // D-085: store-layer stockpile ceiling for food with zero storage built
  baseWaterCapacity: number; // D-085: same, for water
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
  pop: number; // derived: always colonists.length (kept for every existing read site)
  colonists: Colonist[]; // D-083: the population, one entry per person — age/deathAge/illness
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
  techs: string[]; // roadmap-2/V8 scaffold: ids of bought techs (data/techs.csv) — [] until content
  // exists (the CSV ships with zero rows); techMods() folds this into neutral multipliers either way
  industryOutput: Record<string, number>; // D-089 (P1): cumulative kg EVER produced, by structure
  // type (all built units of that type share one counter — one deposit, one learning curve) — read
  // by industryMult() for depletion/ramp-up; {} for every type without depletionScale/rampScale
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
  unlockTech?: string; // roadmap-2/V8 scaffold: buy this one tech (data/techs.csv) this window —
  // at most one per window, an R&D-ladder-style "sacrifice window" (D-068); undefined = none
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
      spoilRate: num(row.spoilRate),
      localOnly: num(row.localOnly) === 1,
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
    repairRate: 0.04, // D-084: a third of wearRate — restoring from 0.5 needs ~12 windows of double ЗИП
    birthRate: 0.05,
    // D-085: spoilage — food/pharma decay rates live in resources.csv (spoilRate), calibrated via
    // real-world shelf-life half-lives (see decision text). These three are the mitigation knobs.
    minSpoilRate: 0.05, // floor after food_silo multipliers — never fully undoable
    // D-085 recalibrated twice from an initial ~1-window-for-100 target: that clipped both routine
    // bootstrap-scale orders AND the LIFE-SUPPORT BUFFER newColony() itself seeds from pop0 ×
    // startStockWindows (e.g. 1000 × 14 × 500 kg/capita = 7 000 000 kg, an entirely normal starting
    // colony, not hoarding). The store-layer cap only ever gates NEW orders (D-056 pattern, engine
    // itself never checks it) — but if a colony's own starting buffer already exceeds the cap,
    // maxFoodStock() correctly reports zero headroom and silently clips every subsequent order,
    // which is exactly what broke here. Spoilage remains the PRIMARY anti-hoarding lever regardless
    // of stock size; this ceiling is sized generously enough to stay out of the way of any
    // reasonably-sized colony's own life support, only biting at genuinely excessive stockpiling.
    baseFoodCapacity: 10000000,
    baseWaterCapacity: 30000000,
    // D-083 demographics (individual colonists). illnessProb is 0.03, not the spec's 0.05: with
    // cureProb 0.5 even a fully-bedded colony loses P/2 per window to illness, and at 0.05 the
    // REALIZED life expectancy (illness + old age together) sagged to ≈55 against the agreed 60.
    // At 0.03: ~1.5%/window illness + ~3.6%/window old-age at steady state ≈ 5.1% vs birthRate 5% —
    // births alone barely hold the line, a trickle of imports stays necessary (D-076 thesis).
    illnessProb: 0.03,
    cureProb: 0.5,
    pharmaPerTreatment: 20, // kg per treated case — noise next to a medbay's 2000/window bulk draw,
    // but a colony at literal zero pharma treats nobody (D-083: the bed alone doesn't cure)
    arrivalAgeMean: 30,
    arrivalAgeSd: 2.5,
    arrivalAgeMin: 25,
    arrivalAgeMax: 35,
    lifeExpectancy: 60,
    lifeExpectancySd: 5,
    adultAge: 16, // ≈7.4 windows from birth to the labor pool — births finally cost something
    // D-094: chronic dose (GCR) — real-world anchor ~250 mSv/yr unshielded surface
    // (gaps-vs-reality.md) × YEARS_PER_WINDOW (2.17) ≈ 0.54 Sv/window, rounded to a TOY 0.5.
    chronicDoseSvPerWindow: 0.5,
    shieldFloor: 0.15, // GCR barely attenuates even through regolith — coverage never zeroes it
    radiationLifespanPerSv: 3, // TOY order-of-magnitude on real chronic-exposure life-shortening estimates
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
  // pop0 arrives as individuals (D-083) — rolled off window 0's colonist stream, so a fresh
  // colony with the same seed always starts with the same people
  const crng = colonistRng(p.seed, 0);
  const colonists: Colonist[] = [];
  for (let i = 0; i < Math.floor(p.pop0); i++) colonists.push(newArrival(crng, p));
  return {
    window: 0,
    pop: colonists.length,
    colonists,
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
    techs: [],
    industryOutput: {},
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

/** D-088 (P0): can `id` be built/imported given the techs owned so far? Pure and CSV-content-
 * agnostic — with `techGate` blank (every row today) this is always true, so the whole P0 gate
 * is a no-op until P1+ actually sets a `techGate` on some structure. */
export function techGateMet(techGate: string | undefined, techs: readonly string[]): boolean {
  return !techGate || techs.includes(techGate);
}

/** Can a structure be LOCALLY BUILT now? (prereq already standing AND minPop reached, D-074/075:
 * minPop is a construction-labor gate — a 20-person outpost has no trained crew to erect a reactor
 * from raw steel on-site; D-088: an ungated `techGate` tech must also be owned). */
export function prereqMet(s: ColonyState, id: string): boolean {
  const st = STRUCT_BY_ID[id];
  if (!st) return false;
  const prereqOk = !st.prereq || (s.built[st.prereq] ?? 0) > 0;
  const popOk = !st.minPop || s.pop >= st.minPop;
  const specialistsOk = !st.minSpecialists || s.stocks.specialists >= st.minSpecialists;
  return prereqOk && popOk && specialistsOk && techGateMet(st.techGate, s.techs);
}

/** Can a structure be IMPORTED (pre-built from Earth, D-057) right now? The structure prereq, tech
 * gate, AND minSpecialists all apply — but NOT minPop: it ships ready-to-run with no local assembly
 * step, so minPop (a LOCAL build-labor gate) doesn't apply — nobody on Mars needs to erect a
 * turnkey unit from raw materials (D-075). Its ongoing opsCrew still counts once it lands, same as
 * anything built locally. The tech gate DOES apply to imports too (D-088) — a `techGate`'d design
 * is proprietary/unbuilt tech, not something Earth can just ship you around the gate. `minSpecialists`
 * (D-093) applies too, unlike `minPop` — a turnkey unit still needs trained crew to OPERATE it,
 * regardless of who assembled it. */
export function importPrereqMet(s: ColonyState, id: string): boolean {
  const st = STRUCT_BY_ID[id];
  if (!st) return false;
  const specialistsOk = !st.minSpecialists || s.stocks.specialists >= st.minSpecialists;
  return (!st.prereq || (s.built[st.prereq] ?? 0) > 0) && specialistsOk && techGateMet(st.techGate, s.techs);
}

/** Why a structure is locked right now, if it is (D-074) — prereqMet only answers yes/no; the
 * UI needs to tell "build the prereq first" apart from "grow the colony first" apart from "buy the
 * tech first" (D-088) apart from "train specialists first" (D-093). */
export interface LockReason {
  missingStructure?: string; // s.prereq, if that structure isn't standing yet
  minPopNeeded?: number; // st.minPop, if current pop falls short
  missingTech?: string; // st.techGate, if that tech isn't owned yet (D-088)
  minSpecialistsNeeded?: number; // st.minSpecialists, if the pool falls short (D-093)
}
export function lockReason(s: ColonyState, id: string): LockReason | undefined {
  const st = STRUCT_BY_ID[id];
  if (!st) return undefined;
  const missingStructure = st.prereq && (s.built[st.prereq] ?? 0) <= 0 ? st.prereq : undefined;
  const minPopNeeded = st.minPop && s.pop < st.minPop ? st.minPop : undefined;
  const missingTech = st.techGate && !techGateMet(st.techGate, s.techs) ? st.techGate : undefined;
  const minSpecialistsNeeded =
    st.minSpecialists && s.stocks.specialists < st.minSpecialists ? st.minSpecialists : undefined;
  return missingStructure || minPopNeeded || missingTech || minSpecialistsNeeded
    ? { missingStructure, minPopNeeded, missingTech, minSpecialistsNeeded }
    : undefined;
}

// ---- order preview (for the UI manifest) --------------------------------

export interface OrderPreview {
  goodsCost: number;
  colonistCost: number;
  structCost: number; // pre-built structures imported this window (V8, D-057)
  padCapex: number; // capex to build pads this window
  padScrapCost: number; // D-082: net cost to decommission pads this window (not a refund)
  rndCost: number; // refuel R&D unlock this window
  techCost: number; // roadmap-2/V8 scaffold: unlockTech purchase this window — 0 while techs.csv is empty
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
    // D-089: a localOnly ISRU intermediate (regolith/hydrogen/co2) can't be ordered from Earth at
    // all — same "blind/stale request silently costs nothing" pattern as techOk/rndOk below, not a
    // hard validation error, so a stray qty in a draft/save never bills or ships.
    if (p.catalog[r].localOnly) continue;
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
  // D-080/082: build and scrap are priced off their own ACTUAL counts, never a net delta — building
  // 3 and scrapping 5 in the same order charges capex for the 3 AND the decommission cost for the
  // 5, rather than netting to "shrank by 2, nothing changes hands" (which would make the 3 built
  // pads free).
  let padCapex = 0;
  for (const t of TECHS) padCapex += padBuildCost(p.launch, t, padsBuilt(s, order, t));
  padCapex *= mult;
  let padScrapCostTotal = 0;
  for (const t of TECHS) padScrapCostTotal += padScrapCost(p.launch, t, padsScrapped(s, order, t));
  padScrapCostTotal *= mult;
  const nextStage = nextRefuelStage(s.fleet, p.launch);
  const rndCost = order.unlockRefuel && nextStage ? nextStage.stage.cost * mult : 0;
  // roadmap-2/V8 scaffold: unlockTech is priced like the R&D ladder — inflation-adjusted, and only
  // charged if the tech is actually buyable (feasibility re-checks this too, same as rndCost/nextStage)
  const techCost =
    order.unlockTech && techBuyable(order.unlockTech, s.techs, s.built, s.pop, s.everHadPop)
      ? (TECH_BY_ID[order.unlockTech]?.cost ?? 0) * mult
      : 0;

  const plan = shipPlan(futureFleet, p.launch, mass);
  const maintCost = padMaintTotal(futureFleet, p.launch) * mult; // idle-pad upkeep (D-038) — owed
  // regardless of what ships this window, same as every other pad already built
  const launchTotal = plan.flightCost * mult + maintCost;
  const throughput = throughputMass(futureFleet, p.launch);

  const total = goodsCost + colonistCost + struct.cost + padCapex + padScrapCostTotal + rndCost + techCost + launchTotal;
  // subsidy_cut (D-063): an active event can shrink the window's effective budget;
  // subsidyBonus (D-076): milestones raise the baseline itself, permanently
  const budget = (p.M + s.subsidyBonus) * effectMultiplier(s.activeEffects, 'subsidy');
  // D-079: mandatory idle-pad maintenance alone must never block committing — a colony that asked
  // for NOTHING beyond upkeep on its existing fleet has to be able to let the window pass, or an
  // over-built fleet (D-038's own "idle capital" trap) plus unbounded inflation (D-076) can wedge
  // the game into a permanent soft-lock with no possible feasible order, not even an empty one.
  // D-082: the cost of SHRINKING that same fleet gets the same exemption — otherwise an extreme
  // enough D-079 scenario could make the escape valve itself unaffordable (scrap cost scales with
  // the same inflated capex driving the ruinous maintenance in the first place). Both are real,
  // nonzero charges reflected in `total`/`spent` — just never a reason to reject the whole order.
  // Anything genuinely NEW requested beyond that floor is still checked against budget as before.
  const discretionary = total - maintCost - padScrapCostTotal;
  return {
    goodsCost,
    colonistCost,
    structCost: struct.cost,
    padCapex,
    padScrapCost: padScrapCostTotal,
    rndCost,
    techCost,
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
 * energy brownout, illness / old age (D-083), or a violent event (D-072). An epidemic no longer
 * has its own cause — it spikes the illness probability, so its toll IS `illness`. */
export type MortalityCause =
  | ResourceKind
  | 'energy'
  | 'illness'
  | 'old_age'
  | 'breach'
  | 'radiation'
  | 'crash';

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
  workforce: number; // D-083: able-bodied adults at window's end — the D-075 labor pool
  kids: number; // D-083: colonists under adultAge at window's end (eat, don't work)
  sick: number; // D-083: in the active illness stage at window's end (recover or die next window)
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
  repairSpentKg: number; // D-084: spares spent on repair (beyond upkeep) this window — 0 if none
  foodSpoiledKg: number; // D-085: food lost to passive spoilage this window — 0 if none
  pharmaSpoiledKg: number; // D-085: pharma lost to passive spoilage this window — 0 if none
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
  | 'zero_import'
  | 'local_metals' // D-089/D-091: first mre_plant — steel no longer only from imported ingots
  | 'local_construction' // D-090/D-091: first sinter_plant — habitat volume no longer only steel/glass
  | 'local_fabrication' // D-091: first fab_shop — components no longer only imported
  | 'local_spares'; // D-091: first machine_shop — spares floor no longer 100% imported

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
  // D-089/D-090/D-091 (tech tree): each marks a whole import dependency cracking open for the
  // first time — genuine industrial scale, not luck/automatic, same subsidyBonus criterion as pop_100/bulk_autonomy.
  { id: 'local_metals', name: 'Местные металлы (MRE)', icon: '⛏️', subsidyBonus: 2.0e9 },
  { id: 'local_construction', name: 'Стройка из реголита', icon: '🧱', subsidyBonus: 2.0e9 },
  { id: 'local_fabrication', name: 'Местная фабрикация', icon: '🏭', subsidyBonus: 2.5e9 },
  { id: 'local_spares', name: 'Местный ЗИП', icon: '🔧', subsidyBonus: 2.5e9 },
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

  // ---- demographics, phase A (D-083): resolve LAST window's sick, then age everyone ----------
  // All colonist rolls this window draw from a dedicated (seed, window) stream — never from the
  // event RNG (`s.rngState`), same isolation as windowInflationRate (D-076).
  // The doomed (no bed, no pharma, or the cure roll failed) die now — the spec's "умирает в
  // следующее окно"; the rest of the sick recover and rejoin the labor pool. Then everyone lives
  // through 26 months; whoever crosses their pre-rolled natural-death age dies of old age.
  const crng = colonistRng(p.seed, s.window);
  let illnessDeaths = 0;
  let oldAgeDeaths = 0;
  s.colonists = s.colonists.filter((c) => {
    if (c.doomed) {
      illnessDeaths += 1;
      return false;
    }
    c.sick = false;
    return true;
  });
  for (const c of s.colonists) c.age += YEARS_PER_WINDOW;

  // D-094: chronic dose (GCR) — deterministic accrual every window (like wearRate/spoilRate, NOT
  // a storyteller roll), scaled by shield_berm's capacity-based coverage (never fully to zero —
  // GCR barely attenuates even through regolith). Computed here, BEFORE the old-age check, so a
  // severe cumulative dose can push someone's EFFECTIVE deathAge below their current age the same
  // window; `shieldCoverage` stays in scope for solar_flare's mitigation later in this function
  // (D-094 p.7 — same physical shielding, doing double duty).
  const shieldCoverage = s.colonists.length > 0 ? Math.min(1, shieldCapacity(s.built) / s.colonists.length) : 1;
  const doseThisWindow = p.chronicDoseSvPerWindow * shieldAttenuation(shieldCoverage, p.shieldFloor);
  for (const c of s.colonists) c.radiationDose += doseThisWindow;

  s.colonists = s.colonists.filter((c) => {
    if (c.age >= effectiveDeathAge(c, p)) {
      oldAgeDeaths += 1;
      return false;
    }
    return true;
  });
  s.pop = s.colonists.length;

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
  // roadmap-2/V8 scaffold: same "everything blind rejects, nothing charges" pattern as rndOk —
  // techBuyable also checks prereqTech/prereqStructure/minPop, so a stale or already-bought id
  // (e.g. the draft wasn't cleared after a save/load with a shrunk tree) fails closed, not silently.
  const techOk = !order.unlockTech || techBuyable(order.unlockTech, s.techs, s.built, s.pop, s.everHadPop);

  const feasible = !pv.overBudget && !pv.capped && materialsOk && prereqsOk && rndOk && techOk && bootstrapOk;
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
  // dust_storm (D-086): addressable — only `stormVulnerable` generation (solar) takes the hit;
  // a reactor is a shielded, storm-immune baseload. Both the active roll and any lingering
  // remainder from a multi-window storm go through this SAME multiplier (else window 2 of a
  // 2-window storm would "release" the reactor that was never gated to begin with).
  let stormMult = effectMultiplier(s.activeEffects, 'energy');
  let farmMult = effectMultiplier(s.activeEffects, 'farm');
  if (roll?.spec.effect === 'energy') stormMult *= 1 - roll.mag;
  if (roll?.spec.effect === 'farm') farmMult *= 1 - roll.mag;

  // genMult stays a UNIFORM generation multiplier — radiation (SPE, everyone shelters) and D-075
  // understaffing (laborRatio, below) hit every power plant alike, storm-vulnerable or not.
  let genMult = 1;

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
    // roadmap-2/V8 scaffold: at most one tech bought per window (order.unlockTech is a single id)
    if (order.unlockTech) s.techs.push(order.unlockTech);
    // build structures: consume local materials, raise counts
    for (const r of Object.keys(matNeed) as ResourceKind[]) s.stocks[r] -= matNeed[r] ?? 0;
    for (const id of build) {
      if (STRUCT_BY_ID[id]) {
        // D-084: a new unit DILUTES the type's condition (weighted average) rather than inheriting
        // it wholesale — building fresh capacity is a real (if expensive, in materials/labor) way
        // to pull a worn-out fleet back up, not just more of the same neglect.
        const prev = s.built[id] ?? 0;
        s.built[id] = prev + 1;
        const c = s.condition[id] ?? 1;
        s.condition[id] = prev > 0 ? (c * prev + 1) / (prev + 1) : 1;
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

  // roadmap-2/V8 scaffold: neutral bundle while techs.csv is empty (opsCrewMult=1, bonuses=0,
  // repairRateMult=1) — computed AFTER this window's own purchase (if any) applies same-window,
  // same precedent as the refuel R&D ladder's stage (D-068).
  const mods = techMods(s.techs);
  const effP: ColonyParams = mods.lifeExpectancyBonus !== 0
    ? { ...p, lifeExpectancy: p.lifeExpectancy + mods.lifeExpectancyBonus }
    : p;

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

  // colonists from the landed convoy arrive (post-crash survivors, D-072) — each an individual
  // now (D-083): healthy, age ~N(30, 2.5) clamped to [25, 35], natural-death age pre-rolled
  for (let i = 0; i < landedEff.colonists; i++) s.colonists.push(newArrival(crng, effP));
  s.pop = s.colonists.length;

  // imported structures from the landed convoy arrive ready-to-run (no local assembly step, D-057)
  for (const id of Object.keys(landedEff.structures)) {
    const n = landedEff.structures[id] ?? 0;
    if (n <= 0 || !STRUCT_BY_ID[id]) continue;
    // D-084: same dilution as local build — n fresh units at a time
    const prev = s.built[id] ?? 0;
    s.built[id] = prev + n;
    const c = s.condition[id] ?? 1;
    s.condition[id] = prev > 0 ? (c * prev + n) / (prev + n) : 1;
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
    // D-086: wearRateMult (dust abrasion on solar panels) scales the WEAR side only — repairRate
    // below stays uniform, an asymmetry that makes keeping panels in shape cost more spares.
    const wearMult = STRUCT_BY_ID[s2]?.wearRateMult ?? 1;
    s.condition[s2] = Math.max(0, Math.min(1, c - p.wearRate * wearMult * (1 - sparesCoverage)));
  }

  // repair (D-084): spares ordered BEYOND upkeep are a real repair budget — up to one extra
  // upkeep's worth per window buys repairRate×(spent/upkeep) condition for every built type at
  // once (colony-wide, same uniform philosophy as laborRatio, D-075). Drawn ONLY if anything is
  // actually worn; autoSpares (D-070) floors the order at EXACTLY upkeep, so repair never happens
  // by itself — ordering the surplus is a deliberate choice, not an automatic side effect.
  const worn = Object.keys(s.built).some((id) => (s.built[id] ?? 0) > 0 && (s.condition[id] ?? 1) < 1);
  const sparesSurplus = Math.max(0, (avail.spares ?? 0) - upkeep);
  const repairSpend = worn && upkeep > 0 ? Math.min(sparesSurplus, upkeep) : 0;
  const repairGain = upkeep > 0 ? p.repairRate * mods.repairRateMult * (repairSpend / upkeep) : 0;
  if (repairGain > 0) {
    for (const id of Object.keys(s.built)) {
      if ((s.built[id] ?? 0) <= 0) continue;
      s.condition[id] = Math.min(1, (s.condition[id] ?? 1) + repairGain);
    }
  }

  // ---- demographics, phase C (D-083): illness roll + bed triage --------------------------------
  // An epidemic event is no longer its own mortality fraction — its magnitude IS this window's
  // spiked illness probability (one disease system, not two); bed capacity does the drama: slots
  // are sickBeds × built units, and each treatment consumes pharma (a bed with no pharma is
  // furniture). Triage is even odds — no priority classes. Treated: cureProb to recover; everyone
  // else is doomed and dies at the start of NEXT window (phase A above). The newly sick are out
  // of the labor pool already THIS window.
  const pIll = Math.max(p.illnessProb, roll?.spec.effect === 'epidemic' ? roll.mag : 0);
  const newlySick: Colonist[] = [];
  for (const c of s.colonists) {
    if (!c.sick && crng.random() < pIll) {
      c.sick = true;
      newlySick.push(c);
    }
  }
  shuffle(newlySick, crng);
  const beds = sickBedCapacity(s.built);
  const pharmaBudget =
    p.pharmaPerTreatment > 0
      ? Math.floor((avail.pharma ?? 0) / p.pharmaPerTreatment)
      : newlySick.length;
  const treatedCount = Math.min(newlySick.length, beds, pharmaBudget);
  let curedCount = 0;
  for (let i = 0; i < newlySick.length; i++) {
    if (i < treatedCount && crng.random() < Math.min(1, p.cureProb + mods.cureProbBonus)) curedCount += 1;
    else newlySick[i]!.doomed = true;
  }
  const sickenedCount = newlySick.length;
  const doomedNow = sickenedCount - curedCount; // dead men walking — they die next window

  // labor (D-075): total colonist-hours the colony's built structures need to stay staffed, vs what's
  // actually on hand — recomputed fresh every window from CURRENT pop, not a persistent per-structure
  // assignment: a mass-casualty event thins every structure's output proportionally the same window,
  // no "who got reassigned first" bookkeeping. Folded into the existing uniform-throttle slots
  // (genMult/allMult) rather than a new parameter — same shape as solar_flare's allMult.
  // pop===0 is "not colonized yet", not "workforce wiped out" — a robotically pre-deployed
  // solar_plant sitting there before the first colonists ever land must not read as a total
  // blackout; the mechanic is meant to catch DEGRADATION from an established headcount, not the
  // absence of any headcount ever having existed (same absence≠penalty convention as condOf/energyPower).
  const laborNeed = laborDemand(s.built) * mods.opsCrewMult + demolitionLaborThisWindow; // D-081: teardown is a surge, not a persistent job; opsCrewMult — roadmap-2/V8 scaffold
  // D-083: the pool is able-bodied ADULTS — under-16s and the actively sick eat but staff nothing.
  // pop===0 keeps meaning "not colonized yet", not "workforce wiped out".
  const workforce = workforceCount(s.colonists, p.adultAge);
  const laborRatio = s.pop > 0 && laborNeed > 0 ? Math.min(1, workforce / laborNeed) : 1;
  genMult *= laborRatio;
  allMult *= laborRatio;

  // energy (priority brownout) + input availability (hi-tech) + condition (wear) → structure output;
  // dust_storm (D-086) throttles only stormVulnerable generation via stormMult; blight (D-063)
  // throttles food-producers via farmMult; struct_outage/solar_flare (D-072) via outMult/allMult;
  // a reactor out of fuel (D-074) via genGate; understaffed colony (D-075) via genMult/allMult too
  // (laborRatio folded in just above)
  const lifeSupportDemand = p.popEnergyPerCapita * s.pop;
  const genGate = generationInputGate(s.built, s.condition, avail);
  const energy = resolveColonyEnergy(s.built, lifeSupportDemand, s.condition, genMult, genGate, stormMult);
  const sf = structureFlows(s.built, energy.served, avail, s.condition, farmMult, outMult, allMult, s.industryOutput);
  // D-089: bank this window's ACTUAL output (already industryMult-scaled) into the cumulative
  // counter industryMult reads back NEXT window — only for types that actually deplete/ramp, so
  // industryOutput doesn't grow for every ordinary producer that never reads it back.
  for (const id of Object.keys(sf.diag)) {
    const spec = STRUCT_BY_ID[id];
    if (!spec || (!spec.depletionScale && !spec.rampScale)) continue;
    s.industryOutput[id] = (s.industryOutput[id] ?? 0) + sf.diag[id].outputKg;
  }

  // life-support + structure consumption + spares upkeep; arrivals + structure production
  const cons = consumption(s);
  const combinedCons: Partial<Stocks> = { ...cons };
  for (const r of Object.keys(sf.consumption) as ResourceKind[]) {
    combinedCons[r] = (combinedCons[r] ?? 0) + (sf.consumption[r] ?? 0);
  }
  combinedCons.spares = (combinedCons.spares ?? 0) + upkeep + repairSpend; // D-084: repair really spends stock
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

  // harvest_loss (D-085): pure stock damage, no mortality fraction of its own — a wrecked crop
  // starves people LATER through the ordinary Liebig deficit next window, exactly like any other
  // supply shortfall (same non-lethal-on-impact shape as subsidy_cut/price_spike, not breach/
  // radiation). Binary coverage (≥1 food_silo), same pattern as epidemic/radiation's medbay+pharma
  // check — no natural continuous ratio to graduate by here, unlike ЗИП coverage (D-073).
  let harvestCovered = false;
  if (roll?.spec.effect === 'harvest') {
    harvestCovered = (s.built['food_silo'] ?? 0) > 0;
    const frac = harvestCovered ? roll.spec.coveredMag : roll.mag;
    s.stocks.food = Math.max(0, s.stocks.food * (1 - frac));
  }

  // spoilage, food half (D-085): passive end-of-window decay — applied to WHATEVER's left after
  // every other flow/event this window (freshly landed stock gets no grace window, joins the same
  // pool and decays alongside everything else). No mortality cause of its own, same reasoning as
  // harvest_loss above. Pharma's half is applied LATER (after the D-083 treatment draw below,
  // which still needs to spend against the pre-spoilage pharma pool this same window) — see there.
  const foodSpoilRate = Math.max(p.minSpoilRate, p.catalog.food.spoilRate * foodSpoilRateMult(s.built));
  const foodBeforeSpoil = s.stocks.food;
  s.stocks.food = Math.max(0, s.stocks.food * (1 - foodSpoilRate));
  const foodSpoiledKg = foodBeforeSpoil - s.stocks.food;

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
  // like an epidemic, with the same one-time pharma draw. D-094: shield_berm's coverage does
  // double duty — the SAME physical regolith mass ALSO cuts the magnitude here, layered on top of
  // (not replacing) medbay+pharma's own independent binary coverage (medicine treats casualties;
  // shielding stops the dose reaching anyone in the first place — two different mechanisms).
  let radFrac = 0;
  let radCovered = false;
  if (roll?.spec.effect === 'radiation') {
    radCovered = (s.built['medbay'] ?? 0) > 0 && (avail['pharma'] ?? 0) > 0;
    radFrac = (radCovered ? roll.spec.coveredMag : roll.spec.deathMag) * shieldAttenuation(shieldCoverage, p.shieldFloor);
  }

  // D-083: the soft-OR fraction now selects REAL victims — an integer count (probabilistically
  // rounded so small colonies still feel small risks in expectation), removed uniformly at random.
  const mortFrac =
    1 - (1 - consumableFrac) * (1 - energyFrac) * (1 - breachFrac) * (1 - radFrac);
  const shortfallDeaths = probRound(s.pop * mortFrac, crng);
  removeRandom(s.colonists, shortfallDeaths, crng);
  s.pop = s.colonists.length;
  if (radCovered && roll) {
    s.stocks.pharma = Math.max(0, s.stocks.pharma - roll.spec.pharmaCost * s.pop);
  }
  // treatment pharma (D-083): each treated case consumes its dose — drawn like the radiation
  // cover above, after flows, clamped (the treatment already happened; the ledger just settles)
  if (treatedCount > 0) {
    s.stocks.pharma = Math.max(0, s.stocks.pharma - treatedCount * p.pharmaPerTreatment);
  }

  // spoilage, pharma half (D-085): deliberately placed AFTER the radiation/treatment draws just
  // above — those spend against what pharma was ACTUALLY available for this window's medicine, and
  // spoilage must only eat the LEFTOVER once every real use has already been paid for out of it.
  const pharmaSpoilRate = p.catalog.pharma.spoilRate; // no mitigating structure (D-085 decision)
  const pharmaBeforeSpoil = s.stocks.pharma;
  s.stocks.pharma = Math.max(0, s.stocks.pharma * (1 - pharmaSpoilRate));
  const pharmaSpoiledKg = pharmaBeforeSpoil - s.stocks.pharma;

  // named attribution (D-061): split the shortfall deaths between their independent risks
  // proportionally to their (pre-combination) fractions — consumableFrac has exactly one binding
  // resource (Liebig). Illness/old-age deaths (D-083) arrive pre-attributed from phase A.
  // Crash deaths (D-072) sit OUTSIDE the soft-OR: those colonists died on entry, never joined s.pop.
  const mortalityBreakdown: Partial<Record<MortalityCause, number>> = {};
  const causeWeight = consumableFrac + energyFrac + breachFrac + radFrac;
  if (causeWeight > 0 && shortfallDeaths > 0) {
    if (consumableFrac > 0 && worstResource) {
      mortalityBreakdown[worstResource] = Math.round(shortfallDeaths * (consumableFrac / causeWeight));
    }
    if (energyFrac > 0) {
      mortalityBreakdown.energy = Math.round(shortfallDeaths * (energyFrac / causeWeight));
    }
    if (breachFrac > 0) {
      mortalityBreakdown.breach = Math.round(shortfallDeaths * (breachFrac / causeWeight));
    }
    if (radFrac > 0) {
      mortalityBreakdown.radiation = Math.round(shortfallDeaths * (radFrac / causeWeight));
    }
  }
  if (illnessDeaths > 0) mortalityBreakdown.illness = illnessDeaths;
  if (oldAgeDeaths > 0) mortalityBreakdown.old_age = oldAgeDeaths;
  if (crashDeaths > 0) mortalityBreakdown.crash = crashDeaths;
  const mortality = shortfallDeaths + illnessDeaths + oldAgeDeaths;

  // births: medbay + pharma enable growth (D-030); gated by housing (V7) and a fully-fed, fully-powered
  // colony (no growth mid-famine or mid-brownout)
  const housing = housingCapacity(s.built);
  const housingOk = housing === 0 || s.pop < housing * 0.9;
  let births = 0;
  if ((s.built['medbay'] ?? 0) > 0 && (avail['pharma'] ?? 0) > 0 && housingOk && worstRatio === 0 && energyRatio === 0) {
    // D-083: newborns are individuals at age 0 — ≈7.4 windows of eating before they can work;
    // probRound keeps a sub-20-person outpost growing in expectation despite integer people
    births = probRound(s.pop * p.birthRate, crng);
    for (let i = 0; i < births; i++) s.colonists.push(newborn(crng, effP));
    s.pop = s.colonists.length;
  }

  // extinction: population is literal people now (D-083) — zero means zero, collapse once anyone
  // has ever lived here
  if (s.pop > 0) s.everHadPop = true;
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
      // D-083: the epidemic's toll is known NOW (the doomed die at the start of next window as
      // `illness`) — report it here so the event line names the damage the window it happened
      windowEvent.sickened = sickenedCount;
      windowEvent.treated = treatedCount;
      windowEvent.covered = treatedCount >= sickenedCount;
      windowEvent.deaths = doomedNow;
    }
    if (roll.spec.effect === 'breach') {
      windowEvent.coverage = sparesCoverage;
      windowEvent.deaths = mortalityBreakdown.breach ?? 0;
    }
    if (roll.spec.effect === 'radiation') {
      windowEvent.covered = radCovered;
      windowEvent.deaths = mortalityBreakdown.radiation ?? 0;
    }
    if (roll.spec.effect === 'harvest') windowEvent.covered = harvestCovered;
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
  if ((s.built.mre_plant ?? 0) > 0) mark('local_metals'); // D-089
  if ((s.built.sinter_plant ?? 0) > 0) mark('local_construction'); // D-090
  if ((s.built.fab_shop ?? 0) > 0) mark('local_fabrication'); // D-091
  if ((s.built.machine_shop ?? 0) > 0) mark('local_spares'); // D-091
  // "survive an event with zero deaths" counts only windows where a DEADLY effect actually applied:
  // a storm/blight throttling output, an epidemic, or the supply gap a skipped convoy left behind.
  // Economic events (subsidy/price) can't kill in their own window — surviving them is no feat.
  const deadlyApplied =
    genMult < 1 ||
    stormMult < 1 ||
    farmMult < 1 ||
    allMult < 1 ||
    Object.keys(outMult).length > 0 ||
    roll?.spec.effect === 'epidemic' ||
    roll?.spec.effect === 'breach' ||
    (roll?.spec.effect === 'crash' && (landed.colonists > 0 || crashLostKg > 0)) ||
    skipGapWindow;
  // D-083: judge only deaths ATTRIBUTABLE to the event — background illness/old-age deaths happen
  // most windows now and would make "no losses" unreachable for any grown colony. An epidemic
  // window owns its doomed (they die next window, but the sentence was passed here).
  const eventDeaths =
    shortfallDeaths + crashDeaths + (roll?.spec.effect === 'epidemic' ? doomedNow : 0);
  if (deadlyApplied && eventDeaths === 0 && s.pop > 0) mark('event_survived');
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
    mortality: mortality + crashDeaths,
    mortalityBreakdown,
    births,
    workforce: workforceCount(s.colonists, p.adultAge),
    kids: s.colonists.reduce((n, c) => n + (c.age < p.adultAge ? 1 : 0), 0),
    sick: s.colonists.reduce((n, c) => n + (c.sick ? 1 : 0), 0),
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
    repairSpentKg: repairSpend,
    foodSpoiledKg,
    pharmaSpoiledKg,
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

/** Deaths caused by SUPPLY this window — the binding life-support resource or an energy brownout.
 * The D-062 gauge measures buffers, so background demography (illness/old age, D-083) must not
 * trip it: a grown colony loses someone most windows regardless of how stocked it is, and stopping
 * on ANY death would pin the gauge to 0–1 forever. Exported for the UI/CLI projection warnings
 * (roadmap-1): they filter on the same definition of "supply" the gauge uses. */
export function supplyDeaths(r: ColonyReport): number {
  let n = r.mortalityBreakdown.energy ?? 0;
  for (const res of LIFE_R) n += r.mortalityBreakdown[res] ?? 0;
  return n;
}

/** Draft-aware two-window projection (roadmap-1, плейтест-5: every mass death was computable
 * before the commit). Clones the state, commits the DRAFT order, then one empty window — i.e.
 * "what lands, and what runs out, if I send this and then order nothing". The same honest-sim
 * instrument as the D-062 gauge, so the same rules: storyteller off in the clone (no telegraph,
 * D-063), buffer-gauge recursion skipped (`simulating`). Reports come back for the UI/CLI to
 * derive warnings from — supply deaths via `supplyDeaths`, named deficits via `report.deficit`. */
export function projectOrder(
  s: ColonyState,
  order: EarthOrder,
  build: string[] = [],
  demolish: string[] = [],
): { next: ColonyReport; after: ColonyReport } {
  const sim = structuredClone(s);
  sim.p = { ...sim.p, eventChanceCap: 0 };
  const wasSimulating = simulating;
  simulating = true;
  try {
    const next = commitWindow(sim, order, build, demolish);
    const after = commitWindow(sim, emptyOrder());
    return { next, after };
  } finally {
    simulating = wasSimulating;
  }
}

/** Pharma a window is expected to draw (roadmap-1 авто-фарма): the structures' own consumption
 * (medbays etc.) plus the expected illness treatments at current population (D-083). The same
 * break-even floor idea as авто-ЗИП — the player only thinks about pharma when they want a BUFFER. */
export function pharmaNeed(s: ColonyState): number {
  let structural = 0;
  for (const id of Object.keys(s.built)) {
    const spec = STRUCT_BY_ID[id];
    if (spec) structural += (spec.consumes.pharma ?? 0) * (s.built[id] ?? 0);
  }
  const treatments = Math.ceil(s.pop * s.p.illnessProb) * s.p.pharmaPerTreatment;
  return structural + treatments;
}

/** Windows survivable with zero new imports before the first SUPPLY death (D-062/D-083) — the live
 * buffer gauge («запас без завоза»). Saturates at BUFFER_LOOKAHEAD. */
export function bufferRunway(s: ColonyState): number {
  return simulateNoImport(s, BUFFER_LOOKAHEAD, (r) => supplyDeaths(r) > 0);
}

/** Lookahead cap for the debrief's full collapse runway (D-064/glossary "collapse runway") — 60
 * windows (~130 years) comfortably separates "eventually collapses" from "effectively never". */
export const COLLAPSE_LOOKAHEAD = 60;

/** Windows survivable with zero new imports before full COLLAPSE (D-064/glossary) — the named
 * survival runway, debrief-only. A longer, grimmer sibling of bufferRunway (first death vs the end). */
export function collapseRunway(s: ColonyState): number {
  return simulateNoImport(s, COLLAPSE_LOOKAHEAD, (r) => r.collapsed);
}
