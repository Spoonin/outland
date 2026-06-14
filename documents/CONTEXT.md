# Outland — Language

Canonical glossary for the Outland design. Terms here are the agreed words for
the game's concepts; pick these and avoid the listed synonyms. Mechanics live in
`mechanics.md`, decisions in `decisions.md` — this file is the glossary only.

## Structure

**Node**:
A single, individually-authored thing in the dependency graph — a good, material,
or process the player can make or buy. The dependency graph is a graph of nodes,
not a tier ladder.
_Avoid_: object, item, component (UI may render "объект" but the concept is Node)

**Tier**:
A node's **depth attribute** (how far down the dependency graph it sits), which
drives its minimum efficient scale. Not a unit of play in itself — you localize
nodes, not tiers.
_Avoid_: level, layer (when referring to the play unit — that's a Node)

## Economy

**Subsidy**:
The sum of **money** Earth sends each synodic window (~1 trillion, nominal). The
single ledger — everything is paid in money, the only budget the player has.
Nominally fixed but **eroded in real terms by Earth inflation** (buys less each
window) and cuttable by **Earth events**; the colony cannot control either. Written `M`.
_Avoid_: budget, allowance, mass budget, B

**Earth inflation**:
The steady erosion of the subsidy's real purchasing power over the game. An
*exogenous* driver of the squeeze (§10.4) — the trillion shrinks even if the
colony stands still. Distinct from the colony's own demand growth.
_Avoid_: price drift, devaluation

**Earth event**:
A stochastic Earth-side shock (economic crisis, political shift) that cuts or
slashes the subsidy. The mechanism behind the "cancellation" ending — the lifeline
frays for reasons outside the colony's control, not as a judgment of its progress.
_Avoid_: political risk, sponsor event

**Import floor**:
The **money** cost, each window, of everything imported: un-localized demand plus
the maintenance tails of localized nodes. Mandatory first claim on the subsidy;
what's left is capital. Written `F`.
_Avoid_: mass budget, B, running cost

**Cost-per-kg**:
The money to land one kg on Mars (the Tsiolkovsky tyranny). Enters every catalog
price as `цена = земная_стоимость + масса × c`. Mass bites only through this; there
is no separate mass ledger. Written `c`.
_Avoid_: shipping cost, freight

**Demand**:
A node's total per-window need, compared against MES to decide localizability.
The sum of **consumption demand** (population × per-capita, on end-use nodes) and
**derived demand** (the load a localized node places on each of its input nodes).
Written `D`.
_Avoid_: usage, consumption (those name only one of the two sources)

**Derived demand / aggregation**:
The demand a localized node places on its inputs. An upstream node's demand is the
sum of derived demand from every localized node that consumes it — the feedback
loop that can lift an upstream node over its MES. Importing a finished good creates
**no** derived demand for its inputs.
_Avoid_: indirect demand, induced load

## Capabilities & people

**Minimum efficient scale (MES)**:
The smallest viable scale of a *capability* — whether a production process or a
skill/training pipeline. One law applied on two fronts: a node is localizable only
if demand ≥ its process-MES **and** the colony can sustain the skill pipeline for
its specialists. A black node's MES exceeds any reachable colony size.
_Avoid_: minimum scale, breakeven scale, critical mass

**Specialist**:
A trained person required to operate a node — an input like any other, itself
MES-gated by a training pipeline. Lose one with no backup and the node can go dark.
_Avoid_: worker, expert, staff, operator

**Human import floor**:
The permanent import of *experts* when the colony is too small to sustain their
training pipeline — the people-side analog of the import floor.
_Avoid_: labor shortage, brain drain

**Colonist**:
A person. Population grows two ways, both gated: (1) **importing colonists** —
bought like any cargo, a one-time landing cost plus a permanent demand tail in `F`
(food, pharma, wear, forever); (2) **local births** — possible *only* while the
colony has built and is sustaining the enabling infrastructure nodes (maternity,
schools), which are themselves MES-gated and carry their own maintenance tails and
specialists. No free automatic births, no automatic immigration. Growing the colony
is always a budget trade-off, and staying small is sometimes optimal.
_Avoid_: settler, migrant, headcount (the person is a Colonist; the count is "population")

**Colonist**:
A person. Population changes only by the player **importing colonists** (bought
like any cargo: a one-time landing cost plus a permanent demand tail in `F` —
food, pharma, wear, forever) plus modest local births. No automatic immigration.
Growing the colony is therefore a budget trade-off, and staying small is
sometimes optimal.
_Avoid_: settler, migrant, headcount (when meaning the person; "population" is the count)

## Play verbs & states

**Localize**:
To switch a node from imported to locally produced (the "make" of make-or-buy).
Requires its direct inputs available (locally or imported) and both MES gates met.
Never fully zeroes the node's import — a maintenance tail remains.
_Avoid_: produce locally, in-source, onshore

**Make-or-buy**:
The per-node decision to localize a node or keep importing it. Importing is always
available (the import-escape), so production need not be built strictly bottom-up.
_Avoid_: build-vs-import

**Maintenance tail**:
The residual, permanent import a localized node still needs — spares plus feedstock
makeup for leakage (wear, η<100%). Ramps up over windows, so the import floor creeps
back after a localization "win".
_Avoid_: upkeep cost, overhead

**Node status (green / yellow / red / black)**:
🟢 localized and efficient (D ≥ MES) · 🟡 localized but sub-scale (D < MES, expensive)
· 🔴 imported but localizable in principle · ⚫ never localizable (MES beyond the
colony). 🟢/🟡 are **discovered by operating**, not labelled in advance (MES is hidden).
_Avoid_: tiers/levels (those are depth); "available/unavailable"

**Megaproject**:
A large, expensive import that relaxes a constraint which was never the true
bottleneck (energy, launch cost) — a deliberate multi-window player commitment that
**delays** collapse but never closes the self-sufficiency gap, and adds its own
black-node-tied tail. Flagship: the fusion plant.
_Avoid_: false savior (that's the design role; the thing is a Megaproject), wonder-weapon

**Synodic window**:
One game turn (~26 months) — the Earth→Mars launch opportunity. The only time mass
moves; coarse time is what makes the dawning slow.
_Avoid_: turn, round, synod (use "window" or "synodic window")

## Metrics

**Autonomy**:
The fraction of the colony's demand, **by mass**, produced locally. The seductive
headline metric — it rises fast because bulk goods are heavy, while the colony
stays existentially import-dependent.
_Avoid_: independence, self-reliance (and do NOT conflate with self-sufficiency)

**Self-sufficiency**:
Whether the colony could survive a total cutoff of imports, measured as a
**survival runway** — how many windows it would last if imports went to zero now
(simulated via the collapse spiral), backed under the hood by criticality-weighted
local coverage. The grim truth metric; stays near zero even when autonomy is high.
**Debrief-only**: never a live gauge — inferable in-play from the import floor and
node colors, named explicitly (as a runway, e.g. "~0.8 синода") only in the debrief.
_Avoid_: autonomy (that is the by-mass headline; this is the survival truth)

**Criticality**:
How essential a node is to survival — the weight behind self-sufficiency. Food,
pharma, and chips are high-criticality and fail first when imports stop; bulk is low.
_Avoid_: priority, importance
