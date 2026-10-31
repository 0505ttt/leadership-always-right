import { describe, expect, it } from 'vitest';
import { touchActionGroups } from '../src/gameplay/touch-actions';

describe('compact touch action palette', () => {
  it('keeps only interact and sprint in the default row, with seven actions in the expandable panel', () => {
    expect(touchActionGroups.primary).toEqual(['interact', 'sprint']);
    expect(touchActionGroups.secondary).toEqual(['jump', 'crouch', 'pot', 'aim', 'throw', 'drop', 'computer']);
    expect(touchActionGroups.primary.length + 1).toBe(3);
  });

  it('preserves every original gameplay action exactly once', () => {
    const all = [...touchActionGroups.primary, ...touchActionGroups.secondary];
    expect(new Set(all).size).toBe(9);
    expect(all).toContain('computer');
  });
});
