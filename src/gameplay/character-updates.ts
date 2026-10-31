import type { CharacterPoseInput, CharacterVisual } from '../presentation/characters';

/**
 * The current stationary working pose has no time-driven animation. Reuse its
 * solved local rig while allowing the control root to move or turn. All other
 * poses, including crouching and rolling, retain their full per-frame update.
 * Revisit this opt-in if the visual component adds time-driven working motion.
 */
export function createCharacterUpdater(visual: Pick<CharacterVisual, 'root' | 'update'>): (input: CharacterPoseInput) => void {
  let lastWorkingKey: string | null = null;
  return input => {
    const stationaryWorking = input.pose === 'working' && !input.moving && !input.sprint && !input.gesturing;
    if (!stationaryWorking) {
      lastWorkingKey = null;
      visual.update(input);
      return;
    }
    const { time: _time, ...semantics } = input;
    const key = JSON.stringify([semantics, visual.root.scale.toArray()]);
    if (key === lastWorkingKey) {
      // Anchors and skinned bind matrices must follow the authoritative root.
      visual.root.updateMatrixWorld(true);
      return;
    }
    lastWorkingKey = null;
    visual.update(input);
    // A failed pose update must never leave a successful cache entry behind.
    lastWorkingKey = key;
  };
}
