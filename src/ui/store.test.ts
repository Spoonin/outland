import { describe, it, expect } from 'vitest';
import { GameStore } from './store';
import { defaultParams } from '../engine';

describe('GameStore (UI pub/sub over the engine)', () => {
  it('advances windows and notifies subscribers', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    let pings = 0;
    store.subscribe(() => pings++);
    store.advance();
    expect(pings).toBe(1);
    expect(store.latest()?.window).toBe(1);
  });

  it('snapshot omits survival runway (D-025 — debrief only)', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    store.advance();
    const snap = store.snapshot();
    expect(snap).not.toHaveProperty('runway');
    expect(snap.nodes.length).toBe(27);
    expect(snap.autonomy).toBeGreaterThan(0);
  });

  it('stops advancing at maxWindows', () => {
    const store = new GameStore(defaultParams({ enableEvents: false, maxWindows: 3 }));
    store.advance();
    store.advance();
    store.advance();
    expect(store.ended).toBe(true);
    store.advance(); // no-op
    expect(store.latest()?.window).toBe(3);
  });

  it('reset clears history', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    store.advance();
    store.reset();
    expect(store.getHistory().length).toBe(0);
    expect(store.snapshot().window).toBe(0);
  });

  it('black nodes always report status "black"', () => {
    const store = new GameStore(defaultParams({ enableEvents: false }));
    const snap = store.snapshot();
    const pharma = snap.nodes.find((n) => n.name === 'pharma')!;
    expect(pharma.status).toBe('black');
  });
});
