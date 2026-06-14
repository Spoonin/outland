// Game store: owns the engine GameState, drives windows, notifies subscribers (SDD UI layer).
// Framework-agnostic pub/sub so the Lit components stay thin.

import {
  defaultParams,
  newState,
  step,
  needs,
  nodeStatus,
  planView,
  GRAPH,
  type GameState,
  type Params,
  type StepReport,
  type NodeStatus,
  type PlanView,
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

type Listener = () => void;

export class GameStore {
  private state: GameState;
  private history: StepReport[] = [];
  private listeners = new Set<Listener>();
  private draftLocalize = new Set<string>();
  private draftColonists = 0;

  constructor(params: Params = defaultParams()) {
    this.state = newState(params);
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
    this.emit();
  }

  /** Greedy auto-advance (no player decision) — kept for testing / a "skip" affordance. */
  advance(): void {
    if (this.ended) return;
    this.history.push(step(this.state));
    this.emit();
  }

  reset(params: Params = this.state.p): void {
    this.state = newState(params);
    this.history = [];
    this.draftLocalize.clear();
    this.draftColonists = 0;
    this.emit();
  }

  latest(): StepReport | undefined {
    return this.history[this.history.length - 1];
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
