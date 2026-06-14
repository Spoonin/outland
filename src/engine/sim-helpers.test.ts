import { describe, it, expect } from 'vitest';
import { mes, tailFrac } from './sim';
import { defaultParams, type Node } from './types';

const mk = (over: Partial<Node>): Node => ({
  name: 'x', tier: 1, mass: 1, earthCost: 1, cons: 0, inputs: [], black: false, crit: 0, ...over,
});

describe('mes (SDD §6, golden spot values)', () => {
  const p = defaultParams();
  it('tier 1 = mes0', () => expect(mes(p, mk({ tier: 1 }))).toBe(300));
  it('tier 5 = mes0·k^4', () => expect(mes(p, mk({ tier: 5 }))).toBe(4800));
  it('black = Infinity', () => expect(mes(p, mk({ tier: 7, black: true }))).toBe(Infinity));
});

describe('tailFrac (SDD §6)', () => {
  const p = defaultParams();
  it('age 0 = 0', () => expect(tailFrac(p, 0)).toBe(0));
  it('age 3 matches prototype', () => expect(tailFrac(p, 3)).toBeCloseTo(0.113782, 6));
  it('→ tailMax as age grows', () => expect(tailFrac(p, 1000)).toBeCloseTo(p.tailMax, 6));
});
