"""
PROTOTYPE — throwaway. Question being answered:

  Does Outland's economic model converge to failure *gradually* (autonomy
  plateaus below 100%, three acts: seduction -> doubt -> realization), rather
  than instantly or as a sudden cliff? And do events + a megaproject produce a
  real collapse and the "delay, then wall" pattern?

Pure logic module: no I/O, no terminal code. sim.py is a thin shell over it.

Model (see documents/mechanics.md):
- Tiers 1..T of goods. Low tiers = bulk (high mass, low intrinsic cost),
  high tiers = hi-tech (low mass, high intrinsic cost). Top tiers are BLACK
  (MES above any reachable colony size -> eternal import).
- Price of importing a tier's demand = intrinsic_cost + mass * c   (D-023).
- A tier is localizable when demand (~ population P) >= MES, MES grows by k/tier.
- Localizing kills most import but leaves a wear maintenance tail that ramps up.
- Budget: fixed subsidy M per window. F (import floor) paid first; leftover is
  capital for localization / growth. F > M -> mortality -> spiral.
- EVENTS (§12): launch failures waste budget; breakdowns revert a tier. Their
  odds rise with fragility (tight F/M margin).
- MEGAPROJECT (§11): fusion. Costly multi-window build; once online it discounts
  operating cost (more budget frees up) BUT adds its own black-node-tied floor.
  Net: delays the F->M crossing, never removes it.
"""

from dataclasses import dataclass, field
from typing import List
import math
import random


@dataclass
class Params:
    tiers: int = 8
    black_from: int = 7

    M: float = 1.0e12
    c: float = 5.0e5

    mass_base: float = 300.0
    mass_decay: float = 0.55
    money_base: float = 8.0e5
    money_grow: float = 1.9

    mes0: float = 500.0
    k: float = 2.2
    capital_factor: float = 6.0e7

    tail_max: float = 0.18
    tail_ramp: float = 3.0

    pop0: float = 1000.0
    growth_rate: float = 0.10
    mort_factor: float = 0.8
    revert_hysteresis: float = 0.9

    # events (§12)
    enable_events: bool = True
    seed: int = 1
    launch_fail_prob: float = 0.08
    launch_waste: float = 0.40        # fraction of M lost on a failed launch
    breakdown_base: float = 0.03
    breakdown_margin: float = 0.20    # extra breakdown prob × (F/M)

    # megaproject — fusion (§11). Funded by saving surplus over many windows
    # (Act 2 "we need a breakthrough"), never by starving survival.
    enable_fusion: bool = True
    fusion_cost_M: float = 3.0        # total cost in units of M
    fusion_save_frac: float = 0.6     # fraction of each window's surplus diverted to the fund
    fusion_discount: float = 0.30     # operating-cost reduction once online
    fusion_maint_M: float = 0.10      # eternal black-node floor, fraction of M (× pop/pop0)

    max_windows: int = 40


@dataclass
class State:
    p: Params
    window: int = 0
    pop: float = 0.0
    localized: List[bool] = field(default_factory=list)
    age: List[int] = field(default_factory=list)
    collapsed: bool = False
    plateaued_at: int = -1
    last_autonomy: float = 0.0
    rng: random.Random = field(default_factory=random.Random)

    fusion: str = "none"              # none / saving / online
    fusion_fund: float = 0.0

    @staticmethod
    def new(p: Params) -> "State":
        return State(
            p=p,
            pop=p.pop0,
            localized=[False] * p.tiers,
            age=[0] * p.tiers,
            rng=random.Random(p.seed),
        )


# ---- pure helpers ---------------------------------------------------------

def mes(p: Params, t: int) -> float:
    if t + 1 >= p.black_from:
        return math.inf
    return p.mes0 * (p.k ** t)


def unit_mass(p: Params, t: int) -> float:
    return p.mass_base * (p.mass_decay ** t)


def unit_money(p: Params, t: int) -> float:
    return p.money_base * (p.money_grow ** t)


def import_cost(p: Params, t: int, pop: float) -> float:
    return pop * (unit_money(p, t) + unit_mass(p, t) * p.c)


def tail_frac(p: Params, age: int) -> float:
    return p.tail_max * (1.0 - math.exp(-age / p.tail_ramp))


def total_mass_weight(p: Params) -> float:
    return sum(unit_mass(p, t) for t in range(p.tiers))


def autonomy_by_mass(s: State) -> float:
    p = s.p
    tot = total_mass_weight(p)
    loc = sum(unit_mass(p, t) for t in range(p.tiers) if s.localized[t])
    return loc / tot if tot else 0.0


