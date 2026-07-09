// Roadmap-2 Block C — V8 advanced-tech tree. Content: D-089 (P1, three techs) + D-090 (P2 core,
// one more) + D-091 (P3 core, one more) — all `effect: 'none'`, gating structures.csv rows purely
// via `techGate` (D-088); techMods() itself stays neutral for every one of them. D-092 (P4) adds
// the tree's first REAL techMods() hook: `robotics` (`effect: 'opsCrewMult'`).

import { describe, it, expect } from 'vitest';
import { TECHS, TECH_BY_ID, techMods, techBuyable } from './techs';

describe('V8 tech tree — P1/P2/P3 content (D-089/D-090/D-091)', () => {
  it('the six techs are loaded — five pure `techGate` ("none"), plus robotics (opsCrewMult, D-092)', () => {
    expect(TECHS).toHaveLength(6);
    expect(Object.keys(TECH_BY_ID).sort()).toEqual([
      'electrolysis',
      'fabrication',
      'isru_extraction',
      'regolith_construction',
      'regolith_metallurgy',
      'robotics',
    ]);
    const gateOnly = TECHS.filter((t) => t.id !== 'robotics');
    expect(gateOnly.every((t) => t.effect === 'none')).toBe(true);
    expect(TECH_BY_ID.robotics.effect).toBe('opsCrewMult');
  });

  it('techMods(owned) is still the neutral bundle even WITH the real "none" techs owned — effect "none" is a true no-op', () => {
    const mods = techMods(['isru_extraction', 'electrolysis', 'regolith_metallurgy', 'regolith_construction', 'fabrication']);
    expect(mods.opsCrewMult).toBe(1);
    expect(mods.cureProbBonus).toBe(0);
    expect(mods.lifeExpectancyBonus).toBe(0);
    expect(mods.repairRateMult).toBe(1);
    expect(mods.unlockedStructures.size).toBe(0); // D-088: gating lives in structures.csv's techGate, not here
  });

  it('techMods([]) is the neutral bundle', () => {
    const mods = techMods([]);
    expect(mods.opsCrewMult).toBe(1);
    expect(mods.repairRateMult).toBe(1);
  });

  it('techMods ignores unknown ids (e.g. from a save made against a larger future tree) — still neutral', () => {
    const mods = techMods(['robo_ops', 'fusion', 'anything']);
    expect(mods.opsCrewMult).toBe(1);
    expect(mods.repairRateMult).toBe(1);
  });

  it('techBuyable is false for an id that does not exist in the catalog', () => {
    expect(techBuyable('robo_ops', [], {}, 1000, true)).toBe(false);
  });

  it('isru_extraction: gated by minPop 20 and Mars presence (D-077), no prereqTech', () => {
    expect(techBuyable('isru_extraction', [], {}, 19, true)).toBe(false); // just under minPop
    expect(techBuyable('isru_extraction', [], {}, 20, false)).toBe(false); // nobody ever landed
    expect(techBuyable('isru_extraction', [], {}, 20, true)).toBe(true);
    expect(techBuyable('isru_extraction', ['isru_extraction'], {}, 20, true)).toBe(false); // already owned
  });

  it('electrolysis/regolith_metallurgy/regolith_construction all require isru_extraction owned first', () => {
    expect(techBuyable('electrolysis', [], {}, 20, true)).toBe(false); // prereqTech missing
    expect(techBuyable('electrolysis', ['isru_extraction'], {}, 20, true)).toBe(true);
    expect(techBuyable('regolith_metallurgy', [], {}, 20, true)).toBe(false);
    expect(techBuyable('regolith_metallurgy', ['isru_extraction'], {}, 20, true)).toBe(true);
    expect(techBuyable('regolith_construction', [], {}, 20, true)).toBe(false);
    expect(techBuyable('regolith_construction', ['isru_extraction'], {}, 20, true)).toBe(true);
  });

  it('fabrication requires regolith_metallurgy owned first (needs a local metals supply, not just isru_extraction) and minPop 25', () => {
    expect(techBuyable('fabrication', ['isru_extraction'], {}, 25, true)).toBe(false); // isru_extraction alone isn't enough
    expect(techBuyable('fabrication', ['isru_extraction', 'regolith_metallurgy'], {}, 24, true)).toBe(false); // just under minPop
    expect(techBuyable('fabrication', ['isru_extraction', 'regolith_metallurgy'], {}, 25, true)).toBe(true);
  });

  it('robotics (D-092): gated by minPop 80 and prereqStructure rnd_lab (NOT prereqTech — automation is orthogonal to the ISRU chain)', () => {
    expect(techBuyable('robotics', [], { rnd_lab: 1 }, 79, true)).toBe(false); // just under minPop
    expect(techBuyable('robotics', [], {}, 80, true)).toBe(false); // no rnd_lab built
    expect(techBuyable('robotics', [], { rnd_lab: 1 }, 80, true)).toBe(true);
  });

  it('robotics: owning it cuts opsCrewMult by 30% (techMods) — the tree\'s first real (non-"none") tech effect', () => {
    expect(techMods(['robotics']).opsCrewMult).toBeCloseTo(0.7, 5);
    expect(techMods([]).opsCrewMult).toBe(1); // unowned ⇒ untouched
  });
});
