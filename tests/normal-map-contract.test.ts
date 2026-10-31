import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/world/generate';
import { hasNormalOfficeDensity } from '../src/world/validate';

describe('normal office density contract', () => {
  it('accepts normal 10/21/7 worlds and rejects the sparse 618 preview as production load', () => {
    expect(hasNormalOfficeDensity(generateWorld(42))).toBe(true);
    expect(hasNormalOfficeDensity(generateWorld(618))).toBe(false);
  });

  it('does not silently fall back to the sparse preview in the main loader', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('hasNormalOfficeDensity(world)');
    expect(main).not.toContain('),618];');
  });
});
