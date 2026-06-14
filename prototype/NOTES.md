# Prototype notes — Outland economy sandbox

**Status:** throwaway prototype. Delete or lift `economy.py` into real code once
the question is settled.

## Question

Does Outland's economic model converge to failure *gradually* — autonomy
plateaus below 100%, three acts (seduction → doubt → realization) — rather than
instantly or as a sudden cliff?

## Run

```
python3 prototype/sim.py
```

Keys: `[t]` step one synodic window · `[r]` run to end · `[n]` reset ·
`[q]` quit · `[1/2]` c−/+ · `[3/4]` k−/+ · `[5/6]` inflation−/+ · `[7/8]` subsidy M−/+ ·
`[e]` toggle events · `[f]` toggle fusion megaproject
(changing a knob resets the run).

## Preliminary answer (default params, headless run)

The curve bends the right way:

- **Act 1 (seduction):** autonomy jumps 45% → 70% → 84% as cheap bulk tiers
  (T1–T3) get localized — they're mass-heavy, so shipping (mass×c) dominates
  their import cost and localizing them is the rational, satisfying move.
- **Act 2 (doubt):** autonomy sits on a long plateau at **84%** while `F/M`
  creeps 0.60 → 0.93 over ~20 windows (population growth + wear maintenance
  tails). The "good" number is frozen while the quiet bad number climbs.
- **Asymptote:** autonomy plateaus at **84% < 100%** — the black tiers (T7–T8)
  are never localizable regardless of population. Thesis holds mechanically.
- **Fragility:** by window 40 `F/M ≈ 0.93` — one bad event (§12) tips F past M
  into the mortality spiral. This is the "asymptotic stall" ending (D-017).

So the central balance hypothesis is **validated qualitatively**: failure is
gradual and self-inflicted, autonomy never reaches 100%.

## Events + megaproject (added in second pass)

