// v2 store: owns the ColonyState, the draft Earth order, preview + commit, pub/sub, save/load.

import {
  newColony,
  defaultColonyParams,
  previewOrder,
  commitWindow,
  consumption,
  emptyOrder,
  marsPlanMaterials,
  prereqMet,
  importPrereqMet,
  lockReason,
  structureImportPlan,
  colonyPriceMult,
  resolveColonyEnergy,
  structureFlows,
  spareUpkeep,
  laborDemand,
  housingCapacity,
  shieldCapacity,
  sickBedCapacity,
  foodCapacity,
  waterCapacity,
  workforceCount,
  structuralN2Leak,
  serializeColony,
  loadColony,
  padClassFor,
  nextRefuelStage,
  bufferRunway,
  BUFFER_LOOKAHEAD,
  collapseRunway,
  COLLAPSE_LOOKAHEAD,
  MILESTONES,
  supplyDeaths,
  projectOrder,
  pharmaNeed,
  expectedOldAgeDeaths as computeExpectedOldAgeDeaths,
  YEARS_PER_WINDOW,
  STRUCTURES,
  STRUCT_BY_ID,
  RESOURCES,
  ADVANCED_TECHS,
  techBuyable as engineTechBuyable,
  industryMult,
  type ColonyState,
  type ColonyParams,
  type EarthOrder,
  type OrderPreview,
  type ColonyReport,
  type ResourceKind,
  type Stocks,
  type Structure,
  type LaunchTech,
  type Fleet,
  type LaunchParams,
  type MilestoneId,
  type MortalityCause,
  type LockReason,
  type TechSpec,
} from '../engine';

export interface ResourceLine {
  kind: ResourceKind;
  stock: number;
  net: number; // local production − total consumption per window (no imports); <0 = draining
  windows: number; // windows of cover if draining (Infinity if net ≥ 0)
  lifeSupport: boolean;
  localOnly: boolean; // D-089 (P1): ISRU intermediate, not orderable from Earth — UI collapses
  // these into a separate "industrial stocks" section instead of the main food/water/o2/n2 grid
}

export interface ColonyStatus {
  window: number;
  year: number;
  pop: number;
  workforce: number; // D-083: able-bodied adults — the D-075 labor pool
  kids: number; // D-083: under adultAge (eat, don't work)
  sick: number; // D-083: in the active illness stage — recover or die next window
  sickBeds: number; // D-083: treatment slots (sickBeds × built units)
  pads: Record<LaunchTech, number>;
  refuelStage: number; // 0 = locked; rungs of the staged R&D ladder (D-068)
  budget: number;
  buffer: number; // D-062: honest simulated windows-until-first-death with zero new imports
  bufferSaturated: boolean; // buffer hit the lookahead cap — "this many or more"
  resources: ResourceLine[]; // ALL stocks with per-window net + cover (dashboard)
  energyGen: number;
  energyDemand: number;
  energyDeficit: number;
  avgCondition: number; // mean structure condition 0..1 (V6)
  sparesCoverage: number; // spares stock vs upkeep need
  crewCoverage: number; // D-075: pop vs total opsCrew demand — 1 if fully staffed or nothing needs crew
  shieldCoverage: number; // D-094: shield_berm capacity vs pop — 1 if nobody's alive or fully covered;
  // never fully removes chronic dose (or solar_flare's magnitude) even at 1 — see shieldFloor
  housingCapacity: number; // total colonist slots from habitats (V7); 0 = unconstrained
  foodCapacityTotal: number; // D-085: baseFoodCapacity + food_silo — total food stockpile ceiling
  waterCapacityTotal: number; // D-085: same, for water (water_tank)
  n2LeakKgPerWindow: number; // structural N₂ hull leak per window (V7)
  ended: boolean; // collapsed, or the player clicked "finish" (D-064) — never a time/window limit
  collapsed: boolean;
}

/** Age structure for the roadmap-2 demography UI — a snapshot, not a forecast of WHO dies (that
 * would read individual `deathAge`s, a telegraph D-063 forbids). Only `expectedOldAgeDeaths` looks
 * ahead, and it does so STATISTICALLY, off the (age, lifeExpectancy, lifeExpectancySd) distribution
 * alone. `maturingSoon` is the one honestly-deterministic forecast here — a child's climb to
 * adultAge is on a fixed calendar, not a coin flip. */
export interface DemographySnapshot {
  buckets: { label: string; count: number }[];
  avgAge: number;
  expectedOldAgeDeaths: number; // statistical forecast over DEMOGRAPHY_FORECAST_WINDOWS
  maturingSoon: number; // children crossing adultAge within DEMOGRAPHY_FORECAST_WINDOWS — deterministic
}

/** A milestone as shown in the debrief checklist (D-064) — `window` is undefined if not yet achieved. */
export interface MilestoneLine {
  id: MilestoneId;
  name: string;
  icon: string;
  window?: number;
}

/** Debrief (D-064): shown on collapse or when the player finishes — reads entirely from the
 * chronicle (D-061) and engine state, computes nothing that affects gameplay. No win state, ever
 * (D-036/D-047): states facts, the player draws the conclusion. */
