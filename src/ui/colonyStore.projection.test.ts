// Roadmap-1 (плейтест-5): honest projection warnings + auto-pharma + zero_import auto-floor hints.
// Store-level tests use ColonyStore's public API; a couple of engine-level checks (projectOrder's
// non-mutation, the LS-ceiling scenario) go straight at the engine to avoid the housing-cap dance.

import { describe, it, expect } from 'vitest';
import { ColonyStore, type KV } from './colonyStore';
import { i18n } from './i18n';
import {
  defaultColonyParams,
  newColony,
  emptyOrder,
  projectOrder,
  supplyDeaths,
  pharmaNeed,
} from '../engine';

function memKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('projectOrder (engine, roadmap-1)', () => {
  it('does not mutate the real state — runs on a throwaway clone', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }));
    const windowBefore = s.window;
    const popBefore = s.pop;
    const chronicleBefore = s.chronicle.length;
    projectOrder(s, emptyOrder());
    expect(s.window).toBe(windowBefore);
    expect(s.pop).toBe(popBefore);
    expect(s.chronicle.length).toBe(chronicleBefore);
  });

  it('sees a life-support ceiling BEFORE it bites: 20 people on a base_block sized for 20, +30 more with no O₂/water top-up', () => {
    // base_block's water/O₂ output is calibrated (D-066) for exactly its own 20-person housing —
    // engine-level feasibility has no housing gate at all (that's a store/UI-only convenience,
    // D-056), so ordering 30 more colonists with nothing to feed them is perfectly "feasible" and
    // would have silently killed people on arrival without this projection (плейтест-5's exact bug).
    // Buffer sized thin (0.3 windows) so the original 20 stay stable in `next` (base_block runs a
    // slight SURPLUS at exactly 20) but the ADDED 30 exhaust it within the single `after` window;
    // food is given a huge separate stock since base_block never produces any (isolates the O₂/
    // water ceiling this test is actually about from an unrelated, permanent food shortfall).
    const s = newColony(defaultColonyParams({ pop0: 20, startStockWindows: 0.3, illnessProb: 0, eventChanceCap: 0 }));
    s.built = { base_block: 1 };
    s.condition = { base_block: 1 };
    s.everHadPop = true; // presence already established — D-078 doesn't block this order
    s.stocks.food = 10_000_000;
    const order = { ...emptyOrder(), colonists: 30 };
    const { next, after } = projectOrder(s, order);
    expect(supplyDeaths(next)).toBe(0); // the 30 haven't landed yet THIS window — nothing to kill
    expect(supplyDeaths(after)).toBeGreaterThan(0); // they have, and base_block can't feed 50
    expect(after.mortalityBreakdown.o2).toBeGreaterThan(0); // base_block's O₂ output binds first
  });
});

