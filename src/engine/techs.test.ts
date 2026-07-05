// Roadmap-2 Block C — V8 advanced-tech tree SCAFFOLD. data/techs.csv ships with zero rows on
// purpose (content/numbers await a design session + new D-numbers); these tests only pin the
// "empty tree ⇒ neutral" contract that the rest of the engine relies on.

import { describe, it, expect } from 'vitest';
import { TECHS, TECH_BY_ID, techMods, techBuyable } from './techs';

describe('V8 tech tree scaffold (roadmap-2, no content yet)', () => {
  it('the CSV ships empty — TECHS/TECH_BY_ID have no entries', () => {
    expect(TECHS).toHaveLength(0);
    expect(Object.keys(TECH_BY_ID)).toHaveLength(0);
  });

  it('techMods([]) is the neutral bundle', () => {
    const mods = techMods([]);
    expect(mods.opsCrewMult).toBe(1);
    expect(mods.cureProbBonus).toBe(0);
    expect(mods.lifeExpectancyBonus).toBe(0);
    expect(mods.repairRateMult).toBe(1);
    expect(mods.unlockedStructures.size).toBe(0);
  });

  it('techMods ignores unknown ids (e.g. from a save made against a larger future tree) — still neutral', () => {
    const mods = techMods(['robo_ops', 'fusion', 'anything']);
    expect(mods.opsCrewMult).toBe(1);
    expect(mods.repairRateMult).toBe(1);
  });

  it('techBuyable is false for any id — there is nothing to buy yet', () => {
    expect(techBuyable('robo_ops', [], {}, 1000, true)).toBe(false);
  });
});
