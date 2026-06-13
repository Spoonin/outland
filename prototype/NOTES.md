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
`[q]` quit · `[1/2]` c−/+ · `[3/4]` k−/+ · `[5/6]` wear−/+ · `[7/8]` subsidy M−/+ ·
`[9/0]` pop0−/+ · `[e]` toggle events · `[f]` toggle fusion megaproject
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
