// Game store: owns the engine GameState, drives windows, notifies subscribers (SDD UI layer).
// Framework-agnostic pub/sub so the Lit components stay thin.

import {
  defaultParams,
  newState,
  step,
  needs,
  nodeStatus,
  nodeEconomics,
  priceMultNow,
  endReason,
  planView,
  serializeState,
  deserializeState,
  GRAPH,
  NODES,
  type GameState,
  type Params,
  type StepReport,
  type NodeStatus,
  type PlanView,
  type Node,
  type NodeEconomics,
  type EndReason,
  type SerializedState,
} from '../engine';

export interface NodeView {
  name: string;
  tier: number;
  status: NodeStatus;
}

/**
 * View model for the dashboard. NOTE: survival runway / self-sufficiency is deliberately
 * absent (D-025) — it is debrief-only, never a live gauge.
 */
export interface Snapshot {
  window: number;
  year: number;
  pop: number;
  autonomy: number; // loud headline (D-010)
  F: number;
  M: number; // nominal subsidy
  realM: number; // M eroded by cumulative Earth inflation (D-031 — the trillion shrinks)
  inflationPct: number; // per-window inflation rate
  erosionPct: number; // cumulative loss of M's real value, %
  fm: number; // F / M (dim)
  free: number;
  effPerKg: number;
  launchK: number;
  fusion: string;
  events: string[];
  collapsed: boolean;
  ended: boolean;
  nodes: NodeView[];
}

/** End-of-game retrospective (mechanics §7.5, D-025/D-036) — meaning delivery. */
export interface Debrief {
  reason: EndReason;
  windows: number;
  year: number;
  peakAutonomy: number;
  finalAutonomy: number;
  runwayWindows: number; // self-sufficiency — NAMED here for the first time (D-025)
  runwayMonths: number;
  finalFM: number;
  erosionPct: number;
  blackCeiling: string[]; // critical black nodes that capped autonomy
  autonomyCurve: number[]; // per-window %
  fmCurve: number[];
}

type Listener = () => void;

