// Game store: owns the engine GameState, drives windows, notifies subscribers (SDD UI layer).
// Framework-agnostic pub/sub so the Lit components stay thin.

import {
  defaultParams,
  newState,
  step,
  needs,
  nodeStatus,
  GRAPH,
  type GameState,
  type Params,
  type StepReport,
  type NodeStatus,
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
  M: number;
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

  /** Advance one synodic window (the "Ход" action). */
  advance(): void {
    if (this.ended) return;
    this.history.push(step(this.state));
    this.emit();
  }

  reset(params: Params = this.state.p): void {
    this.state = newState(params);
    this.history = [];
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
    return {
      window: s.window,
      year: Math.round(s.window * 2.17 * 10) / 10,
      pop: Math.round(s.pop),
      autonomy: last?.autonomy ?? 0,
      F,
      M: s.p.M,
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
