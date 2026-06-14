import { describe, it, expect } from 'vitest';
import { newState, step, endReason, subsidyErosion } from './sim';
import { defaultParams } from './types';

describe('endReason — three endings (§7.4)', () => {
  it('none while ongoing', () => {
    const s = newState(defaultParams({ enableEvents: false }));
    step(s);
    expect(endReason(s)).toBe('none');
  });

  it('cancellation: survive to horizon with subsidy eroded past cancelErosion', () => {
    const s = newState(defaultParams({ enableEvents: false, maxWindows: 40 }));
    for (let i = 0; i < 40; i++) step(s);
    // 3%/window over 40 → ~69% erosion > 0.5 → Earth cancels
    expect(subsidyErosion(s)).toBeGreaterThan(0.5);
    expect(endReason(s)).toBe('cancellation');
  });

  it('stall: survive to horizon with mild inflation (erosion below threshold)', () => {
    const s = newState(defaultParams({ enableEvents: false, inflation: 0.0, maxWindows: 40 }));
    for (let i = 0; i < 40; i++) step(s);
    expect(subsidyErosion(s)).toBe(0);
    expect(endReason(s)).toBe('stall');
  });

  it('collapse: population crash sets the collapse ending', () => {
    // tiny subsidy → cannot cover F → mortality spiral → pop crash
    const s = newState(defaultParams({ enableEvents: false, M: 1e8, maxWindows: 40 }));
    for (let i = 0; i < 40 && !s.collapsed; i++) step(s);
    expect(s.collapsed).toBe(true);
    expect(endReason(s)).toBe('collapse');
  });
});