- **Events (§12):** breakdowns (revert a tier; odds rise with F/M margin) and
  launch failures (waste part of the window's budget). They turn the slow stall
  into a real **collapse**: a late breakdown of a bulk tier spikes F past M →
  mortality → more tiers go dark → spiral. With events OFF the colony just stalls
  at F/M≈0.93; with events ON (seed 3) it collapses ~w36 once a big tier breaks
  while the margin is already thin.
- **Megaproject — fusion (§11):** funded by *saving surplus* over many windows
  (auto-starts when autonomy first plateaus — the Act 2 "we need a breakthrough"
  moment), never by starving survival. Once online it discounts operating cost
  (F drops) but adds its own black-node-tied floor.
  - Comparison at seed 3: **fusion OFF → collapse ~w36**; **fusion ON → survives
    to w40** (F/M held ~0.78) because the discount absorbs the breakdowns that
    kill the OFF run.
  - Crucially **autonomy still plateaus at 84%** in both — fusion delays/cushions
    the wall, it never closes the gap. Exactly the §11 "delay, not solution" thesis.
  - Over a longer horizon (raise `max_windows`, or faster pop growth) fusion's own
    maintenance floor + population growth overtake the discount → collapse returns,
    just later. Worth confirming on a future pass.

Verdict: the model reproduces all three thesis behaviours — gradual plateau below
100%, event-driven collapse spiral, and a megaproject that only buys time.

## Refined model — node graph (third pass, per grill decisions)

`economy.py` was rewritten from the tier-ladder to a **graph of ~17 authored nodes**
(D-026) so the curve-relevant grill decisions are actually modelled:

- **D-029 derived demand / aggregation** — demand = consumption + derived (a localized
  node loads its inputs); shared upstream (catalyst, chips, water) aggregates demand
  from its consumers. This is the real feedback loop, absent from the tier version.
- **D-031 Earth inflation + events** — inflation erodes the subsidy's real value every
  window; Earth events cut the subsidy or spike prices (mortality shocks).
- **D-030 population lever** — colonists imported from surplus (one-time cost + permanent
  demand tail); births only if the `maternity` infra node is localized.
- **D-025 two metrics** — autonomy (by mass) AND self-sufficiency as a **survival runway**
  (windows survivable if imports cut), gated by Liebig's law on the worst-covered critical
  node.

### Headline finding (default params, seeds 3/7)

The two metrics **diverge exactly as the thesis predicts**:

- **Autonomy** ramps over Act 1 to a plateau **~78%** (< 100%; black nodes never localize).
- **Self-sufficiency runway stays pinned at ~0.5 windows the entire game**, no matter how
  high autonomy climbs — because pharma & chips are critical *and* black, so the worst-
  covered critical node is always ~0% local. "Autonomy 78%, but cut imports → dead in half
  a synod." That gap is the whole game.
- `F/M` creeps up (inflation + growth + maintenance tails + derived demand pulling in
  catalyst/chips); Earth events spike it past 1.0 → mortality; bulk breakdowns (water/food)
  crater autonomy temporarily (fragility/cascade). Fusion ON holds `F/M` lower than OFF.

### Still simplified (deliberately out of scope)

- D-035 paid survey (about *knowledge*, not the money curve) — auto-policy has perfect info.
- D-028 skill-pipeline MES gate folded into the single process-MES gate.
- The runway is a Liebig proxy, not a full import=0 sub-simulation.
- Auto-policy (greedy) stands in for the player; numbers (c, k, inflation, costs) are
  illustrative — tune via the knobs.

## Calibration pass (fourth pass — real numbers + ~28-node graph)

`references.md` §3–4 now anchors the swing numbers to reality, and `GRAPH` was expanded
from 17 to **~28 authored nodes mirroring `documents/graph.md`**. Two knobs were recalibrated:

- **`c` 2e5 → 5e3** ($/kg landed). Real anchors: Falcon Heavy ~$5.8k/kg, Starship target
  ~$400/kg (refs §3). The old 2e5 was ~40× too high.
- **`capital_factor` 1e9 → 5e7**. With realistic (lower) `c`, F is dominated by black nodes'
  *intrinsic* cost, not shipping, so far less surplus is freed each window. At 1e9 a single
  tier-1 localization (3e11) was unaffordable → nothing localized → autonomy stuck near 0.
  5e7 is the **knee**: below it affordability stops binding and the MES gate on black nodes
  takes over (curve identical for cf ≤ 5e7). That knee is the right place to sit — the wall
  is industrial, not budgetary.

### Headline finding — thesis survives realistic numbers

- **Autonomy plateaus 67–78% (<100%)** across seeds 1/3/7/11/42/99, plateau detected w5–8.
- **Survival runway pinned at 0.5 windows in *every single run*** — every c (400…200k), every
  M, fusion on/off, however high autonomy climbs. Pharma+chips are critical AND black → worst-
  covered critical node ≈ 0% local → Liebig pins the runway. This is the most robust result in
  the model and the cleanest statement of the D-025 gap.
- **F/M creeps toward/past 1.0** in fragile runs (seed 3 → 1.05; subsidy-cut M=5e11 → 1.11) →
  Act-2 mortality pressure. Fusion ON holds F/M lower (seed 7: 0.67 vs 1.01) but autonomy is
  *identical* (77–78%) — "delay/cushion, not solution" (§11) confirmed on the calibrated graph.

### The big calibration finding (→ D-037)

At honest Starship-era `c`, **shipping bulk is cheap** → Tsiolkovsky tyranny is a *weaker*
squeeze than D-012 assumed. The "fantastic expensiveness" comes almost entirely from the
**intrinsic cost + unreachable MES of the black nodes** (a $15–20B fab, a 200–500 t/yr API
plant — refs §4), not from mass-to-orbit. This *strengthens* the core thesis (the wall is
industrial, can't be engineered away by cheaper rockets) but shifts the emphasis of §4 away
from the rocket equation. Worth a design note / possible §4 revision.

## Launch capacity as capital (fifth pass — D-038)

The magic `c` ($/kg) was removed. Launch capacity is now a **capital asset**: shipping cost/window
= `fuel_per_kg·W` (marginal, $400/kg) + `launch_maint` on built capacity `K` (sunk, paid even idle,
because the fleet has ~0 Earth reuse). `K` is an explicit lever (auto-policy builds it to cover the
window's import mass). Params: `fuel_per_kg=400`, `launch_capex_per_kg=4e4`, `launch_maint_frac=0.08`.

### What emerges (and why it's the honest model)

- **Effective $/kg is derived, not set — and it's ~$1M, not $400.** Trace shows it swinging
  $61k → $1.2M across the game (150–3000× the fuel floor). The amortized $400/kg is a fantasy for
  Mars; once you pay for capacity idle 25/26 months, the real effective cost is ~$1M/kg. The convex
  cost I'd sketched as a formula now **emerges** from honest capital — nothing imposed.
- **The idle trap is visible** (seed 7, w15–21): an import surge forces K up to 2.14M kg/window;
  autonomy then recovers and import mass drops, but K is sunk + maintained → effective $/kg climbs
  back up as the same maintenance spreads over less mass. "Built for a burst, now idle but still
  paid for" — exactly the synodic-window burst problem.
- **Thesis intact:** autonomy plateaus 67–77% (<100%) across seeds 1/3/7/11/42; **runway pinned at
  0.5 every window of every seed**; F/M creeps to 0.8–1.05 (Act-2 pressure, now partly from the
  capacity maintenance tail). Fusion still only cushions F/M, never moves autonomy.

This gives D-012 (Tsiolkovsky / synodic windows) real teeth: the squeeze isn't the rocket equation
(Starship beats it) — it's the capital cost of bursty launch capacity with no reuse, in the single
money ledger (D-027 intact, no mass budget `B`). Parallel to D-032: ship any tonnage, the wall is
the idle-capacity cost, not a blockade.

## Things to tune / watch (for the next pass)

- **`c` (cost per kg):** the swing parameter. How much mass a trillion buys.
  Lower c → bulk cheaper to import → weaker incentive to localize early.
- **Collapse vs stall:** default run stalls at F/M≈0.93 without fully collapsing
  in 40 windows. Lower `M`, raise `wear`, or raise `k` to see an actual collapse;
  events (§12) are not in this model yet — they'd provide the tipping shock.
- **`plateaued_at` detection** fires a bit eagerly (in the gaps between
  localizations at w4) — cosmetic, the real plateau is 84% from w19.
- Model omits: stochastic events, megaprojects (§11), per-node graph (tiers are
  an aggregation), empirical/hidden MES (here MES is known to the auto-policy).
  Those are deliberate simplifications — add only if a specific question needs them.
