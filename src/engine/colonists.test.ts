// D-083: per-colonist demographics — age, illness, medbay beds, natural death, births as people.
// Deterministic by construction: extreme probabilities (0/1) where the mechanic is under test,
// the dedicated colonist RNG stream (seed, window) everywhere else.

import { describe, it, expect } from 'vitest';
import {
  newColony,
  defaultColonyParams,
  defaultCatalog,
  commitWindow,
  emptyOrder,
  bufferRunway,
  BUFFER_LOOKAHEAD,
  type ColonyParams,
} from './colony';
import {
  colonistRng,
  YEARS_PER_WINDOW,
  phi,
  expectedOldAgeDeaths,
  shieldAttenuation,
  effectiveDeathAge,
} from './colonists';
import { serializeColony, loadColony } from './colony-save';

/** Demographics in isolation: no storyteller noise, no births unless the test asks, and no
 * life-support energy draw (these fixtures build no power plants, and unpowered life support
 * kills on its own — D-059 — which would tangle every count below). */
function demoParams(over: Partial<ColonyParams> = {}): ColonyParams {
  return defaultColonyParams({
    startStockWindows: 8,
    eventChanceCap: 0,
    birthRate: 0,
    popEnergyPerCapita: 0,
    ...over,
  });
}

describe('colonists as individuals (D-083)', () => {
  it('pop0 spawns real people: healthy adults 25–35, natural-death age ahead of them', () => {
    const s = newColony(demoParams({ pop0: 200 }));
    expect(s.pop).toBe(200);
    expect(s.colonists).toHaveLength(200);
    for (const c of s.colonists) {
      expect(c.age).toBeGreaterThanOrEqual(25);
      expect(c.age).toBeLessThanOrEqual(35);
      expect(c.deathAge).toBeGreaterThan(c.age);
      expect(c.sick).toBe(false);
      expect(c.doomed).toBe(false);
    }
    // normal around 30 — loose bounds, this is a distribution sanity check, not a KS test
    const mean = s.colonists.reduce((a, c) => a + c.age, 0) / s.colonists.length;
    expect(mean).toBeGreaterThan(29);
    expect(mean).toBeLessThan(31);
  });

  it('everyone ages 26 months per window', () => {
    const s = newColony(demoParams({ pop0: 5, illnessProb: 0 }));
    const before = s.colonists.map((c) => c.age);
    commitWindow(s, emptyOrder());
    s.colonists.forEach((c, i) => expect(c.age).toBeCloseTo(before[i]! + YEARS_PER_WINDOW, 10));
  });

  it('crossing the pre-rolled natural-death age kills, named `old_age`', () => {
    const s = newColony(demoParams({ pop0: 5, illnessProb: 0 }));
    for (const c of s.colonists) {
      c.age = 58;
      c.deathAge = 60; // 58 + 2.17 crosses it next window
    }
    const r = commitWindow(s, emptyOrder());
    expect(r.mortalityBreakdown.old_age).toBe(5);
    expect(r.mortality).toBe(5);
    expect(s.pop).toBe(0);
    expect(s.collapsed).toBe(true);
  });
});

describe('illness → beds → cure/doom (D-083)', () => {
  it('sick with no medbay at all: everyone dies at the start of NEXT window, named `illness`', () => {
    const s = newColony(demoParams({ pop0: 20, illnessProb: 1 }));
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.sick).toBe(20); // fell ill this window — still alive, already out of the labor pool
    expect(r1.workforce).toBe(0);
    expect(r1.mortality).toBe(0); // the sentence is next window
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.mortalityBreakdown.illness).toBe(20);
    expect(s.pop).toBe(0);
    expect(s.collapsed).toBe(true);
  });

  it('bed + pharma + successful cure roll: everyone recovers, nobody dies', () => {
    const s = newColony(demoParams({ pop0: 20, illnessProb: 1, cureProb: 1 }));
    s.built = { medbay: 4 }; // 20 beds
    s.condition = { medbay: 1 };
    s.stocks.pharma = 100_000;
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.sick).toBe(20);
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.mortalityBreakdown.illness).toBeUndefined();
    expect(s.pop).toBe(20);
  });

  it('treated but the cure fails (cureProb 0): treatment spends pharma, the patient still dies', () => {
    const s = newColony(demoParams({ pop0: 20, illnessProb: 1, cureProb: 0 }));
    s.built = { medbay: 4 };
    s.condition = { medbay: 1 };
    s.stocks.pharma = 100_000;
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.sick).toBe(20);
    expect(s.stocks.pharma).toBeLessThan(100_000); // doses drawn for all 20 treatments
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.mortalityBreakdown.illness).toBe(20);
    expect(s.collapsed).toBe(true);
  });

  it('beds are a hard capacity: 7 sick vs 5 beds → exactly the 2 untreated die (X=5 per medbay)', () => {
    const s = newColony(demoParams({ pop0: 7, illnessProb: 1, cureProb: 1 }));
    s.built = { medbay: 1 }; // 5 beds
    s.condition = { medbay: 1 };
    s.stocks.pharma = 100_000;
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.sick).toBe(7);
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.mortalityBreakdown.illness).toBe(2);
    expect(s.pop).toBe(5);
  });

  it('a bed without pharma does not treat (D-083 point 4): everyone sick is doomed', () => {
    const s = newColony(demoParams({ pop0: 3, illnessProb: 1, cureProb: 1 }));
    s.built = { medbay: 1 };
    s.condition = { medbay: 1 };
    s.stocks.pharma = 0;
    commitWindow(s, emptyOrder());
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.mortalityBreakdown.illness).toBe(3);
    expect(s.collapsed).toBe(true);
  });
});

