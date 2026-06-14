import { describe, it, expect } from 'vitest';
import { makeRng } from './rng';

describe('makeRng — deterministic seedable (SDD §9)', () => {
  it('same seed → identical sequence', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 10 }, () => a.random());
    const seqB = Array.from({ length: 10 }, () => b.random());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds → different sequences', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.random()).not.toBe(b.random());
  });

  it('random() stays in [0, 1)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('choice picks a member and is seed-deterministic', () => {
    const arr = ['a', 'b', 'c', 'd'] as const;
    const r1 = makeRng(99);
    const r2 = makeRng(99);
    const picks1 = Array.from({ length: 5 }, () => r1.choice(arr));
    const picks2 = Array.from({ length: 5 }, () => r2.choice(arr));
    expect(picks1).toEqual(picks2);
    for (const pick of picks1) expect(arr).toContain(pick);
  });
});