describe('ColonyStore.projection() / projectionWarnings() (roadmap-1)', () => {
  it('caches by draft signature — same reference until the draft changes', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 100, startStockWindows: 5 }), memKV());
    const a = store.projection();
    const b = store.projection();
    expect(a).toBe(b);
    store.setRes('food', 1000);
    const c = store.projection();
    expect(c).not.toBe(a);
  });

  it('does not telegraph storyteller events — the clone always disables them regardless of the store\'s own config (D-063)', () => {
    // Same seed/pop/stocks, only eventChanceCap differs — projectOrder forces it to 0 in ITS clone
    // either way, so both stores must project the identical outcome.
    const withEvents = new ColonyStore(
      defaultColonyParams({ pop0: 1000, startStockWindows: 5, seed: 7, eventChanceCap: 1, eventStartWindow: 0, eventRampPerWindow: 1 }),
      memKV(),
    );
    const without = new ColonyStore(
      defaultColonyParams({ pop0: 1000, startStockWindows: 5, seed: 7, eventChanceCap: 0 }),
      memKV(),
    );
    const a = withEvents.projection();
    const b = without.projection();
    expect(a.after.mortality).toBe(b.after.mortality);
    expect(a.after.pop).toBe(b.after.pop);
    expect(a.next.mortality).toBe(b.next.mortality);
  });

  it('projectionWarnings is empty for a quiet, unpopulated colony', () => {
    const store = new ColonyStore(defaultColonyParams(), memKV()); // pop0 default 0
    expect(store.projectionWarnings()).toEqual([]);
  });

  it('projectionWarnings names supply deaths projected for THIS window when stock is already thin', () => {
    // pop0 1000 with under a third of a window's life-support buffer and nothing ordered — the
    // shortfall hits in `next` itself, before any new colonists even enter the picture.
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 0.3 }), memKV());
    const warnings = store.projectionWarnings();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('прогноз на это окно');
    expect(warnings[0]).toContain('†');
  });

  it('projectionWarnings uses the active UI language for warning text', () => {
    const prevLang = i18n.get();
    i18n.set('en');
    try {
      const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 0.3 }), memKV());
      const warnings = store.projectionWarnings();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('⚠ forecast this window');
      expect(warnings[0]).toContain('starvation');
      expect(warnings[0]).toContain('†');
    } finally {
      i18n.set(prevLang);
    }
  });

  it('projectionWarnings names the AFTER-landing shortfall for a draft ordering more colonists than life support covers', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 20, startStockWindows: 5, illnessProb: 0 }), memKV());
    // no store API to plant `built` directly without a full commit cycle — reach the same state
    // colonyStore.test.ts's BOOTSTRAP GUARANTEE fixture reaches, minus habitat (keeps the scenario
    // to exactly the LS ceiling this warning is about, no N₂-leak noise from a second structure).
    // Simplest path: commit an order that imports base_block onto an ALREADY-populated colony.
    store.setImportQty('base_block', 1);
    store.commit(); // ship
    store.commit(); // land — base_block built; pop0's 20 were already alive (unfed) meanwhile
    store.setColonists(30);
    const warnings = store.projectionWarnings();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('после посадки'))).toBe(true);
  });
});

describe('pharmaNeed / auto-pharma (roadmap-1, mirrors auto-spares D-070)', () => {
  it('pharmaNeed = structural draw + expected illness treatments at current pop', () => {
    const s = newColony(defaultColonyParams({ pop0: 0, illnessProb: 0.03, pharmaPerTreatment: 20 }));
    s.built = { medbay: 1 }; // cons.pharma 120/window per unit (structures.csv)
    s.pop = 50;
    expect(pharmaNeed(s)).toBe(120 + Math.ceil(50 * 0.03) * 20); // 120 + 2*20 = 160
  });

  it('auto-pharma floors the order at pharmaNeed(); manual entries only add on top, never defeat the floor', () => {
    const params = defaultColonyParams({ pop0: 1000 }); // illness treatments alone floor it > 0
    const store = new ColonyStore(params, memKV());
    const expected = pharmaNeed(newColony(params));
    expect(expected).toBeGreaterThan(0);
    expect(store.resQty('pharma')).toBe(0); // off by default
    store.toggleAutoPharma();
    expect(store.resQty('pharma')).toBe(expected);
    store.setRes('pharma', expected + 500); // manual ABOVE the floor wins
    expect(store.resQty('pharma')).toBe(expected + 500);
    store.setRes('pharma', 1); // manual BELOW the floor doesn't defeat it
    expect(store.resQty('pharma')).toBe(expected);
  });
});

describe('zeroImportBlockedByAuto (roadmap-1 C3/C4)', () => {
  it('is null when the manifest is genuinely empty (no auto-floor active)', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000 }), memKV());
    expect(store.zeroImportBlockedByAuto()).toBeNull();
  });

  it('flags an empty-looking manifest that auto-pharma alone will still ship', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000 }), memKV()); // illness treatments floor pharma > 0
    store.toggleAutoPharma();
    const blocked = store.zeroImportBlockedByAuto();
    expect(blocked).not.toBeNull();
    expect(blocked!.pharma).toBe(true);
    expect(blocked!.spares).toBe(false);
  });

  it('returns null once anything else is genuinely ordered — the manifest is no longer empty-looking', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000 }), memKV());
    store.toggleAutoPharma();
    store.setRes('food', 100); // a real manual order
    expect(store.zeroImportBlockedByAuto()).toBeNull();
  });
});
