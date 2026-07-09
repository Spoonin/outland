// Roadmap-2 Block C — V8 advanced-tech tree. First real content landed in D-089 (P1): three
// `effect: 'none'` techs (isru_extraction/electrolysis/regolith_metallurgy) whose only job is
// gating structures.csv rows via `techGate` (D-088) — techMods() itself stays neutral for them.

import { describe, it, expect } from 'vitest';
import { TECHS, TECH_BY_ID, techMods, techBuyable } from './techs';

describe('V8 tech tree — P1 content (D-089)', () => {
  it('the three P1 techs are loaded, all effect "none" (pure techGate, nothing for techMods to fold in)', () => {
    expect(TECHS).toHaveLength(3);
    expect(Object.keys(TECH_BY_ID).sort()).toEqual(['electrolysis', 'isru_extraction', 'regolith_metallurgy']);
    expect(TECHS.every((t) => t.effect === 'none')).toBe(true);
  });

  it('techMods(owned) is still the neutral bundle even WITH the real P1 techs owned — effect "none" is a true no-op', () => {
    const mods = techMods(['isru_extraction', 'electrolysis', 'regolith_metallurgy']);
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

  it('electrolysis/regolith_metallurgy both require isru_extraction owned first', () => {
    expect(techBuyable('electrolysis', [], {}, 20, true)).toBe(false); // prereqTech missing
    expect(techBuyable('electrolysis', ['isru_extraction'], {}, 20, true)).toBe(true);
    expect(techBuyable('regolith_metallurgy', [], {}, 20, true)).toBe(false);
    expect(techBuyable('regolith_metallurgy', ['isru_extraction'], {}, 20, true)).toBe(true);
  });
});