describe('demography and the rest of the engine (D-083)', () => {
  it('births are individuals at age 0 — counted as kids, not workforce', () => {
    const s = newColony(demoParams({ pop0: 40, illnessProb: 0, birthRate: 0.5 }));
    s.built = { medbay: 1 };
    s.condition = { medbay: 1 };
    s.stocks.pharma = 100_000;
    const r = commitWindow(s, emptyOrder());
    expect(r.births).toBe(20); // probRound(40 × 0.5) — exact
    expect(r.kids).toBe(20);
    expect(r.workforce).toBe(40); // the adults; newborns eat, don't staff
    expect(s.pop).toBe(60);
  });

  it('the buffer gauge ignores background demography — only SUPPLY deaths stop it (D-062/D-083)', () => {
    // no medbay: baseline illness kills someone most windows, but stocks cover the whole lookahead.
    // D-085: food spoilage neutralized — this test isolates DEMOGRAPHIC background noise from the
    // gauge, not the (separate, legitimate) supply-side attrition spoilage adds; that gets its own
    // dedicated tests. Without production, no finite food stock survives BUFFER_LOOKAHEAD windows
    // of 35%/window decay regardless of demography, which would defeat the point of this test.
    // minSpoilRate:0 too — colony.ts floors food's effective rate at 5%/window regardless of the
    // catalog value (meant to stop food_silo from ever reaching zero), so zeroing spoilRate alone
    // isn't quite a true zero; harmless at this test's generous 14-vs-12-window margin, but let's
    // actually mean "neutralized" rather than "close enough by accident."
    const cat = defaultCatalog();
    const noSpoil = { ...cat, food: { ...cat.food, spoilRate: 0 } };
    const s = newColony(demoParams({ pop0: 100, startStockWindows: 14, minSpoilRate: 0, catalog: noSpoil }));
    expect(bufferRunway(s)).toBe(BUFFER_LOOKAHEAD);
  });

  it('save/load (v6) round-trips the colonist array exactly', () => {
    const s = newColony(demoParams({ pop0: 50 }));
    commitWindow(s, emptyOrder());
    commitWindow(s, emptyOrder());
    const loaded = loadColony(JSON.stringify(serializeColony(s)), s.p);
    expect(loaded).not.toBeNull();
    expect(loaded!.colonists).toEqual(s.colonists);
    expect(loaded!.pop).toBe(s.pop);
  });

  it('same seed → same demographic history; the colonist stream differs per window', () => {
    const run = () => {
      const s = newColony(demoParams({ pop0: 100, seed: 7 }));
      const reports = [1, 2, 3].map(() => commitWindow(s, emptyOrder()));
      return { s, reports };
    };
    const a = run();
    const b = run();
    expect(a.s.colonists).toEqual(b.s.colonists);
    expect(a.reports.map((r) => r.mortality)).toEqual(b.reports.map((r) => r.mortality));
    // and the per-window streams are genuinely different draws
    expect(colonistRng(7, 1).random()).not.toBeCloseTo(colonistRng(7, 2).random(), 10);
  });
});

