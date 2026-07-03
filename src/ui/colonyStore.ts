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
  structureImportPlan,
  colonyPriceMult,
  resolveColonyEnergy,
  structureFlows,
  spareUpkeep,
  housingCapacity,
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
  STRUCTURES,
  STRUCT_BY_ID,
  RESOURCES,
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
} from '../engine';

export interface ResourceLine {
  kind: ResourceKind;
  stock: number;
  net: number; // local production − total consumption per window (no imports); <0 = draining
  windows: number; // windows of cover if draining (Infinity if net ≥ 0)
  lifeSupport: boolean;
}

export interface ColonyStatus {
  window: number;
  year: number;
  pop: number;
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
  housingCapacity: number; // total colonist slots from habitats (V7); 0 = unconstrained
  n2LeakKgPerWindow: number; // structural N₂ hull leak per window (V7)
  ended: boolean; // collapsed, or the player clicked "finish" (D-064) — never a time/window limit
  collapsed: boolean;
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
  feasible: boolean;
}

type Listener = () => void;

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SAVE_KEY = 'outland.colony'; // versioning handled inside the save blob (D-051), not the key
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

export class ColonyStore {
  private state: ColonyState;
  private last?: ColonyReport;
  private listeners = new Set<Listener>();
  private storage: KV;
  // draft order
  private draftRes: Partial<Record<ResourceKind, number>> = {};
  private draftPads: Record<LaunchTech, number> = { classic: 0, refuel: 0 };
  private draftUnlockRefuel = false;
  private draftColonists = 0;
  private draftBuild: string[] = [];
  private draftImport: Record<string, number> = {}; // structures to import fully built (V8, D-057)
  // D-062: the honest buffer simulation only depends on the committed state, not the draft order
  // being edited — cache by window so it isn't re-run on every slider tick (would be a 12-window
  // engine simulation per keystroke otherwise).
  private bufferCache?: { window: number; value: number };
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
      resources: { ...this.draftRes },
      padsToBuild: { ...this.draftPads },
      unlockRefuel: this.draftUnlockRefuel,
      colonists: this.draftColonists,
      structures: { ...this.draftImport },
    };
  }
  resQty(r: ResourceKind): number {
    return this.draftRes[r] ?? 0;
  }
  setRes(r: ResourceKind, qty: number): void {
    this.draftRes[r] = Math.max(0, Math.round(qty || 0));
    this.emit();
  }
  padQty(tech: LaunchTech): number {
    return this.draftPads[tech];
  }
  setPad(tech: LaunchTech, n: number): void {
    this.draftPads[tech] = Math.max(0, Math.floor(n || 0));
    this.emit();
  }
  get unlockRefuelDraft(): boolean {
    return this.draftUnlockRefuel;
  }
  toggleUnlockRefuel(): void {
    this.draftUnlockRefuel = !this.draftUnlockRefuel;
    this.emit();
  }
  fleet(): Fleet {
    return this.state.fleet;
  }
  launch(): LaunchParams {
    return this.state.p.launch;
  }
  /** Marginal delivery cost per kg = cheapest usable pad class's launchCost/payload (D-038);
   * refuel economics depend on the bought R&D stage (D-068). */
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
    return { perKg: bestV, tech: best };
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
  preview(): OrderPreview {
    return previewOrder(this.state, this.order());
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

  /** Combined Earth+Mars plan for the shared commit footer. */
  plan(): CommitPlan {
    const earth = this.preview();
    const need = marsPlanMaterials(this.draftBuild);
    const materialsShort = (Object.keys(need) as ResourceKind[]).filter(
      (r) => this.state.stocks[r] < (need[r] ?? 0),
    );
    const importIds = Object.keys(this.draftImport).filter((id) => (this.draftImport[id] ?? 0) > 0);
    const prereqMissing = [
      ...new Set([...this.draftBuild, ...importIds].filter((id) => !prereqMet(this.state, id))),
    ];
    const totalCost = earth.total; // Mars build is money-free (D-054)
    // earth.budget already folds in any active subsidy_cut event (D-063)
    const overBudget = totalCost > earth.budget;
    return {
      earth,
      totalCost,
      budget: earth.budget,
      overBudget,
      materialsShort,
      prereqMissing,
      feasible:
        !earth.capped && !overBudget && materialsShort.length === 0 && prereqMissing.length === 0,
    };
  }

  commit(): void {
    if (this.ended) return;
    this.last = commitWindow(this.state, this.order(), [...this.draftBuild]);
    this.draftRes = {};
    this.draftPads = { classic: 0, refuel: 0 };
    this.draftUnlockRefuel = false;
    this.draftColonists = 0;
    this.draftBuild = [];
    this.draftImport = {};
    this.persist();
    this.emit();
  }

  reset(params: ColonyParams = this.state.p): void {
    this.state = newColony(params);
    this.last = undefined;
    this.draftRes = {};
    this.draftPads = { classic: 0, refuel: 0 };
    this.draftUnlockRefuel = false;
    this.draftColonists = 0;
    this.draftBuild = [];
    this.draftImport = {};
    this.bufferCache = undefined;
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
      pop: Math.round(s.pop),
      pads: { ...s.fleet.pads },
      refuelStage: s.fleet.refuelStage,
      budget: s.p.M,
      buffer: buf,
      bufferSaturated: buf >= BUFFER_LOOKAHEAD,
      resources,
      energyGen: energy.generation,
      energyDemand: energy.generation + energy.deficit,
      energyDeficit: energy.deficit,
      avgCondition,
      sparesCoverage: upkeep > 0 ? Math.min(1, s.stocks.spares / upkeep) : 1,
      housingCapacity: housingCapacity(s.built),
      n2LeakKgPerWindow,
      ended: this.ended,
      collapsed: s.collapsed,
    };
  }

  stocks(): Stocks {
    return { ...this.state.stocks };
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
      return raw ? loadColony(raw, defaultColonyParams()) : null; // migrate+hydrate+validate (D-051)
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
