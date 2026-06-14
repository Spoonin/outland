"""
PROTOTYPE — throwaway. Question: does the *refined* Outland model (real node
graph, derived demand, inflation, Earth events, population as a lever) still
converge to failure gradually — autonomy plateaus below 100% while
self-sufficiency (survival runway) stays near zero?

Pure logic module; sim.py is a thin TUI shell. Refined per grill decisions:
- D-026 graph of individually-authored NODES (tier = depth attribute → MES).
- D-029 demand = consumption + DERIVED (localizing a node loads its inputs;
  shared upstream like catalyst/chips/water aggregates demand from consumers).
- D-027 single money ledger; price = earth_cost + mass*c.
- D-031 Earth inflation erodes the subsidy's real value; Earth events cut it /
  spike prices.
- D-030 population is a lever: import colonists (one-time cost + permanent demand
  tail) + births only if maternity infra is localized.
- D-025 autonomy (by mass, seductive) vs self-sufficiency (survival runway).
Out of scope (not curve-relevant): D-035 paid survey (about knowledge, not money
curve); skill-pipeline MES gate folded into the single process-MES gate.
"""

from dataclasses import dataclass, field
from typing import List, Tuple, Dict
import math
import random


@dataclass(frozen=True)
class Node:
    name: str
    tier: int                       # depth attribute → drives MES
    mass: float                     # kg per unit (autonomy-by-mass + shipping)
    earth_cost: float               # intrinsic money per unit
    cons: float                     # per-capita consumption (0 = pure intermediate)
    inputs: Tuple[Tuple[str, float], ...]  # (input node, qty per unit)
    black: bool = False
    crit: float = 0.0               # criticality weight (self-sufficiency)


# Authored graph (~28 nodes, mirrors documents/graph.md). Bulk = heavy/cheap/shallow
# (shipping-dominated); hi-tech/black = light/dear/deep (intrinsic-cost-dominated).
GRAPH: List[Node] = [
    # T1 — ISRU bulk
    Node("water",            1, 100, 1,    2.0, (), crit=1.0),
    Node("oxygen",           1, 20,  1,    1.0, (("water", 0.3),), crit=1.0),
    Node("regolith",         1, 300, 0.5,  0.0, (), crit=0.1),
    Node("co2",              1, 5,   0.2,  0.0, (), crit=0.2),
    Node("nitrogen",         1, 8,   0.5,  0.0, (), crit=0.3),
    # T2 — primary processing
    Node("hydrogen",         2, 2,   5,    0.0, (("water", 1.0),), crit=0.3),
    Node("steel",            2, 200, 2,    0.3, (("regolith", 0.6),), crit=0.4),
    Node("structural_metal", 2, 60,  8,    0.0, (("regolith", 0.5),), crit=0.3),
    Node("silica_glass",     2, 80,  3,    0.1, (("regolith", 0.4),), crit=0.2),
    # T3 — chemistry (catalyst is a root input → poisoner)
    Node("methane_fuel",     3, 30,  30,   0.2, (("hydrogen", 0.5), ("co2", 0.3), ("catalyst", 0.03)), crit=0.3),
    Node("ammonia",          3, 8,   15,   0.0, (("hydrogen", 0.3), ("nitrogen", 0.2), ("catalyst", 0.02)), crit=0.4),
    Node("ceramics",         3, 40,  10,   0.1, (("silica_glass", 0.4), ("regolith", 0.2)), crit=0.2),
    Node("base_polymer",     3, 15,  40,   0.2, (("methane_fuel", 0.2), ("catalyst", 0.05)), crit=0.3),
    # T4 — agro + advanced materials
    Node("fertilizer",       4, 10,  20,   0.0, (("ammonia", 0.5), ("catalyst", 0.05)), crit=0.6),
    Node("food",             4, 50,  5,    1.5, (("water", 0.5), ("fertilizer", 0.2)), crit=1.0),
    Node("epoxy",            4, 12,  120,  0.3, (("base_polymer", 0.4), ("catalyst", 0.05)), crit=0.3),
    Node("battery",          4, 20,  200,  0.2, (("structural_metal", 0.3), ("electronics", 0.05), ("ceramics", 0.1)), crit=0.5),
    Node("electric_motor",   4, 35,  150,  0.1, (("special_alloy", 0.1), ("electronics", 0.1), ("structural_metal", 0.3)), crit=0.5),
    # T5 — machinery + infra (forever pull black inputs)
    Node("machinery",        5, 40,  80,   0.3, (("steel", 0.5), ("electric_motor", 0.1), ("special_alloy", 0.1)), crit=0.6),
    Node("solar_panel",      5, 25,  300,  0.2, (("silica_glass", 0.3), ("electronics", 0.1), ("special_alloy", 0.05)), crit=0.6),
    Node("medical_infra",    5, 30,  500,  0.0, (("electronics", 0.05), ("machinery", 0.1), ("pharma", 0.05)), crit=0.7),  # → births
    Node("precision_mech",   5, 5,   400,  0.0, (("special_alloy", 0.05), ("precision_metrology", 0.02)), crit=0.4),
    # black nodes: deep, light (cheap shipping) but DEAR by intrinsic cost; never localize
    Node("special_alloy",       6, 12,  1.5e8, 0.0,  (), black=True, crit=0.4),
    Node("catalyst",            6, 0.5, 8.0e7, 0.0,  (), black=True, crit=0.9),
    Node("precision_metrology", 6, 1,   1.2e8, 0.0,  (), black=True, crit=0.5),
    Node("electronics",         7, 0.2, 2.5e8, 0.05, (), black=True, crit=0.9),
    Node("pharma",              7, 0.3, 2.0e8, 0.05, (), black=True, crit=1.0),
]
NODES: Dict[str, Node] = {n.name: n for n in GRAPH}
# consumers[n] = list of (consumer_name, qty) — who uses n as an input
CONSUMERS: Dict[str, List[Tuple[str, float]]] = {n.name: [] for n in GRAPH}
for _m in GRAPH:
    for _inp, _q in _m.inputs:
        CONSUMERS[_inp].append((_m.name, _q))