// Roadmap-2: the demography UI's statistical old-age forecast. `expectedOldAgeDeaths` must never
// read a colonist's own pre-rolled `deathAge` — that's one person's specific fate, and showing it
// would telegraph the future (D-063). It reads only `age` + the distribution parameters.
describe('expectedOldAgeDeaths / phi (roadmap-2 demography forecast)', () => {
  it('phi (standard normal CDF) matches known control points', () => {
    expect(phi(0)).toBeCloseTo(0.5, 3);
    expect(phi(1.96)).toBeCloseTo(0.975, 2);
    expect(phi(-1.96)).toBeCloseTo(0.025, 2);
  });

  it('a young colony (25–35, default lifeExpectancy 60±5) has a negligible 3-window forecast', () => {
    const s = newColony(demoParams({ pop0: 100 }));
    expect(expectedOldAgeDeaths(s.colonists, s.p, 3)).toBeLessThan(0.05);
  });

  it('a colony aged to 58 (near the mean) has a 3-window forecast covering most of the population', () => {
    const s = newColony(demoParams({ pop0: 100 }));
    for (const c of s.colonists) c.age = 58;
    expect(expectedOldAgeDeaths(s.colonists, s.p, 3)).toBeGreaterThan(50); // > half of 100
  });

  it('is monotonic — an older population (same size) forecasts strictly more deaths', () => {
    const s = newColony(demoParams({ pop0: 50 }));
    for (const c of s.colonists) c.age = 40;
    const younger = expectedOldAgeDeaths(s.colonists, s.p, 3);
    for (const c of s.colonists) c.age = 55;
    const older = expectedOldAgeDeaths(s.colonists, s.p, 3);
    expect(older).toBeGreaterThan(younger);
  });

  it('never reads deathAge — swapping it for wildly different values leaves the forecast unchanged', () => {
    const s = newColony(demoParams({ pop0: 30 }));
    for (const c of s.colonists) c.age = 55;
    const a = expectedOldAgeDeaths(s.colonists, s.p, 3);
    // real deathAges cluster ~60±5σ; 500+ is nowhere near that range — a hard proof the function
    // never touches this field, not just a coincidental match
    const rearranged = s.colonists.map((c, i) => ({ ...c, deathAge: 500 + i }));
    const b = expectedOldAgeDeaths(rearranged, s.p, 3);
    expect(b).toBe(a);
  });

  it('D-094: DOES factor in radiationDose (a fact about the past, not the forbidden deathAge) — higher dose forecasts strictly more near-term deaths, same age', () => {
    const s = newColony(demoParams({ pop0: 30 }));
    for (const c of s.colonists) c.age = 50;
    const undosed = expectedOldAgeDeaths(s.colonists, s.p, 3);
    const dosed = s.colonists.map((c) => ({ ...c, radiationDose: 5 })); // 5 Sv × radiationLifespanPerSv
    const withDose = expectedOldAgeDeaths(dosed, s.p, 3);
    expect(withDose).toBeGreaterThan(undosed);
  });
});

describe('D-094: chronic dose (GCR) — shieldAttenuation / effectiveDeathAge', () => {
  it('shieldAttenuation: zero coverage passes the full (unattenuated) rate', () => {
    expect(shieldAttenuation(0, 0.15)).toBeCloseTo(1, 10);
  });

  it('shieldAttenuation: full coverage floors at `floor`, never reaches zero', () => {
    expect(shieldAttenuation(1, 0.15)).toBeCloseTo(0.15, 10);
  });

  it('shieldAttenuation: clamps coverage to [0,1] — over/under-coverage does not overshoot the curve', () => {
    expect(shieldAttenuation(2, 0.15)).toBeCloseTo(shieldAttenuation(1, 0.15), 10);
    expect(shieldAttenuation(-1, 0.15)).toBeCloseTo(shieldAttenuation(0, 0.15), 10);
  });

  it('shieldAttenuation: monotonically decreasing in coverage', () => {
    expect(shieldAttenuation(0.8, 0.15)).toBeLessThan(shieldAttenuation(0.2, 0.15));
  });

  it('effectiveDeathAge: zero accumulated dose leaves deathAge untouched', () => {
    const s = newColony(demoParams({ pop0: 1 }));
    const c = { ...s.colonists[0]!, radiationDose: 0 };
    expect(effectiveDeathAge(c, s.p)).toBe(c.deathAge);
  });

  it('effectiveDeathAge: shortens deathAge linearly by radiationLifespanPerSv × dose, never mutates deathAge itself', () => {
    const s = newColony(demoParams({ pop0: 1 }));
    const original = s.colonists[0]!.deathAge;
    const c = { ...s.colonists[0]!, radiationDose: 2 };
    expect(effectiveDeathAge(c, s.p)).toBeCloseTo(original - s.p.radiationLifespanPerSv * 2, 10);
    expect(c.deathAge).toBe(original); // the field itself is untouched — D-094's whole point
  });
});