export interface ColonyDebrief {
  reason: 'collapsed' | 'finished';
  window: number;
  year: number;
  collapseCause: Partial<Record<MortalityCause, number>>; // empty unless reason === 'collapsed'
  collapseRunwayWindows: number; // named survival runway (glossary: debrief-only), full collapse under a cutoff
  collapseRunwaySaturated: boolean; // hit COLLAPSE_LOOKAHEAD — "this many or more"
  // for a collapsed colony the live simulation is moot (pop=0 → 0 windows); instead name the gauge
  // as it stood on the last window without deaths — how much buffer there was when the spiral began
  preSpiralBuffer?: number;
  milestones: MilestoneLine[];
  populationSeries: number[]; // one point per chronicle window
  autonomySeries: number[]; // autonomyByMass × 100, one point per chronicle window
  stockSeries: Record<'food' | 'water' | 'o2' | 'n2', number[]>;
}

/** Combined window plan (Earth order + Mars build) — feasibility for the shared commit footer.
 * Mars construction costs no money (command economy, D-054) — only materials + prerequisites. */
export interface CommitPlan {
  earth: OrderPreview;
  totalCost: number; // = Earth order cost (the only money spend)
  budget: number;
  overBudget: boolean;
  materialsShort: ResourceKind[];
  prereqMissing: string[];
  rndBlocked: boolean; // D-077: R&D unlock ordered before any colonist has ever landed on Mars
  bootstrapBlocked: boolean; // D-078: cargo ordered alone, before any colonist has ever landed
  feasible: boolean;
}

type Listener = () => void;

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// exported so tests can inject an exact ColonyState via the same save/load path the store itself
// uses (serializeColony/loadColony) — the only way to get precise fixtures (e.g. a colonist at a
// specific fractional age) into a ColonyStore, which otherwise only builds state through gameplay.
export const SAVE_KEY = 'outland.colony'; // versioning handled inside the save blob, not the key
const memoryKV: KV = (() => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
})();
function defaultStorage(): KV {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : memoryKV;
  } catch {
    return memoryKV;
  }
}

const LIFE: ResourceKind[] = ['food', 'water', 'o2'];
const LIFE_R: ResourceKind[] = ['food', 'water', 'o2', 'n2'];

/** Russian labels for supply-death causes (roadmap-1 projection warnings) — a LOCAL copy of
 * chronicle-panel.ts's CAUSE_LABEL, deliberately not imported: the store must stay lit-free (the
 * CLI drives it with no browser, see scripts/play.ts) and CAUSE_LABEL lives in a Lit component. */
const CAUSE_RU: Partial<Record<MortalityCause, string>> = {
  food: 'голод', water: 'жажда', o2: 'нехватка O₂', n2: 'удушье (N₂)', energy: 'браунаут ЖО',
};

/** Fixed age-bucket edges for the demography UI (roadmap-2) — deliberately literal numbers, not
 * derived from adultAge (16 by default, D-083): these are display buckets, not a labor-pool rule. */
const AGE_BUCKETS: readonly { label: string; lo: number; hi: number }[] = [
  { label: '0–15', lo: 0, hi: 15 },
  { label: '16–29', lo: 16, hi: 29 },
  { label: '30–44', lo: 30, hi: 44 },
  { label: '45–54', lo: 45, hi: 54 },
  { label: '55+', lo: 55, hi: Infinity },
];

/** Lookahead for both demography forecasts (roadmap-2) — short enough to feel like "coming up",
 * long enough to be worth a glance; independent of BUFFER_LOOKAHEAD (a different kind of horizon). */
const DEMOGRAPHY_FORECAST_WINDOWS = 3;

export class ColonyStore {
  private state: ColonyState;
  private last?: ColonyReport;
  private listeners = new Set<Listener>();
  private storage: KV;
  // draft order
  private draftRes: Partial<Record<ResourceKind, number>> = {};
  private draftPads: Record<LaunchTech, number> = { classic: 0, refuel: 0 };
  private draftPadsScrap: Record<LaunchTech, number> = { classic: 0, refuel: 0 }; // D-080
  private draftUnlockRefuel = false;
  private draftUnlockTech?: string; // D-088 (P0): at most one tech bought per window (mirrors the
  // engine's own `EarthOrder.unlockTech` scaffold — a single slot, not an array)
  private draftColonists = 0;
  private draftBuild: string[] = [];
  private draftDemolish: string[] = []; // D-081: Mars structures queued to tear down this window
  private draftImport: Record<string, number> = {}; // structures to import fully built (V8, D-057)
  // auto-spares (playtest finding): topping up ЗИП every single window was pure arithmetic upkeep
  // with no strategic content — this toggle floors the spares order at current upkeep need so the
  // player only has to think about it when they want a bigger buffer than break-even.
  private autoSpares = false;
  // auto-pharma (roadmap-1, mirrors auto-spares exactly): pharma is the same kind of rote reorder
  // once a medbay is running — floors the order at pharmaNeed() (structural draw + expected D-083
  // illness treatments at current pop), manual slider still adds MORE on top.
  private autoPharma = false;
  // D-062: the honest buffer simulation only depends on the committed state, not the draft order
  // being edited — cache by window so it isn't re-run on every slider tick (would be a 12-window
  // engine simulation per keystroke otherwise).
  private bufferCache?: { window: number; value: number };
  // roadmap-1: projectOrder() runs TWO commitWindow calls on a clone — cache by a signature of the
  // draft so it isn't re-run on every slider tick either. Invalidated by any draft mutation because
  // the key includes the whole order/build/demolish.
  private projectionCache?: { key: string; value: { next: ColonyReport; after: ColonyReport } };
  // D-064: the player chose to stop (no win state — collapse or "finish" are the only endings).
  // Deliberately NOT persisted: a reload resumes play, same as any other in-progress session state.
  private finished = false;