@dataclass
class Params:
    M: float = 1.0e12
    # D-038: shipping is NOT a fixed price `c`. Launch capacity is a capital asset:
    #   shipping cost/window = fuel_per_kg·W (marginal) + maint on built capacity K (idle, sunk).
    fuel_per_kg: float = 400.0       # marginal shipping floor (Starship target, refs §3)
    launch_capex_per_kg: float = 4.0e4   # capex to build 1 kg/window of sustained capacity
    launch_maint_frac: float = 0.08  # per-window amortization on built K (paid even if idle)
    mes0: float = 300.0
    k: float = 2.0
    capital_factor: float = 5.0e7    # calibrated: the knee where affordability stops binding,
    #                                  MES gate on black nodes takes over (see NOTES 4th pass)

    tail_max: float = 0.18
    tail_ramp: float = 3.0

    pop0: float = 1000.0
    mort_factor: float = 0.8
    revert_hysteresis: float = 0.9

    # population lever (D-030)
    colonist_cost: float = 3.0e8     # one-time money per colonist landed
    colonist_frac: float = 0.25      # fraction of leftover surplus spent on colonists
    colonist_reserve: float = 0.15   # keep this fraction of M as buffer before importing people
    birth_rate: float = 0.06         # per-window growth IF maternity localized

    # Earth side (D-031)
    inflation: float = 0.03          # per-window real erosion of the subsidy
    earth_event_prob: float = 0.10
    earth_cut: float = 0.5           # subsidy multiplier on a "cut" event
    earth_spike: float = 1.6         # price multiplier on a "spike" event

    # events (§12)
    enable_events: bool = True
    seed: int = 1
    breakdown_base: float = 0.03
    breakdown_margin: float = 0.20

    # megaproject fusion (§11 / D-033) — saved from surplus, optimistic, delays only
    enable_fusion: bool = True
    fusion_cost_M: float = 3.0
    fusion_save_frac: float = 0.6
    fusion_discount: float = 0.30
    fusion_maint_M: float = 0.10

    max_windows: int = 40


@dataclass
class State:
    p: Params
    window: int = 0
    pop: float = 0.0
    localized: Dict[str, bool] = field(default_factory=dict)
    age: Dict[str, int] = field(default_factory=dict)
    collapsed: bool = False
    plateaued_at: int = -1
    last_autonomy: float = 0.0
    rng: random.Random = field(default_factory=random.Random)
    fusion: str = "none"             # none / saving / online
    fusion_fund: float = 0.0
    launch_K: float = 0.0            # built launch capacity (kg/window), sunk + maintained (D-038)

    @staticmethod
    def new(p: Params) -> "State":
        return State(
            p=p, pop=p.pop0,
            localized={n.name: False for n in GRAPH},
            age={n.name: 0 for n in GRAPH},
            rng=random.Random(p.seed),
        )


