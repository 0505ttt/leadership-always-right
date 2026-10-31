import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createOfficeEffects } from '../src/presentation/effects';
import { VisualResourcePool } from '../src/presentation/visual-utils';
import { generateWorld } from '../src/world/generate';
import { createGame } from '../src/rules/game';

vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) });
afterEach(() => vi.unstubAllGlobals());

it('excludes only point lights beyond their existing physical range', () => {
  const world = generateWorld(42), state = createGame(world), pool = new VisualResourcePool();
  const lights = new Map(world.rooms.map(room => [room.id, new THREE.PointLight(0xffffff, 19, 15, 2)]));
  for (const room of world.rooms) lights.get(room.id)!.position.set(room.x, 2.48, room.z);
  const effects = createOfficeEffects(world, { walls: new Map(), desks: new Map(), deskLegs: new Map(), roomLights: lights, roomMaterials: new Map(), switchIndicators: new Map() }, pool);
  Object.assign(state.player, { x: world.rooms[0].x + 16, z: world.rooms[0].z });
  effects.update(state);
  for (const room of world.rooms) {
    const light = lights.get(room.id)!;
    const distance = Math.hypot(state.player.x - light.position.x, state.player.y - light.position.y, state.player.z - light.position.z);
    expect(light.visible, room.name).toBe(distance <= light.distance);
    expect(light.intensity, room.name).toBe(19);
  }
  state.lights[world.rooms[0].id] = false;
  effects.update(state);
  expect(lights.get(world.rooms[0].id)!.intensity).toBe(.35);
  effects.root.removeFromParent(); pool.dispose();
});