  constructor(params?: ColonyParams, storage: KV = defaultStorage()) {
    this.storage = storage;
    if (params) {
      this.state = newColony(params);
    } else {
      this.state = this.tryLoad() ?? newColony(defaultColonyParams());
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** No win state, no window limit (D-064) — the run ends only on collapse or the player's own
   * "finish". */
  get ended(): boolean {
    return this.state.collapsed || this.finished;
  }

  /** Player-opened debrief (D-064 «дебриф по кнопке в любой момент») — the colony isn't dead,
   * so unlike collapse this is reversible via resume(). */
  finish(): void {
    this.finished = true;
    this.emit();
  }

  /** Close a player-opened debrief and return to play. A collapse is never resumable. */
  resume(): void {
    if (this.state.collapsed) return;
    this.finished = false;
    this.emit();
  }

  // ---- draft order --------------------------------------------------------

  order(): EarthOrder {
    return {
      ...emptyOrder(),
      resources: Object.fromEntries(RESOURCES.map((r) => [r, this.resQty(r)])),
      padsToBuild: { ...this.draftPads },
      padsToScrap: { ...this.draftPadsScrap },
      unlockRefuel: this.draftUnlockRefuel,
      unlockTech: this.draftUnlockTech,
      colonists: this.draftColonists,
      structures: { ...this.draftImport },
    };
  }
  /** Effective quantity to order — floored at upkeep need for spares when auto-spares is on
   * (the manual slider still adds MORE buffer on top, it just can't go below break-even). Pharma
   * gets the same treatment when auto-pharma is on (roadmap-1). */
  resQty(r: ResourceKind): number {
    const manual = this.draftRes[r] ?? 0;
    if (r === 'spares' && this.autoSpares) return Math.max(manual, spareUpkeep(this.state.built));
    if (r === 'pharma' && this.autoPharma) return Math.max(manual, pharmaNeed(this.state));
    return manual;
  }
  /** The player's own manual entry, ignoring any auto-floor — used to tell "the manifest is only
   * non-empty because auto-spares/auto-pharma topped it up" apart from a genuine order (roadmap-1
   * zeroImportBlockedByAuto). */
  private manualResQty(r: ResourceKind): number {
    return this.draftRes[r] ?? 0;
  }
  setRes(r: ResourceKind, qty: number): void {
    let v = Math.max(0, Math.round(qty || 0));
    // D-085: food/water are hard-capped by store-layer capacity (D-056 housing precedent) — the
    // engine itself never checks this, so a raw commitWindow() call in a test can still exceed it.
    if (r === 'food') v = Math.min(v, this.maxFoodStock());
    if (r === 'water') v = Math.min(v, this.maxWaterStock());
    this.draftRes[r] = v;
    this.emit();
  }
  get autoSparesEnabled(): boolean {
    return this.autoSpares;
  }
  toggleAutoSpares(): void {
    this.autoSpares = !this.autoSpares;
    this.emit();
  }
  get autoPharmaEnabled(): boolean {
    return this.autoPharma;
  }
  toggleAutoPharma(): void {
    this.autoPharma = !this.autoPharma;
    this.emit();
  }
  /** D-084: repair rate + current upkeep — the UI/CLI use these to explain what a spares order
   * BEYOND upkeep buys (autoSpares itself never triggers repair — it floors at exactly upkeep). */
  repairInfo(): { rate: number; upkeep: number } {
    return { rate: this.state.p.repairRate, upkeep: spareUpkeep(this.state.built) };
  }
  padQty(tech: LaunchTech): number {
    return this.draftPads[tech];
  }
  setPad(tech: LaunchTech, n: number): void {
    this.draftPads[tech] = Math.max(0, Math.floor(n || 0));
    this.emit();
  }
  /** D-080: how many pads of this class the current draft would decommission. */
  padScrapQty(tech: LaunchTech): number {
    return this.draftPadsScrap[tech];
  }
  /** Clamped to what's actually owned right now — never lets the draft ask to scrap more than exists. */
  setPadScrap(tech: LaunchTech, n: number): void {
    this.draftPadsScrap[tech] = Math.max(0, Math.min(this.state.fleet.pads[tech], Math.floor(n || 0)));
    this.emit();
  }
  /** Net cost the current draft's scrap order would charge (D-082 — decommissioning is an expense,
   * not a refund) — same previewOrder path as every other price on screen, so it's always exactly
   * what commit() will actually charge. */
  padScrapCostNow(): number {
    return this.preview().padScrapCost;
  }
  get unlockRefuelDraft(): boolean {
    return this.draftUnlockRefuel;
  }
  /** D-077: R&D campaigns need Mars presence — no colonist has ever landed yet. */
  get rndLocked(): boolean {
    return !this.state.everHadPop;
  }
  toggleUnlockRefuel(): void {
    this.draftUnlockRefuel = !this.draftUnlockRefuel;
    this.emit();
  }

  // ---- advanced tech tree (D-088, P0) --------------------------------------

  /** The whole catalog (from techs.csv) — empty today, P0 ships zero content on purpose. */
  techs(): readonly TechSpec[] {
    return ADVANCED_TECHS;
  }
  techOwned(id: string): boolean {
    return this.state.techs.includes(id);
  }
  /** Same feasibility check `commitWindow` itself re-validates (prereqTech/prereqStructure/minPop/
   * everHadPop) — a locked card in the UI can never be bought only to bounce at commit time. */
  techBuyable(id: string): boolean {
    return engineTechBuyable(id, this.state.techs, this.state.built, this.state.pop, this.state.everHadPop);
  }
  /** Inflation-adjusted price right now, same `previewOrder` path as every other price on screen —
   * 0 if `id` isn't actually buyable (already owned, gate unmet, ...). */
  techPriceNow(id: string): number {
    return previewOrder(this.state, { ...emptyOrder(), unlockTech: id }).techCost;
  }
  unlockTechDraft(): string | undefined {
    return this.draftUnlockTech;
  }
  /** Selecting a tech replaces any previously selected one (at most one purchase per window,
   * matching the engine's single-slot `EarthOrder.unlockTech`); clicking the selected one again
   * deselects it. */
  setUnlockTech(id: string | undefined): void {
    this.draftUnlockTech = this.draftUnlockTech === id ? undefined : id;
    this.emit();
  }
  fleet(): Fleet {
    return this.state.fleet;
  }
  launch(): LaunchParams {
    return this.state.p.launch;
  }
  /** Marginal delivery cost per kg = cheapest usable pad class's launchCost/payload (D-038),
   * inflation-adjusted (playtest bug: this used to show the WINDOW-0 price forever, silently
   * diverging from what previewOrder actually charges as the game goes on) — refuel economics
   * depend on the bought R&D stage (D-068). */
  deliveryPerKg(): { perKg: number; tech: LaunchTech } {
    const lp = this.state.p.launch;
    const usable: LaunchTech[] = this.state.fleet.refuelStage > 0 ? ['classic', 'refuel'] : ['classic'];
    let best: LaunchTech = 'classic';
    let bestV = Infinity;
    for (const t of usable) {
      const c = padClassFor(this.state.fleet, lp, t);
      const v = c.launchCost / c.payload;
      if (v < bestV) {
        bestV = v;
        best = t;
      }
    }
    return { perKg: bestV * colonyPriceMult(this.state), tech: best };
  }

  /** Effective price for one kg of a resource RIGHT NOW — goods cost only (delivery is separate,
   * see deliveryPerKg), via the SAME previewOrder path the real charge uses, so it always matches
   * what commit() actually bills (inflation, D-031, and any active price_spike event, D-063). */
  pricePerKg(r: ResourceKind): number {
    return previewOrder(this.state, { ...emptyOrder(), resources: { [r]: 1 } }).goodsCost;
  }

  /** Effective per-colonist price right now (inflation-adjusted, same previewOrder path). */
  colonistPriceNow(): number {
    return previewOrder(this.state, { ...emptyOrder(), colonists: 1 }).colonistCost;
  }

  /** Effective price to build one more pad of a class right now (inflation-adjusted). */
  padPriceNow(tech: LaunchTech): number {
    const order = { ...emptyOrder(), padsToBuild: { classic: tech === 'classic' ? 1 : 0, refuel: tech === 'refuel' ? 1 : 0 } };
    return previewOrder(this.state, order).padCapex;
  }

  /** The refuel R&D ladder position (D-068): current stage + the next rung's label/cost, if any. */
  refuelRnD(): { stage: number; total: number; next: { index: number; name: string; cost: number } | null } {
    const lp = this.state.p.launch;
    const next = nextRefuelStage(this.state.fleet, lp);
    return {
      stage: this.state.fleet.refuelStage,
      total: lp.refuelStages.length,
      next: next
        ? { index: next.index, name: next.stage.name, cost: next.stage.cost * colonyPriceMult(this.state) }
        : null,
    };
  }
  get colonists(): number {
    return this.draftColonists;
  }
  /** Free housing slots not already occupied or spoken for by colonists in transit (V8 hard cap).
   * Counts housing that will exist by the time these colonists land: current built + housing already
   * in transit from an earlier order (it lands at the start of this commit, before the new convoy
   * ships, per commitWindow's landing order) + this window's queued Mars build + structure imports. */
  maxColonists(): number {
    const queuedHousing = this.draftBuild.reduce((a, id) => a + (STRUCT_BY_ID[id]?.housing ?? 0), 0);
    const importHousing = Object.keys(this.draftImport).reduce(
      (a, id) => a + (STRUCT_BY_ID[id]?.housing ?? 0) * (this.draftImport[id] ?? 0),
      0,
    );
    const inTransitHousing = Object.keys(this.state.inTransit.structures).reduce(
      (a, id) => a + (STRUCT_BY_ID[id]?.housing ?? 0) * (this.state.inTransit.structures[id] ?? 0),
      0,
    );
    const housing = housingCapacity(this.state.built) + inTransitHousing + queuedHousing + importHousing;
    return Math.max(0, housing - this.state.pop - this.state.inTransit.colonists);
  }
  setColonists(n: number): void {
    this.draftColonists = Math.max(0, Math.min(this.maxColonists(), Math.floor(n || 0)));
    this.emit();
  }

  /** D-085: free room left to stockpile food, right now — same shape as maxColonists() (D-056
   * precedent: a structure defines a capacity, the STORE clamps orders against it, the engine
   * itself never checks this). Counts capacity from built + in-transit + this window's queued
   * build/import food_silo units, minus what's already on hand or already inbound. */
  maxFoodStock(): number {
    const queued = this.draftBuild.reduce((a, id) => a + (STRUCT_BY_ID[id]?.foodCapacity ?? 0), 0);
    const imported = Object.keys(this.draftImport).reduce(
      (a, id) => a + (STRUCT_BY_ID[id]?.foodCapacity ?? 0) * (this.draftImport[id] ?? 0),
      0,
    );
    const inTransitCap = Object.keys(this.state.inTransit.structures).reduce(
      (a, id) => a + (STRUCT_BY_ID[id]?.foodCapacity ?? 0) * (this.state.inTransit.structures[id] ?? 0),
      0,
    );
    const cap = this.state.p.baseFoodCapacity + foodCapacity(this.state.built) + inTransitCap + queued + imported;
    return Math.max(0, cap - this.state.stocks.food - this.state.inTransit.stocks.food);
  }

  /** Same as maxFoodStock(), for water (D-085) — water_tank instead of food_silo. */
  maxWaterStock(): number {
    const queued = this.draftBuild.reduce((a, id) => a + (STRUCT_BY_ID[id]?.waterCapacity ?? 0), 0);
    const imported = Object.keys(this.draftImport).reduce(
      (a, id) => a + (STRUCT_BY_ID[id]?.waterCapacity ?? 0) * (this.draftImport[id] ?? 0),
      0,
    );
    const inTransitCap = Object.keys(this.state.inTransit.structures).reduce(
      (a, id) => a + (STRUCT_BY_ID[id]?.waterCapacity ?? 0) * (this.state.inTransit.structures[id] ?? 0),
      0,
    );
    const cap = this.state.p.baseWaterCapacity + waterCapacity(this.state.built) + inTransitCap + queued + imported;
    return Math.max(0, cap - this.state.stocks.water - this.state.inTransit.stocks.water);
  }
  preview(): OrderPreview {
    return previewOrder(this.state, this.order());
  }

  /** Honest 2-window projection of the CURRENT draft (roadmap-1, плейтест-5: every mass death in
   * that playthrough was computable before the commit). `next` is the window this draft would
   * commit as; `after` is one further window with an empty order — "what happens if I send this,
   * then order nothing". Same clone-and-simulate instrument as the D-062 buffer gauge (storyteller
   * off, no telegraph — D-063). Cached by a signature of the whole draft so editing one slider
   * doesn't re-run two commitWindow passes on every keystroke. */
  projection(): { next: ColonyReport; after: ColonyReport } {
    const key = JSON.stringify([this.state.window, this.order(), this.draftBuild, this.draftDemolish]);
    if (this.projectionCache?.key !== key) {
      this.projectionCache = {
        key,
        value: projectOrder(this.state, this.order(), [...this.draftBuild], [...this.draftDemolish]),
      };
    }
    return this.projectionCache.value;
  }

  /** Human-readable projection warnings for both UIs (web footer + CLI) — at most 3 lines, derived
   * from the SAME projection() the gauge uses, never a parallel analytic formula (D-062 already
   * burned once on an analytic runway estimate that couldn't see cascades). Empty = nothing to warn
   * about. Background demography (illness/old age, D-083) is deliberately excluded — supplyDeaths
   * mirrors the buffer gauge's own definition of what's worth a warning. */
  projectionWarnings(): string[] {
    const { next, after } = this.projection();
    const lines: string[] = [];
    const causesOf = (r: ColonyReport): string =>
      (Object.entries(r.mortalityBreakdown) as [MortalityCause, number][])
        .filter(([c, n]) => (n ?? 0) > 0 && CAUSE_RU[c])
        .map(([c, n]) => `${CAUSE_RU[c]} (${n})`)
        .join(', ');
    const nextDeaths = supplyDeaths(next);
    if (nextDeaths > 0) {
      lines.push(`⚠ прогноз на это окно: † ${nextDeaths} — ${causesOf(next)}`);
    }
    const afterDeaths = supplyDeaths(after);
    if (afterDeaths > 0) {
      lines.push(`⚠ после посадки этого конвоя, при пустом следующем заказе: † ${afterDeaths} — ${causesOf(after)}`);
    }
    if (lines.length === 0) {
      // no deaths projected either window — check for a brewing deficit on the AFTER window
      // (nothing dies yet, but a life-support resource is draining) and name only the worst one
      let worstR: ResourceKind | undefined;
      let worstV = 0;
      for (const r of LIFE_R) {
        const v = after.deficit[r] ?? 0;
        if (v > worstV) {
          worstV = v;
          worstR = r;
        }
      }
      if (worstR) {
        lines.push(`⚠ прогноз: дефицит ${worstR} ~${Math.round(worstV)} кг/окно после посадки конвоя`);
      }
    }
    return lines;
  }

  // ---- import structures fully built (V8, D-057) ---------------------------

  importQty(id: string): number {
    return this.draftImport[id] ?? 0;
  }
  setImportQty(id: string, n: number): void {
    this.draftImport[id] = Math.max(0, Math.floor(n || 0));
    this.emit();
  }
  /** Cost (its capex) + shipping mass (buildMaterials-equivalent) to import one unit fully built. */
  importUnitPlan(id: string): { mass: number; cost: number } {
    return structureImportPlan(this.state.p, { [id]: 1 }, colonyPriceMult(this.state));
  }

  // ---- Mars build queue ---------------------------------------------------

  structures(): readonly Structure[] {
    return STRUCTURES;
  }
  buildQueue(): readonly string[] {
    return this.draftBuild;
  }
  queuedCount(id: string): number {
    return this.draftBuild.filter((x) => x === id).length;
  }
  builtCount(id: string): number {
    return this.state.built[id] ?? 0;
  }
  addBuild(id: string): void {
    this.draftBuild.push(id);
    this.emit();
  }
  removeBuild(id: string): void {
    const i = this.draftBuild.lastIndexOf(id);
    if (i >= 0) this.draftBuild.splice(i, 1);
    this.emit();
  }
  prereqMet(id: string): boolean {
    return prereqMet(this.state, id);
  }

  // ---- demolish Mars structures (D-081) ------------------------------------

  demolishQueue(): readonly string[] {
    return this.draftDemolish;
  }
  queuedDemolishCount(id: string): number {
    return this.draftDemolish.filter((x) => x === id).length;
  }
  /** Free (built but not already queued to demolish) units of this type — the ceiling for queuing more. */
  demolishable(id: string): number {
    return Math.max(0, this.builtCount(id) - this.queuedDemolishCount(id));
  }
  addDemolish(id: string): void {
    if (this.demolishable(id) <= 0) return;
    this.draftDemolish.push(id);
    this.emit();
  }
  removeDemolish(id: string): void {
    const i = this.draftDemolish.lastIndexOf(id);
    if (i >= 0) this.draftDemolish.splice(i, 1);
    this.emit();
  }
  /** Import prereq (D-075) — skips the minPop labor gate, a turnkey unit ships pre-built. */
  importPrereqMet(id: string): boolean {
    return importPrereqMet(this.state, id);
  }
  /** Why a structure is locked, if it is (D-074) — distinguishes "build the prereq" from "grow first". */
  lockReason(id: string): LockReason | undefined {
    return lockReason(this.state, id);
  }
  /** D-089 (P1): current depletion/ramp-up yield fraction for a structure type — undefined if it
   * has neither (the vast majority of structures, untouched by this mechanic). 1 = full yield. */
  industryMultNow(id: string): number | undefined {
    const spec = STRUCT_BY_ID[id];
    if (!spec || (!spec.depletionScale && !spec.rampScale)) return undefined;
    return industryMult(spec, this.state.industryOutput[id] ?? 0);
  }

  /** Does the CURRENT draft's manifest look empty to the player, but auto-spares/auto-pharma will
   * still ship something (roadmap-1, C3/C4)? `zero_import` (D-064 finale-boss) requires TWO
   * consecutive windows with a truly empty manifest — an auto-floor silently defeats that unless
   * the player notices they need to turn it off first. Both flags checked independently so the
   * hint can name exactly which one is responsible. */
  zeroImportBlockedByAuto(): { spares: boolean; pharma: boolean } | null {
    const manifestOtherwiseEmpty =
      RESOURCES.every((r) => r === 'spares' || r === 'pharma' || this.manualResQty(r) <= 0) &&
      Object.values(this.draftImport).every((n) => (n ?? 0) <= 0) &&
      this.draftPads.classic <= 0 &&
      this.draftPads.refuel <= 0 &&
      !this.draftUnlockRefuel &&
      !this.draftUnlockTech &&
      this.draftColonists <= 0;
    if (!manifestOtherwiseEmpty) return null;
    const spares = this.autoSpares && this.manualResQty('spares') <= 0 && spareUpkeep(this.state.built) > 0;
    const pharma = this.autoPharma && this.manualResQty('pharma') <= 0 && pharmaNeed(this.state) > 0;
    return spares || pharma ? { spares, pharma } : null;
  }

  /** Combined Earth+Mars plan for the shared commit footer. */
  plan(): CommitPlan {
    const earth = this.preview();
    const need = marsPlanMaterials(this.draftBuild);
    const materialsShort = (Object.keys(need) as ResourceKind[]).filter(
      (r) => this.state.stocks[r] < (need[r] ?? 0),
    );
    const importIds = Object.keys(this.draftImport).filter((id) => (this.draftImport[id] ?? 0) > 0);
    const prereqMissing = [
      ...new Set([
        ...this.draftBuild.filter((id) => !prereqMet(this.state, id)),
        ...importIds.filter((id) => !importPrereqMet(this.state, id)),
      ]),
    ];
    const totalCost = earth.total; // Mars build is money-free (D-054)
    // reuse previewOrder's own overBudget (D-079: exempts a genuinely empty ask from mandatory
    // idle-pad maintenance alone) rather than re-deriving totalCost > earth.budget here, which would
    // silently drop that exemption and reopen the soft-lock at the store layer
    const overBudget = earth.overBudget;
    // R&D "campaigns" need Mars presence already established (D-077) — nobody there to run them
    const rndBlocked = this.draftUnlockRefuel && !this.state.everHadPop;
    // D-078: same principle, wider — nothing ships alone before population is ever established
    // (no free pre-colonist stockpiling); the first shipment of anything else must carry colonists.
    const shippingCargo =
      RESOURCES.some((r) => this.resQty(r) > 0) ||
      importIds.length > 0 ||
      this.draftPads.classic > 0 ||
      this.draftPads.refuel > 0;
    const bootstrapBlocked = shippingCargo && !this.state.everHadPop && this.draftColonists <= 0;
    return {
      earth,
      totalCost,
      budget: earth.budget,
      overBudget,
      materialsShort,
      prereqMissing,
      rndBlocked,
      bootstrapBlocked,
      feasible:
        !earth.capped &&
        !overBudget &&
        materialsShort.length === 0 &&
        prereqMissing.length === 0 &&
        !rndBlocked &&
        !bootstrapBlocked,
    };
  }

  commit(): void {
    if (this.ended) return;
    this.last = commitWindow(this.state, this.order(), [...this.draftBuild], [...this.draftDemolish]);
    this.draftRes = {};
    this.draftPads = { classic: 0, refuel: 0 };
    this.draftPadsScrap = { classic: 0, refuel: 0 };
    this.draftUnlockRefuel = false;
    this.draftUnlockTech = undefined;
    this.draftColonists = 0;
    this.draftBuild = [];
    this.draftDemolish = [];
    this.draftImport = {};
    this.persist();
    this.emit();
  }

  reset(params: ColonyParams = this.state.p): void {
    this.state = newColony(params);
    this.last = undefined;
    this.draftRes = {};
    this.draftPads = { classic: 0, refuel: 0 };
    this.draftPadsScrap = { classic: 0, refuel: 0 };
    this.draftUnlockRefuel = false;
    this.draftUnlockTech = undefined;
    this.draftColonists = 0;
    this.draftBuild = [];
    this.draftDemolish = [];
    this.draftImport = {};
    this.bufferCache = undefined;
    this.projectionCache = undefined;
    this.finished = false;
    this.persist();
    this.emit();
  }

  /** Live buffer gauge (D-062): honest simulated windows-until-first-death with zero new imports.
   * The engine already measures it once per committed window (r.buffer, for the buffer_2 milestone
   * and the debrief series) — read it back rather than re-simulating. The cache path covers window
   * 0 (nothing committed yet) and older saves whose chronicle predates the stored gauge. */
  buffer(): number {
    const last = this.state.chronicle[this.state.chronicle.length - 1];
    if (last?.buffer !== undefined) return last.buffer;
    if (this.bufferCache?.window !== this.state.window) {
      this.bufferCache = { window: this.state.window, value: bufferRunway(this.state) };
    }
    return this.bufferCache.value;
  }

  // ---- read models --------------------------------------------------------

  status(): ColonyStatus {
    const s = this.state;
    const cons = consumption(s);
    const energy = resolveColonyEnergy(s.built, s.p.popEnergyPerCapita * s.pop, s.condition);
    const sf = structureFlows(s.built, energy.served, undefined, s.condition);
    const upkeep = spareUpkeep(s.built);
    const laborNeed = laborDemand(s.built);
    const n2LeakKgPerWindow = structuralN2Leak(s.built);
    const lifeSet = new Set<ResourceKind>(LIFE);
    // per-resource balance: local production − consumption (life-support + structures + spares upkeep)
    const resources: ResourceLine[] = RESOURCES.map((r) => {
      const prod = sf.production[r] ?? 0;
      const lsCons = (cons[r] ?? 0) * (1 - s.p.catalog[r].recycle);
      const structCons = sf.consumption[r] ?? 0;
      const upkeepCons = r === 'spares' ? upkeep : 0;
      // N₂ structural hull leak (V7): habitats bleed N₂ regardless of population
      const n2Cons = r === 'n2' ? n2LeakKgPerWindow : 0;
      const net = prod - lsCons - structCons - upkeepCons - n2Cons;
      const stock = s.stocks[r];
      return {
        kind: r,
        stock,
        net,
        windows: net < 0 ? stock / -net : Infinity,
        lifeSupport: lifeSet.has(r),
        localOnly: s.p.catalog[r].localOnly,
      };
    });
    const builtIds = Object.keys(s.built).filter((id) => (s.built[id] ?? 0) > 0);
    const avgCondition = builtIds.length
      ? builtIds.reduce((a, id) => a + (s.condition[id] ?? 1), 0) / builtIds.length
      : 1;
    const buf = this.buffer();
    return {
      window: s.window,
      year: Math.round(s.window * 2.17 * 10) / 10,
      pop: s.pop,
      workforce: workforceCount(s.colonists, s.p.adultAge),
      kids: s.colonists.reduce((n, c) => n + (c.age < s.p.adultAge ? 1 : 0), 0),
      sick: s.colonists.reduce((n, c) => n + (c.sick ? 1 : 0), 0),
      sickBeds: sickBedCapacity(s.built),
      pads: { ...s.fleet.pads },
      refuelStage: s.fleet.refuelStage,
      budget: s.p.M + s.subsidyBonus, // D-076: milestones raise the baseline permanently
      buffer: buf,
      bufferSaturated: buf >= BUFFER_LOOKAHEAD,
      resources,
      energyGen: energy.generation,
      energyDemand: energy.generation + energy.deficit,
      energyDeficit: energy.deficit,
      avgCondition,
      sparesCoverage: upkeep > 0 ? Math.min(1, s.stocks.spares / upkeep) : 1,
      // D-083: coverage is judged by the ABLE-BODIED pool, mirroring the engine's laborRatio
      crewCoverage:
        s.pop > 0 && laborNeed > 0 ? Math.min(1, workforceCount(s.colonists, s.p.adultAge) / laborNeed) : 1,
      // D-094: same capacity-vs-pop shape as housing/sickBeds, not the labor-pool basis crewCoverage uses
      shieldCoverage: s.pop > 0 ? Math.min(1, shieldCapacity(s.built) / s.pop) : 1,
      housingCapacity: housingCapacity(s.built),
      foodCapacityTotal: s.p.baseFoodCapacity + foodCapacity(s.built),
      waterCapacityTotal: s.p.baseWaterCapacity + waterCapacity(s.built),
      n2LeakKgPerWindow,
      ended: this.ended,
      collapsed: s.collapsed,
    };
  }

  /** Age structure + forecasts for the demography UI (roadmap-2). See DemographySnapshot for why
   * expectedOldAgeDeaths is statistical (never reads a colonist's own deathAge) while maturingSoon
   * is exactly computed (aging to adultAge is a fixed calendar, not a coin flip). */
  demography(): DemographySnapshot {
    const s = this.state;
    const buckets = AGE_BUCKETS.map((b) => ({
      label: b.label,
      count: s.colonists.reduce((n, c) => n + (c.age >= b.lo && c.age <= b.hi ? 1 : 0), 0),
    }));
    const avgAge = s.colonists.length ? s.colonists.reduce((a, c) => a + c.age, 0) / s.colonists.length : 0;
    const horizon = DEMOGRAPHY_FORECAST_WINDOWS * YEARS_PER_WINDOW;
    const maturingSoon = s.colonists.reduce(
      (n, c) => n + (c.age < s.p.adultAge && c.age + horizon >= s.p.adultAge ? 1 : 0),
      0,
    );
    return {
      buckets,
      avgAge,
      expectedOldAgeDeaths: computeExpectedOldAgeDeaths(s.colonists, s.p, DEMOGRAPHY_FORECAST_WINDOWS),
      maturingSoon,
    };
  }

  stocks(): Stocks {
    return { ...this.state.stocks };
  }
  /** What's already shipped and will land NEXT window (playtest bug: this was invisible — an
   * infeasible order silently ships nothing while the player has no way to see what, if anything,
   * is already inbound from last window's commit). */
  inTransit(): { stocks: Stocks; colonists: number; structures: Record<string, number> } {
    return {
      stocks: { ...this.state.inTransit.stocks },
      colonists: this.state.inTransit.colonists,
      structures: { ...this.state.inTransit.structures },
    };
  }
  lastReport(): ColonyReport | undefined {
    return this.last;
  }
  /** Full per-window report history (D-061) — the chronicle. Oldest first. */
  chronicle(): readonly ColonyReport[] {
    return this.state.chronicle;
  }

  /** Debrief (D-064) — undefined until the run has actually ended. Reads only the chronicle and
   * engine state; computes nothing that feeds back into gameplay. */
  debrief(): ColonyDebrief | undefined {
    if (!this.ended) return undefined;
    const s = this.state;
    const chronicle = s.chronicle;
    const reason: ColonyDebrief['reason'] = s.collapsed ? 'collapsed' : 'finished';

    // cause of collapse (D-061 attribution): walk back from the end through the CONSECUTIVE run of
    // windows with deaths — that's the terminal spiral, not the colony's entire death history. The
    // first quiet window behind it carries the buffer gauge as it stood when the spiral began.
    const collapseCause: Partial<Record<MortalityCause, number>> = {};
    let preSpiralBuffer: number | undefined;
    if (reason === 'collapsed') {
      for (let i = chronicle.length - 1; i >= 0; i--) {
        const r = chronicle[i]!;
        if (r.mortality <= 0) {
          preSpiralBuffer = r.buffer;
          break;
        }
        for (const [cause, n] of Object.entries(r.mortalityBreakdown ?? {}) as [MortalityCause, number][]) {
          collapseCause[cause] = (collapseCause[cause] ?? 0) + (n ?? 0);
        }
      }
    }

    const cr = collapseRunway(s);
    const milestones: MilestoneLine[] = MILESTONES.map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      window: s.milestones[m.id],
    }));

    return {
      reason,
      window: s.window,
      year: Math.round(s.window * 2.17 * 10) / 10,
      collapseCause,
      collapseRunwayWindows: cr,
      collapseRunwaySaturated: cr >= COLLAPSE_LOOKAHEAD,
      preSpiralBuffer,
      milestones,
      populationSeries: chronicle.map((r) => r.pop),
      autonomySeries: chronicle.map((r) => r.autonomyByMass * 100),
      stockSeries: {
        food: chronicle.map((r) => r.stocks.food),
        water: chronicle.map((r) => r.stocks.water),
        o2: chronicle.map((r) => r.stocks.o2),
        n2: chronicle.map((r) => r.stocks.n2),
      },
    };
  }

  allResources(): readonly ResourceKind[] {
    return RESOURCES;
  }
  catalog() {
    return this.state.p.catalog;
  }

  // ---- persistence --------------------------------------------------------

  private tryLoad(): ColonyState | null {
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      return raw ? loadColony(raw, defaultColonyParams()) : null; // hydrate+validate; version mismatch → null
    } catch {
      return null;
    }
  }
  private persist(): void {
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(serializeColony(this.state)));
    } catch {
      /* non-fatal */
    }
  }
}