# ---- pure helpers ---------------------------------------------------------

def mes(p: Params, node: Node) -> float:
    return math.inf if node.black else p.mes0 * (p.k ** (node.tier - 1))


def tail_frac(p: Params, age: int) -> float:
    return p.tail_max * (1.0 - math.exp(-age / p.tail_ramp))


def needs(s: State) -> Dict[str, float]:
    """Per-node demand = consumption + derived (from localized consumers). DAG, memoized."""
    p = s.p
    memo: Dict[str, float] = {}

    def need(name: str) -> float:
        if name in memo:
            return memo[name]
        n = NODES[name]
        total = n.cons * s.pop
        for cons_name, qty in CONSUMERS[name]:
            if s.localized[cons_name]:        # imported finished goods create NO derived demand
                total += qty * need(cons_name)
        memo[name] = total
        return total

    for n in GRAPH:
        need(n.name)
    return memo


def import_breakdown(s: State, nd: Dict[str, float], price_mult: float = 1.0):
    """Returns (f_imp, ship_mass): f_imp = intrinsic earth_cost + marginal fuel shipping for
    every imported node; ship_mass = total imported kg/window (drives launch-capacity need).
    Launch-capacity maintenance is added separately in step() (it's sunk, not per-import). D-038."""
    p = s.p
    f, W = 0.0, 0.0
    for n in GRAPH:
        imported_units = nd[n.name] * (tail_frac(p, s.age[n.name]) if s.localized[n.name] else 1.0)
        f += imported_units * (n.earth_cost + n.mass * p.fuel_per_kg) * price_mult
        W += imported_units * n.mass
    if s.fusion == "online":
        f = f * (1.0 - p.fusion_discount) + p.fusion_maint_M * p.M * (s.pop / p.pop0)
    return f, W


def launch_maint(s: State) -> float:
    """Per-window amortization on built capacity — paid even when idle (no Earth reuse). D-038."""
    return s.p.launch_maint_frac * s.p.launch_capex_per_kg * s.launch_K


def autonomy_by_mass(s: State, nd: Dict[str, float]) -> float:
    p = s.p
    tot = sum(nd[n.name] * n.mass for n in GRAPH)
    loc = sum(nd[n.name] * (1.0 - tail_frac(p, s.age[n.name])) * n.mass
              for n in GRAPH if s.localized[n.name])
    return loc / tot if tot else 0.0


def survival_runway(s: State, nd: Dict[str, float]) -> float:
    """Self-sufficiency (D-025): ~windows survivable if imports cut now. Liebig's law —
    gated by the WORST-covered critical node, not the average. Pharma/chips are critical
    AND black → never local → worst coverage ≈ 0 → runway pinned near the stockpile floor,
    no matter how high autonomy climbs. That gap is the thesis."""
    p = s.p
    worst = 1.0
    for n in GRAPH:
        if n.crit < 0.5:
            continue
        d = nd[n.name]
        if d <= 0:
            continue
        local = d * (1.0 - tail_frac(p, s.age[n.name])) if s.localized[n.name] else 0.0
        worst = min(worst, local / d)
    return round(0.5 + worst * 3.0, 1)      # 0.5-window stockpile + best-case scaling


# ---- the step -------------------------------------------------------------

