import type { CharacterPoseInput, CharacterVisual } from '../presentation/characters';

/**
 * Reuse the solved ordinary seated rig while allowing its control root to move.
 * The caller marks animated working poses and transitions with dynamicWorking;
 * those, plus all non-working poses, retain their per-frame animation update.
 */
export function createCharacterUpdater<T extends CharacterPoseInput>(visual: Pick<CharacterVisual, 'root'> & {update(input:T):void}, dynamicWorking:(input:T)=>boolean=()=>false): (input: T) => void {
  let lastWorkingKey: string | null = null;
  return input => {
    const stationaryWorking = input.pose === 'working' && !input.moving && !input.sprint && !input.gesturing && !dynamicWorking(input);
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
