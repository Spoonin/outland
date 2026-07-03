import { describe, it, expect } from 'vitest';
import { makeRng } from './rng';
import type { Rng } from './types';
import {
  EVENTS,
  eventChance,
  rollEvent,
  effectMultiplier,
  priceMultFor,
  decayEffects,
  type ActiveEffect,
} from './events';

/** A scripted Rng for exact control over rollEvent's draws. `choice` doesn't consume a `random()`
 * draw (unlike the real mulberry32 Rng) — it deterministically picks `chooseIndex % arr.length`,
 * so the same index works whether `choice` is asked to pick an event or a price category. */
function fakeRng(randoms: number[], chooseIndex = 0): Rng {
  let i = 0;
  return {
    random: () => randoms[i++] ?? 0,
    choice: <T>(arr: readonly T[]): T => arr[chooseIndex % arr.length]!,
    state: () => 0,
  };
}

const CFG = { eventStartWindow: 3, eventRampPerWindow: 0.1, eventChanceCap: 0.6, eventPopRef: 500 };
const POP = CFG.eventPopRef; // full severity range — keeps magnitude assertions exact

describe('eventChance — storyteller escalation curve (D-063)', () => {
  it('is zero before the start window', () => {
    expect(eventChance(0, 3, 0.1, 0.6)).toBe(0);
    expect(eventChance(2, 3, 0.1, 0.6)).toBe(0);
  });

  it('ramps linearly past the start window', () => {
    expect(eventChance(3, 3, 0.1, 0.6)).toBeCloseTo(0, 5);
    expect(eventChance(8, 3, 0.1, 0.6)).toBeCloseTo(0.5, 5);
  });

  it('caps at the ceiling', () => {
    expect(eventChance(100, 3, 0.1, 0.6)).toBe(0.6);
  });
});

describe('rollEvent — pure, deterministic given the same Rng draws (D-063)', () => {
  it('returns null when the chance roll misses', () => {
    // window 8 → chance 0.5; a draw of 0.9 misses
    const roll = rollEvent(8, POP, CFG, undefined, fakeRng([0.9]));
    expect(roll).toBeNull();
  });

  it('fires and picks by index when the chance roll hits', () => {
    // window 8 → chance 0.5; draw 0.1 hits; choice index 0 → first event in EVENTS
    const roll = rollEvent(8, POP, CFG, undefined, fakeRng([0.1, 0, 0, 0, 0], 0));
    expect(roll).not.toBeNull();
    expect(roll!.spec.id).toBe(EVENTS[0]!.id);
  });

  it('rolls magnitude within [minMag, maxMag] and duration within [minDur, maxDur]', () => {
    const idx = EVENTS.findIndex((e) => e.minDur !== e.maxDur); // a multi-window event (e.g. dust_storm)
    expect(idx).toBeGreaterThanOrEqual(0);
    // draws: [0]=chance (hits), [1]=magnitude (→ top of range), [2]=duration (→ top of range)
    const roll = rollEvent(8, POP, CFG, undefined, fakeRng([0.0, 1, 1], idx));
    const spec = EVENTS[idx]!;
    expect(roll!.mag).toBeCloseTo(spec.maxMag, 5);
    expect(roll!.dur).toBe(spec.maxDur);
  });

  it('excludes the given id from the pool (no repeat two windows in a row)', () => {
    const excluded = EVENTS[0]!.id;
    // choice index 0 against the FILTERED pool must now land on EVENTS[1]
    const roll = rollEvent(8, POP, CFG, excluded, fakeRng([0.0, 0, 0, 0], 0));
    expect(roll!.spec.id).not.toBe(excluded);
    expect(roll!.spec.id).toBe(EVENTS[1]!.id);
  });

  it('price_spike rolls a category', () => {
    const idx = EVENTS.findIndex((e) => e.effect === 'price');
    const roll = rollEvent(8, POP, CFG, undefined, fakeRng([0.0, 0, 0, 0, 0], idx));
    expect(roll!.category).toBeDefined();
    expect(roll!.category!.length).toBeGreaterThan(0);
  });

  it('non-price events carry no category', () => {
    const idx = EVENTS.findIndex((e) => e.effect === 'energy');
    const roll = rollEvent(8, POP, CFG, undefined, fakeRng([0.0, 0, 0, 0], idx));
    expect(roll!.category).toBeUndefined();
  });

  it('is a pure function — same seed & window reproduce the same roll (replay/determinism)', () => {
    const a = rollEvent(10, POP, CFG, undefined, makeRng(42));
    const b = rollEvent(10, POP, CFG, undefined, makeRng(42));
    expect(a).toEqual(b);
  });

  it('severity scales with population (D-063): a tiny outpost draws minMag, a big colony the full range', () => {
    // same draws, different pop — only the magnitude cap moves
    const spec = EVENTS[0]!;
    const tiny = rollEvent(8, 0, CFG, undefined, fakeRng([0.0, 1, 1], 0));
    expect(tiny!.mag).toBeCloseTo(spec.minMag, 5); // cap collapsed to the floor
    const half = rollEvent(8, CFG.eventPopRef / 2, CFG, undefined, fakeRng([0.0, 1, 1], 0));
    expect(half!.mag).toBeCloseTo(spec.minMag + (spec.maxMag - spec.minMag) / 2, 5);
    const big = rollEvent(8, CFG.eventPopRef * 3, CFG, undefined, fakeRng([0.0, 1, 1], 0));
    expect(big!.mag).toBeCloseTo(spec.maxMag, 5); // saturates at popRef
  });
});

describe('effectMultiplier / priceMultFor / decayEffects (D-063)', () => {
  const effects: ActiveEffect[] = [
    { id: 'a', effect: 'energy', mag: 0.5, windowsLeft: 2 },
    { id: 'b', effect: 'farm', mag: 0.3, windowsLeft: 1 },
    { id: 'c', effect: 'energy', mag: 0.2, windowsLeft: 0 }, // expired — must be ignored
    { id: 'd', effect: 'price', mag: 1.8, windowsLeft: 1, category: ['food', 'water'] },
  ];

  it('multiplies matching, still-active effects; ignores expired and other kinds', () => {
    expect(effectMultiplier(effects, 'energy')).toBeCloseTo(0.5, 5); // only 'a' counts
    expect(effectMultiplier(effects, 'farm')).toBeCloseTo(0.7, 5);
    expect(effectMultiplier(effects, 'subsidy')).toBe(1); // none active → no-op
  });

  it('compounds multiple active effects of the same kind multiplicatively', () => {
    const stacked: ActiveEffect[] = [
      { id: 'x', effect: 'energy', mag: 0.5, windowsLeft: 1 },
      { id: 'y', effect: 'energy', mag: 0.5, windowsLeft: 1 },
    ];
    expect(effectMultiplier(stacked, 'energy')).toBeCloseTo(0.25, 5); // (1-.5)*(1-.5)
  });

  it('priceMultFor only applies to resources in the event\'s category', () => {
    expect(priceMultFor(effects, 'food')).toBeCloseTo(1.8, 5);
    expect(priceMultFor(effects, 'steel')).toBe(1); // not in category
  });

  it('decayEffects decrements and drops effects that hit zero', () => {
    const next = decayEffects(effects);
    expect(next.find((e) => e.id === 'a')!.windowsLeft).toBe(1);
    expect(next.find((e) => e.id === 'b')).toBeUndefined(); // 1 → 0, dropped
    expect(next.find((e) => e.id === 'c')).toBeUndefined(); // was already expired
  });
});
