import { describe, expect, it } from 'vitest';
import { requiresLandscapeForTouch } from '../src/gameplay/orientation';

describe('touch gameplay orientation', () => {
  it('requires landscape only for touch gameplay', () => {
    expect(requiresLandscapeForTouch(true, 390, 844)).toBe(true);
    expect(requiresLandscapeForTouch(true, 844, 390)).toBe(false);
    expect(requiresLandscapeForTouch(false, 390, 844)).toBe(false);
  });
});