/** Minimal Web Storage subset, injectable for tests / node. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface SaveBlob {
  v: 1;
  state: SerializedState;
  history: StepReport[];
}

const SAVE_KEY = 'outland.save.v1';

const memoryKV: KV = (() => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
})();

function defaultStorage(): KV {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : memoryKV;
  } catch {
    return memoryKV;
  }
}

export class GameStore {
  private state: GameState;
  private history: StepReport[] = [];
  private listeners = new Set<Listener>();
  private draftLocalize = new Set<string>();
  private draftColonists = 0;
  private focusNode: string | null = null;
  private expanded = new Set<string>();
  private storage: KV;

  /** With explicit params → fresh game (tests). Without → autoload save if present (the app). */
  constructor(params?: Params, storage: KV = defaultStorage()) {
    this.storage = storage;
    if (params) {
      this.state = newState(params);
    } else {
      const loaded = this.tryLoad();
      if (loaded) {
        this.state = loaded.state;
        this.history = loaded.history;
      } else {
        this.state = newState(defaultParams());
      }
    }
  }

  private tryLoad(): { state: GameState; history: StepReport[] } | null {
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return null;
      const blob = JSON.parse(raw) as SaveBlob;
      if (blob.v !== 1) return null;
      return { state: deserializeState(blob.state), history: blob.history };
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      const blob: SaveBlob = { v: 1, state: serializeState(this.state), history: this.history };
      this.storage.setItem(SAVE_KEY, JSON.stringify(blob));
    } catch {
      /* storage unavailable / quota — non-fatal */
    }
  }

  hasSave(): boolean {
    return this.storage.getItem(SAVE_KEY) !== null;
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

  // ---- window-manifest draft (Phase 3) ------------------------------------

  plan(): PlanView {
    return planView(this.state);
  }

  isPicked(name: string): boolean {
    return this.draftLocalize.has(name);
  }

  toggleLocalize(name: string): void {
    if (this.draftLocalize.has(name)) this.draftLocalize.delete(name);
    else this.draftLocalize.add(name);
    this.emit();
  }

  get draftColonistCount(): number {
    return this.draftColonists;
  }

  setColonists(n: number): void {
    this.draftColonists = Math.max(0, Math.floor(n || 0));
    this.emit();
  }

  /** Commit the manifest → advance one synodic window with the player's decision. */
  commit(): void {
    if (this.ended) return;
    this.history.push(
      step(this.state, { localize: [...this.draftLocalize], colonists: this.draftColonists }),
    );
    this.draftLocalize.clear();
    this.draftColonists = 0;
    this.persist();
    this.emit();
  }

  // ---- object-tree drill-down (Phase 4) -----------------------------------

  get focus(): string | null {
    return this.focusNode;
  }

  setFocus(name: string | null): void {
    this.focusNode = name;
    this.emit();
  }

  isExpanded(name: string): boolean {
    return this.expanded.has(name);
  }

  toggleExpand(name: string): void {
    if (this.expanded.has(name)) this.expanded.delete(name);
    else this.expanded.add(name);
    this.emit();
  }

  /** Live demand map (cheap; recomputed per call). */
  needsNow(): Record<string, number> {
    return needs(this.state);
  }

  nodeOf(name: string): Node | undefined {
    return NODES[name];
  }

  statusOf(name: string, nd: Record<string, number> = this.needsNow()): NodeStatus {
    return nodeStatus(this.state, nd, NODES[name]!);
  }

  econOf(name: string, nd: Record<string, number> = this.needsNow()): NodeEconomics {
    return nodeEconomics(this.state, nd, NODES[name]!, priceMultNow(this.state));
  }

  canLocalize(name: string, nd: Record<string, number> = this.needsNow()): boolean {
    return this.statusOf(name, nd) === 'buildable';
  }

  /** Greedy auto-advance (no player decision) — kept for testing / a "skip" affordance. */
  advance(): void {
    if (this.ended) return;
    this.history.push(step(this.state));
    this.persist();
    this.emit();
  }

  reset(params: Params = this.state.p): void {
    this.state = newState(params);
    this.history = [];
    this.draftLocalize.clear();
    this.draftColonists = 0;
    this.focusNode = null;
    this.expanded.clear();
    this.persist();
    this.emit();
  }

  latest(): StepReport | undefined {
    return this.history[this.history.length - 1];
  }

  endReason(): EndReason {
    return endReason(this.state);
  }

  /** Retrospective shown at game end (§7.5). Survival runway is named here for the first time. */
  debrief(): Debrief {
    const last = this.latest();
    const runwayWindows = last?.runway ?? 0.5;
    const autonomyCurve = this.history.map((r) => r.autonomy * 100);
    return {
      reason: endReason(this.state),
      windows: this.state.window,
      year: Math.round(this.state.window * 2.17 * 10) / 10,
      peakAutonomy: autonomyCurve.length ? Math.max(...autonomyCurve) : 0,
      finalAutonomy: last ? last.autonomy * 100 : 0,
      runwayWindows,
      runwayMonths: Math.round(runwayWindows * 26),
      finalFM: last ? last.F / this.state.p.M : 0,
      erosionPct: (1 - 1 / priceMultNow(this.state)) * 100,
      blackCeiling: GRAPH.filter((n) => n.black && n.crit >= 0.5).map((n) => n.name),
      autonomyCurve,
      fmCurve: this.history.map((r) => r.F / this.state.p.M),
    };
  }

  getHistory(): readonly StepReport[] {
    return this.history;
  }

  snapshot(): Snapshot {
    const s = this.state;
    const nd = needs(s);
    const last = this.latest();
    const nodes: NodeView[] = GRAPH.map((n) => ({
      name: n.name,
      tier: n.tier,
      status: nodeStatus(s, nd, n),
    }));
    const F = last?.F ?? 0;
    const inflationFactor = Math.pow(1 + s.p.inflation, s.window);
    const realM = s.p.M / inflationFactor;
    return {
      window: s.window,
      year: Math.round(s.window * 2.17 * 10) / 10,
      pop: Math.round(s.pop),
      autonomy: last?.autonomy ?? 0,
      F,
      M: s.p.M,
      realM,
      inflationPct: s.p.inflation,
      erosionPct: (1 - 1 / inflationFactor) * 100,
      fm: F / s.p.M,
      free: last?.free ?? 0,
      effPerKg: last?.effPerKg ?? 0,
      launchK: last?.launchK ?? 0,
      fusion: s.fusion,
      events: last?.events ?? [],
      collapsed: s.collapsed,
      ended: this.ended,
      nodes,
    };
  }
}
