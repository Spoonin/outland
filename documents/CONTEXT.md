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
slashes the subsidy, or temporarily spikes prices / restricts supply (a transient
"embargo"). The mechanism behind the "cancellation" ending and behind import price
shocks — the lifeline frays for reasons outside the colony's control, never as a
permanent un-buyable status (see import-escape).
_Avoid_: political risk, sponsor event, embargo (that's a transient form of this)

**Import floor**:
The **money** cost, each window, of everything imported: un-localized demand plus
the maintenance tails of localized nodes. Mandatory first claim on the subsidy;
what's left is capital. Written `F`.
_Avoid_: mass budget, B, running cost

**Launch capacity** (delivery capital):
Shipping is NOT a fixed price `c` (D-038 abolished the magic constant). Landing mass
is bought via a **capital asset** in the single money ledger: capex to build launch
capacity `K` (kg/window) + per-window maintenance paid even when idle (Earth reuse ≈ 0).
Effective $/kg is *derived* (`fuel·W + maint·K` ÷ shipped mass), emergently ~$1M, not
the $400 fuel floor. Player-driven tech ladder: expendable (Tsiolkovsky dead end) →
reusable+ISRU (Starship — cheapens, doesn't solve). Written `K`. See D-038/D-039, §4.2/§4.5.
_Avoid_: cost-per-kg, `c`, shipping cost, freight, mass budget, B

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
its specialists. A black node's MES is a finite, reality-grounded number (references §4) so large
that it dwarfs any reachable colony size — unbuildable in practice, never forbidden (D-045).
_Avoid_: minimum scale, breakeven scale, critical mass

**Specialist**:
A trained person required to operate a node — an input like any other, itself
MES-gated by a training pipeline. Modeled as **statistical skill pools** ("12
chemical engineers, 3 needed per catalyst node"), not named individuals; names are
optional flavor only. Lose enough with no backup and the node goes dark.
_Avoid_: worker, expert, staff, operator

**Bus factor**:
A critical node's redundancy — how many spare specialists cover it before it goes
dark. **Visible** to the player (headcount/coverage is shown, unlike hidden MES);
only the *risk/consequence* of running thin is left to be felt.
_Avoid_: redundancy, coverage (when meaning this specific indicator)

**Human import floor**:
The permanent import of *experts* when the colony is too small to sustain their
training pipeline — the people-side analog of the import floor.
_Avoid_: labor shortage, brain drain

**Colonist**:
A person. The colony starts with **zero** — the player imports the first colonists
themselves, same as any cargo (a one-time landing cost plus a permanent demand tail
in `F`: food, pharma, wear, forever), with no preset and no guardrail against
ordering people before life support (D-055). Population also grows via **local
births**, gated on built+supplied enabling infrastructure (medbay+pharma, housing)
*and* on the colony being fully fed this window — no births the same window
people are dying of a shortage (D-055). No automatic immigration. Growing the
colony is always a budget trade-off, and staying small is sometimes optimal.
_Avoid_: settler, migrant, headcount (the person is a Colonist; the count is "population")

## Presentation

**Diegetic framing**:
The game's only narrative layer: in-world **statistics**, **Earth news** (which surface
inflation and Earth events), and **colony reports**. No authored characters or story
arcs. The game **never interprets or editorializes** — it states facts (including the
debrief's survival runway) and leaves the conclusion entirely to the player.
_Avoid_: narrative, story mode, epilogue (when implying authored interpretation)

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

**Import-escape**:
The invariant that **every** node can always be bought — there are no permanently
un-buyable nodes. The only thing that can be impossible is local *production* (a
black node); access via money is universal. The thesis is economic impossibility
(ruinous eternal expense), not denial/blockade. "Embargo" is only a transient
Earth-event price/supply shock, never a permanent node status.
_Avoid_: blockade, denial, un-buyable

**Fog**:
The player's incomplete knowledge of the (deterministic) graph — nodes, recipes,
and the true ceiling are hidden until revealed. The non-determinism is in the
*knowledge*, not the truth.
_Avoid_: fog of war, unknown

**Survey**:
Paid reconnaissance — spend **money** plus a window's lag to reveal a node's recipe
and tighten its optimistic estimate, one node at a time (deeper = cumulatively
expensive). Distinct from the **free passive reveal** (committing to localize a node
uncovers its next tier). Skimping on surveys under the budget squeeze is what baits
the late surprise.
_Avoid_: scout, recon, R&D (when meaning this action)

**Maintenance tail**:
The residual, permanent import a localized node still needs — spares plus feedstock
makeup for leakage (wear, η<100%). Ramps up over windows, so the import floor creeps
back after a localization "win".
_Avoid_: upkeep cost, overhead

**Node status (green / yellow / red / black)**:
🟢 localized and efficient (D ≥ MES) · 🟡 localized but sub-scale (D < MES, expensive)
· 🔴 imported but localizable in principle · ⚫ no current build path (D ≪ MES — MES is
finite and reality-grounded, D-045; nothing is forbidden, but demand is far below break-even at
any sane colony size). 🟢/🟡 are **discovered by operating**, not labelled in advance (MES is hidden).
_Avoid_: tiers/levels (those are depth); "available/unavailable"; "never localizable" (the MES is finite)

**Megaproject**:
A large, expensive import that relaxes a constraint which was never the true
bottleneck (energy, launch cost) — a deliberate player commitment, funded by
**saving surplus over many windows**, that **delays** collapse but never closes the
self-sufficiency gap, and adds its own black-node-tied tail. Its effect is sold via
an **optimistic projection** (same bias as hidden-MES node estimates) — the player
*believes* it's the breakthrough; the true ceiling shows only after it's built and
run. Flagship: the fusion plant.
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
