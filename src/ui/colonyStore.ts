// v2 store: owns the ColonyState, the draft Earth order, preview + commit, pub/sub, save/load.

import {
  newColony,
  defaultColonyParams,
  previewOrder,
  commitWindow,
  consumption,
  RESOURCES,
  type ColonyState,
  type ColonyParams,
  type EarthOrder,
  type OrderPreview,
  type ColonyReport,
  type ResourceKind,
  type Stocks,
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
  pads: number;
  tech: string;
  budget: number;
  runway: number; // min cover among life-support
  cover: ResourceCover[];
  ended: boolean;
  collapsed: boolean;
}

type Listener = () => void;

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SAVE_KEY = 'outland.colony.v1';
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
  private draftPads = 0;
  private draftColonists = 0;

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
    return { resources: { ...this.draftRes }, padsToBuild: this.draftPads, colonists: this.draftColonists };
  }
  resQty(r: ResourceKind): number {
    return this.draftRes[r] ?? 0;
  }
  setRes(r: ResourceKind, qty: number): void {
    this.draftRes[r] = Math.max(0, Math.round(qty || 0));
    this.emit();
  }
  get pads(): number {
    return this.draftPads;
  }
  setPads(n: number): void {
    this.draftPads = Math.max(0, Math.floor(n || 0));
    this.emit();
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

  commit(): void {
    if (this.ended) return;
    this.last = commitWindow(this.state, this.order());
    this.draftRes = {};
    this.draftPads = 0;
    this.draftColonists = 0;
    this.persist();
    this.emit();
  }

  reset(params: ColonyParams = this.state.p): void {
    this.state = newColony(params);
    this.last = undefined;
    this.draftRes = {};
    this.draftPads = 0;
    this.draftColonists = 0;
    this.persist();
    this.emit();
  }

  // ---- read models --------------------------------------------------------

  status(): ColonyStatus {
    const s = this.state;
    const cons = consumption(s);
    const cover: ResourceCover[] = LIFE.map((r) => {
      const eff = s.p.catalog[r].recycle;
      const perWindow = (cons[r] ?? 0) * (1 - eff);
      const stock = s.stocks[r];
      return { kind: r, stock, perWindow, windows: perWindow > 0 ? stock / perWindow : Infinity };
    });
    const runway = Math.min(...cover.map((c) => c.windows));
    return {
      window: s.window,
      year: Math.round(s.window * 2.17 * 10) / 10,
      pop: Math.round(s.pop),
      pads: s.fleet.pads,
      tech: s.fleet.tech,
      budget: s.p.M,
      runway: Number.isFinite(runway) ? Math.round(runway * 10) / 10 : Infinity,
      cover,
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
      if (!raw) return null;
      const o = JSON.parse(raw) as { v: 1; state: ColonyState };
      return o.v === 1 ? o.state : null;
    } catch {
      return null;
    }
  }
  private persist(): void {
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify({ v: 1, state: this.state }));
    } catch {
      /* non-fatal */
    }
  }
}
