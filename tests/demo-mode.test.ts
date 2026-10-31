import { expect, it } from 'vitest';
import type { GameState, InputFrame } from '../src/contracts/game';
import { createGame, stepGame } from '../src/rules/game';
import { generateWorld } from '../src/world/generate';
import { makeWorldQuery } from '../src/world/query';

const idle: InputFrame = { moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouchPressed: false, jumpPressed: false, interact: false, interactPressed: false, potPressed: false, dropPressed: false, throwPressed: false, aim: false };
function advance(state: GameState, seconds: number): void {
  const world = generateWorld(state.seed), query = makeWorldQuery(world);
  for (let elapsed = 0; elapsed < seconds - 1e-8; elapsed += .1) stepGame(state, idle, .1, world, query);
}

it('uses one authoritative clock for a 180-second playable demo', { timeout: 15000 }, () => {
  const state = createGame(generateWorld(42), 180);
  state.player.protection = Infinity;
  expect(state.roundSeconds).toBe(180);
  expect(state.remaining).toBe(180);
  advance(state, 179.9);
  expect(state.ending).toBeNull();
  advance(state, .2);
  expect(state.elapsed).toBe(180);
  expect(state.remaining).toBe(0);
  expect(state.ending).toBe('overtime');
});

it('keeps the ordinary round at 600 seconds', { timeout: 15000 }, () => {
  const state = createGame(generateWorld(42));
  state.player.protection = Infinity;
  expect(state.roundSeconds).toBe(600);
  advance(state, 599.9);
  expect(state.ending).toBeNull();
  advance(state, .2);
  expect(state.elapsed).toBe(600);
  expect(state.ending).toBe('overtime');
});
