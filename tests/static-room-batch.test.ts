import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createRoomDecorations } from '../src/presentation/room-decorations';
import { generateWorld } from '../src/world/generate';
import { createGame } from '../src/rules/game';

const context = new Proxy({ measureText: () => ({ width: 20 }), createLinearGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
afterEach(() => vi.unstubAllGlobals());

it('batches static room decoration meshes without hiding dynamic signs or changing collision data', () => {
  const world = generateWorld(42), state = createGame(world);
  const decorations = createRoomDecorations(world);
  const before = decorations.decorationColliders.map(item => ({ ...item }));
  let visibleMeshes = 0;
  decorations.root.traverse(object => { if (object instanceof THREE.Mesh && object.visible) visibleMeshes++; });
  expect(visibleMeshes).toBeLessThan(300);
  expect(decorations.getDiagnostics().staticBatches!.sourceMeshes).toBeGreaterThan(100);
  expect(decorations.getDiagnostics().staticBatches!.mergedMeshes).toBeGreaterThan(0);
  expect(decorations.decorationColliders).toEqual(before);
  const partition = world.walls.find(wall => wall.partition)!;
  const wallSign = decorations.root.getObjectByName(`partition-board:${partition.roomId}:${partition.id}:1`)!;
  expect(wallSign.visible).toBe(true);
  decorations.update({ ...state, transparentWalls: [partition.id] });
  expect(wallSign.visible).toBe(false);
  decorations.update(state);
  expect(wallSign.visible).toBe(true);
  const desk = world.desks.find(desk => !desk.home && desk.roomId === world.rooms.find(room => room.kind === 'work')!.id)!;
  const tag = decorations.root.getObjectByName(`desk-department:${desk.id}`)!;
  decorations.update({ ...state, deskHeights: { ...state.deskHeights, [desk.id]: 1.9 } });
  expect(tag.position.y).toBe(1.9);
  decorations.dispose();
});
