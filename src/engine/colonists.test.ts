// D-083: per-colonist demographics — age, illness, medbay beds, natural death, births as people.
// Deterministic by construction: extreme probabilities (0/1) where the mechanic is under test,
// the dedicated colonist RNG stream (seed, window) everywhere else.

import { describe, it, expect } from 'vitest';
import {
  newColony,
  defaultColonyParams,
  commitWindow,
  emptyOrder,
  bufferRunway,
  BUFFER_LOOKAHEAD,
  type ColonyParams,
} from './colony';
import { colonistRng, YEARS_PER_WINDOW } from './colonists';
import { serializeColony, loadColony } from './colony-save';

/** No storyteller noise, no births unless the test asks — demographics in isolation. */
function demoParams(over: Partial<ColonyParams> = {}): ColonyParams {
  return defaultColonyParams({ startStockWindows: 8, eventChanceCap: 0, birthRate: 0, ...over });
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
    // no medbay: baseline illness kills someone most windows, but stocks cover the whole lookahead
    const s = newColony(demoParams({ pop0: 100, startStockWindows: 14 }));
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
