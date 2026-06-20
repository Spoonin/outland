// v2 store: owns the ColonyState, the draft Earth order, preview + commit, pub/sub, save/load.

import {
  newColony,
  defaultColonyParams,
  previewOrder,
  commitWindow,
  consumption,
  emptyOrder,
  marsPlanCost,
  marsPlanMaterials,
  prereqMet,
  resolveColonyEnergy,
  structureFlows,
  spareUpkeep,
  serializeColony,
  loadColony,
  STRUCTURES,
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
} from '../engine';

export interface ResourceCover {
  kind: ResourceKind;
  stock: number;
  perWindow: number; // net consumption / window (after recycling)
  windows: number; // windows of cover (Infinity if not consumed)
}

export interface ColonyStatus {
  window: number;
  year: number;
  pop: number;
  pads: Record<LaunchTech, number>;
  refuelUnlocked: boolean;
  budget: number;
  runway: number; // min cover among life-support
  cover: ResourceCover[];
  energyGen: number;
  energyDemand: number;
  energyDeficit: number;
  avgCondition: number; // mean structure condition 0..1 (V6)
  sparesCoverage: number; // spares stock vs upkeep need
  ended: boolean;
  collapsed: boolean;
}

/** Combined window plan (Earth order + Mars build) — feasibility for the shared commit footer. */
export interface CommitPlan {
  earth: OrderPreview;
  marsCost: number;
  totalCost: number;
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

  get ended(): boolean {
    return this.state.collapsed || this.state.window >= this.state.p.maxWindows;
  }

  // ---- draft order --------------------------------------------------------

  order(): EarthOrder {
    return {
      ...emptyOrder(),
      resources: { ...this.draftRes },
      padsToBuild: { ...this.draftPads },
      unlockRefuel: this.draftUnlockRefuel,
      colonists: this.draftColonists,
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
  /** Marginal delivery cost per kg = cheapest usable pad class's launchCost/payload (D-038). */
  deliveryPerKg(): { perKg: number; tech: LaunchTech } {
    const lp = this.state.p.launch;
    const usable: LaunchTech[] = this.state.fleet.refuelUnlocked ? ['classic', 'refuel'] : ['classic'];
    let best: LaunchTech = 'classic';
    let bestV = Infinity;
    for (const t of usable) {
      const v = (t === 'refuel' ? lp.refuel : lp.classic).launchCost / (t === 'refuel' ? lp.refuel : lp.classic).payload;
      if (v < bestV) {
        bestV = v;
        best = t;
      }
    }
    return { perKg: bestV, tech: best };
  }
  get colonists(): number {
    return this.draftColonists;
  }
  setColonists(n: number): void {
    this.draftColonists = Math.max(0, Math.floor(n || 0));
    this.emit();
  }
  preview(): OrderPreview {
    return previewOrder(this.state, this.order());
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
    const marsCost = marsPlanCost(this.state, this.draftBuild);
    const need = marsPlanMaterials(this.draftBuild);
    const materialsShort = (Object.keys(need) as ResourceKind[]).filter(
      (r) => this.state.stocks[r] < (need[r] ?? 0),
    );
    const prereqMissing = [...new Set(this.draftBuild.filter((id) => !prereqMet(this.state, id)))];
    const totalCost = earth.total + marsCost;
    const overBudget = totalCost > this.state.p.M;
    return {
      earth,
      marsCost,
      totalCost,
      budget: this.state.p.M,
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
    this.persist();
    this.emit();
  }

  // ---- read models --------------------------------------------------------

  status(): ColonyStatus {
    const s = this.state;
    const cons = consumption(s);
    const energy = resolveColonyEnergy(s.built, s.p.popEnergyPerCapita * s.pop, s.condition);
    const sf = structureFlows(s.built, energy.served, undefined, s.condition);
    // production-aware cover (V6): net drain = gross·(1−recycle) − local production
    const cover: ResourceCover[] = LIFE.map((r) => {
      const gross = (cons[r] ?? 0) * (1 - s.p.catalog[r].recycle);
      const perWindow = Math.max(0, gross - (sf.production[r] ?? 0));
      const stock = s.stocks[r];
      return { kind: r, stock, perWindow, windows: perWindow > 0 ? stock / perWindow : Infinity };
    });
    const runway = Math.min(...cover.map((c) => c.windows));
    const upkeep = spareUpkeep(s.built);
    const builtIds = Object.keys(s.built).filter((id) => (s.built[id] ?? 0) > 0);
    const avgCondition = builtIds.length
      ? builtIds.reduce((a, id) => a + (s.condition[id] ?? 1), 0) / builtIds.length
      : 1;
    return {
      window: s.window,
      year: Math.round(s.window * 2.17 * 10) / 10,
      pop: Math.round(s.pop),
      pads: { ...s.fleet.pads },
      refuelUnlocked: s.fleet.refuelUnlocked,
      budget: s.p.M,
      runway: Number.isFinite(runway) ? Math.round(runway * 10) / 10 : Infinity,
      cover,
      energyGen: energy.generation,
      energyDemand: energy.generation + energy.deficit,
      energyDeficit: energy.deficit,
      avgCondition,
      sparesCoverage: upkeep > 0 ? Math.min(1, s.stocks.spares / upkeep) : 1,
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