def step(s: State) -> dict:
    p = s.p
    rng = s.rng
    s.window += 1
    events = []

    # Earth inflation: real erosion of the subsidy (D-031)
    infl = (1.0 + p.inflation) ** s.window
    price_mult = infl
    m_eff = p.M

    # Earth event: cut subsidy or spike prices (D-031)
    if p.enable_events and rng.random() < p.earth_event_prob:
        if rng.random() < 0.5:
            m_eff *= p.earth_cut
            events.append("земля: урезание субсидии")
        else:
            price_mult *= p.earth_spike
            events.append("земля: скачок цен")

    # breakdown: revert a localized node (odds rise with fragility) (§12.4)
    nd = needs(s)
    f_pre, _ = import_breakdown(s, nd, price_mult)
    f_pre += launch_maint(s)
    if p.enable_events and f_pre > 0:
        bd = p.breakdown_base + p.breakdown_margin * min(2.0, f_pre / p.M)
        loc = [n.name for n in GRAPH if s.localized[n.name]]
        if loc and rng.random() < bd:
            t = rng.choice(loc)
            s.localized[t] = False
            s.age[t] = 0
            events.append(f"поломка: {t}")

    nd = needs(s)
    f_imp, ship_mass = import_breakdown(s, nd, price_mult)

    # launch capacity (D-038): explicit player lever. Auto-policy builds K to cover this
    # window's import mass (one-time capex); K is sunk and maintained even when later idle.
    launch_capex_now = 0.0
    if ship_mass > s.launch_K:
        launch_capex_now = (ship_mass - s.launch_K) * p.launch_capex_per_kg
        s.launch_K = ship_mass
    f = f_imp + launch_maint(s)            # recurring outflow (imports + idle-capacity amortization)
    free = m_eff - f - launch_capex_now    # capex competes in the single ledger

    # megaproject fusion: save from surplus once autonomy plateaus (D-033)
    if p.enable_fusion and s.fusion == "none" and not s.collapsed and s.plateaued_at > 0:
        s.fusion = "saving"
        events.append("⚡решение строить термояд")
    if s.fusion == "saving" and free > 0:
        contrib = free * p.fusion_save_frac
        free -= contrib
        s.fusion_fund += contrib
        if s.fusion_fund >= p.fusion_cost_M * p.M:
            s.fusion = "online"
            events.append("⚡термояд онлайн")

    localized_this, reverted = [], []
    mortality = 0.0

    if free >= 0:
        capital = free
        # greedy localize: best F-saved per capital among eligible (need ≥ MES, not black)
        while True:
            best, best_ratio = None, 0.0
            for n in GRAPH:
                if s.localized[n.name] or n.black or nd[n.name] < mes(p, n):
                    continue
                cap = p.capital_factor * mes(p, n)
                if cap > capital:
                    continue
                # localizing saves intrinsic + marginal fuel shipping (capacity maint is sunk)
                price = (n.earth_cost + n.mass * p.fuel_per_kg) * price_mult
                saved = nd[n.name] * (1.0 - p.tail_max) * price
                ratio = saved / cap
                if ratio > best_ratio:
                    best, best_ratio = n, ratio
            if best is None:
                break
            s.localized[best.name] = True
            s.age[best.name] = 0
            capital -= p.capital_factor * mes(p, best)
            localized_this.append(best.name)

        # population lever (D-030): import colonists from leftover surplus
        spare = capital - p.colonist_reserve * p.M
        if spare > p.colonist_cost:
            new = (spare * p.colonist_frac) / p.colonist_cost
            s.pop += new
        # births only if medical infra localized
        if s.localized["medical_infra"]:
            s.pop *= (1.0 + p.birth_rate)
    else:
        unmet = -free
        rate = min(0.9, p.mort_factor * unmet / f) if f > 0 else 0.0
        mortality = s.pop * rate
        s.pop -= mortality

    # population below a localized node's MES → it goes dark (spiral, §5.6/§6.5)
    for n in GRAPH:
        if s.localized[n.name] and s.pop < mes(p, n) * p.revert_hysteresis:
            s.localized[n.name] = False
            s.age[n.name] = 0
            reverted.append(n.name)

    for n in GRAPH:
        if s.localized[n.name]:
            s.age[n.name] += 1

    nd = needs(s)
    autonomy = autonomy_by_mass(s, nd)
    runway = survival_runway(s, nd)
    if (s.plateaued_at < 0 and s.window > 3
            and autonomy <= s.last_autonomy + 1e-9 and not localized_this):
        s.plateaued_at = s.window
    s.last_autonomy = autonomy
    if s.pop < p.pop0 * 0.2:
        s.collapsed = True

    eff_per_kg = (f_imp + launch_maint(s)) / ship_mass if ship_mass > 0 else 0.0
    return {
        "window": s.window, "year": round(s.window * 2.17, 1), "pop": round(s.pop),
        "autonomy": autonomy, "runway": runway, "F": f, "Meff": m_eff, "free": free,
        "localized_this": localized_this, "reverted": reverted,
        "mortality": round(mortality), "events": events, "fusion": s.fusion,
        "collapsed": s.collapsed, "launch_K": round(s.launch_K),
        "launch_capex": round(launch_capex_now), "eff_per_kg": round(eff_per_kg),
    }