def raw_import_floor(s: State) -> float:
    """F before fusion effects: full cost for non-localized, tail for localized."""
    p = s.p
    f = 0.0
    for t in range(p.tiers):
        cost = import_cost(p, t, s.pop)
        f += cost * tail_frac(p, s.age[t]) if s.localized[t] else cost
    return f


def import_floor(s: State) -> float:
    """F with fusion online: operating discount, plus fusion's own eternal floor."""
    p = s.p
    f = raw_import_floor(s)
    if s.fusion == "online":
        f = f * (1.0 - p.fusion_discount) + p.fusion_maint_M * p.M * (s.pop / p.pop0)
    return f


# ---- the step -------------------------------------------------------------

def step(s: State) -> dict:
    p = s.p
    rng = s.rng
    s.window += 1
    events = []

    # --- breakdowns (§12.4): odds rise with fragility (tight F/M) ---
    f_pre = import_floor(s)
    if p.enable_events and f_pre > 0:
        bd_prob = p.breakdown_base + p.breakdown_margin * min(2.0, f_pre / p.M)
        loc_tiers = [t for t in range(p.tiers) if s.localized[t]]
        if loc_tiers and rng.random() < bd_prob:
            t = rng.choice(loc_tiers)
            s.localized[t] = False
            s.age[t] = 0
            events.append(f"поломка T{t+1}")

    f = import_floor(s)

    # --- launch failure (§12.2): wastes part of this window's budget ---
    m_eff = p.M
    if p.enable_events and rng.random() < p.launch_fail_prob:
        m_eff = p.M * (1.0 - p.launch_waste)
        events.append("авария пуска")

    free = m_eff - f

    # --- megaproject: fusion (§11). Start saving once autonomy stalls (Act 2),
    #     fund it only from surplus so it never starves the colony. ---
    if (p.enable_fusion and s.fusion == "none" and not s.collapsed
            and s.plateaued_at > 0):
        s.fusion = "saving"
        events.append("⚡решение строить термояд")
    if s.fusion == "saving" and free > 0:
        contrib = free * p.fusion_save_frac
        free -= contrib
        s.fusion_fund += contrib
        if s.fusion_fund >= p.fusion_cost_M * p.M:
            s.fusion = "online"
            events.append("⚡термояд онлайн")

    localized_this = []
    mortality = 0.0
    reverted = []

    if free >= 0:
        capital = free
        while True:
            best, best_ratio = -1, 0.0
            for t in range(p.tiers):
                if s.localized[t] or mes(p, t) == math.inf or s.pop < mes(p, t):
                    continue
                cap_cost = p.capital_factor * mes(p, t)
                if cap_cost > capital:
                    continue
                saved = import_cost(p, t, s.pop) * (1.0 - p.tail_max)
                ratio = saved / cap_cost
                if ratio > best_ratio:
                    best, best_ratio = t, ratio
            if best < 0:
                break
            s.localized[best] = True
            s.age[best] = 0
            capital -= p.capital_factor * mes(p, best)
            localized_this.append(best + 1)
        surplus_frac = capital / p.M
        s.pop += p.growth_rate * s.pop * max(0.0, min(1.0, surplus_frac))
    else:
        unmet = -free
        denom = f if f > 0 else p.M
        rate = min(0.9, p.mort_factor * unmet / denom)
        mortality = s.pop * rate
        s.pop -= mortality

    # population fell below a localized tier's MES -> goes dark (spiral)
    for t in range(p.tiers):
        if s.localized[t] and s.pop < mes(p, t) * p.revert_hysteresis:
            s.localized[t] = False
            s.age[t] = 0
            reverted.append(t + 1)

    for t in range(p.tiers):
        if s.localized[t]:
            s.age[t] += 1

    autonomy = autonomy_by_mass(s)
    if (s.plateaued_at < 0 and s.window > 3
            and autonomy <= s.last_autonomy + 1e-9 and not localized_this):
        s.plateaued_at = s.window
    s.last_autonomy = autonomy

    if s.pop < p.pop0 * 0.2:
        s.collapsed = True

    return {
        "window": s.window,
        "year": round(s.window * 2.17, 1),
        "pop": round(s.pop),
        "autonomy": autonomy,
        "F": f,
        "free": free,
        "localized_this": localized_this,
        "reverted": reverted,
        "mortality": round(mortality),
        "events": events,
        "fusion": s.fusion,
        "collapsed": s.collapsed,
    }
