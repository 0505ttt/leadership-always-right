import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createRoomDecorations } from '../src/presentation/room-decorations';
import { generateWorld } from '../src/world/generate';

const context = new Proxy({ measureText: () => ({ width: 20 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
afterEach(() => vi.unstubAllGlobals());

it('does not turn a whole low tea counter into a full-height plant collider', () => {
  const world = generateWorld(42);
  const plant = new THREE.Mesh(new THREE.BoxGeometry(.34, 1.15, .34));
  const decorations = createRoomDecorations(world, { models: id => id === 'plant-v1' ? plant : undefined });
  const counter = decorations.getDiagnostics().colliders.find(item => item.id.startsWith('tea-counter:'));
  expect(counter).toBeDefined();
  expect(counter!.height).toBeLessThan(1.3);
  decorations.dispose();
  plant.geometry.dispose();
});
