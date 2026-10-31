import { generateWorld } from '../world/generate';
import { createGame, stepGame } from '../rules/game';
import { makeWorldQuery } from '../world/query';
import { hasNormalOfficeDensity, validateWorld } from '../world/validate';
import { validateWorkstationAccess } from '../world/workstations';
import { OfficeScene } from './scene';
import { createCharacterLibrary } from './characters';
import { RuntimeAssets } from '../gameplay/assets';
import { runtimeAssetSpecs } from '../gameplay/runtime-catalog';
import { FrameMetrics } from '../gameplay/performance';
import type { InputFrame, Settings } from '../contracts/game';

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const requested = Number(params.get('seed') ?? '42');
  const world = generateWorld(Number.isFinite(requested) ? requested : 42);
  if (!hasNormalOfficeDensity(world)) throw new Error('验收场景不是正常10房21桌7同事布局。');
  const state = createGame(world);
  const query = makeWorldQuery(world);
  const host = document.querySelector<HTMLDivElement>('#scene')!;
  const detail = document.querySelector<HTMLSpanElement>('#detail')!;
  const settings: Settings = { quality: 'medium', sensitivity: 1, invertY: false, reducedMotion: false, textScale: 1, musicVolume: 0, effectsVolume: 0, voiceVolume: 0 };
  const assets = new RuntimeAssets();
  const specs = runtimeAssetSpecs(import.meta.env.BASE_URL, 'room-scene-recheck');
  await assets.preload(specs);
  detail.textContent = '准备正式角色库…';
  const characterLibrary = createCharacterLibrary({ assets });
  await characterLibrary.prepare();
  const office = new OfficeScene(host, settings);
  office.useRuntimeAssets(assets, specs.map(spec => spec.id));
  office.useCharacterLibrary(characterLibrary);
  office.load(world);
  world.decorationColliders = office.getDecorationColliders();
  const decoratedQuery = makeWorldQuery(world);
  const validation = validateWorld(world, state, decoratedQuery);
  const workstationIssues = validateWorkstationAccess(world, state, decoratedQuery);
  if (!validation.valid || workstationIssues.length) throw new Error(`正式装配路线失败：${[...validation.failures, ...workstationIssues].join('；')}`);
  if (office.getRuleVisuals().characters.some(actor => actor.assetId === 'technical-placeholder')) throw new Error('正式角色未接入。');
  world.validation.push(
    ...validation.spawnClockDistances.map(distance => `打卡路线${distance.toFixed(1)}m`),
    ...validation.spawnExitDistances.map(distance => `出口路线${distance.toFixed(1)}m`),
    '21个工位接近与升桌上下椅路线均可用',
  );
  detail.textContent = '上传纹理并预编译正式场景…';
  office.render(state, state.player.yaw + Math.PI, 0, 'ready', 1 / 60);
  await office.prepare();
  const metrics = new FrameMetrics();
  const idle: InputFrame = { moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouchPressed: false, jumpPressed: false, interact: false, interactPressed: false, potPressed: false, dropPressed: false, throwPressed: false, aim: false };
  let last = performance.now();
  office.render(state, state.player.yaw + Math.PI, 0, 'playing', 0);
  const animate = (now: number) => {
    const dt = Math.min(.05, Math.max(0, (now - last) / 1000));
    metrics.frame(now, true, state.elapsed, `${state.boss.mode}/${state.player.pose}/${state.rules.filter(rule => rule.phase === 'active').map(rule => rule.kind).join('+') || 'normal'}`);
    last = now;
    stepGame(state, idle, dt, world, decoratedQuery);
    office.render(state, state.player.yaw + Math.PI, 0, 'playing', dt);
  };
  office.renderer.setAnimationLoop(animate);
  detail.textContent = `seed ${world.seed} · 10房 / 21桌 / 7同事 · 正式场景`;
  const api = {
    ready: true,
    seed: world.seed,
    getSnapshot: () => JSON.parse(JSON.stringify({ page: 'playing', state, world, visuals: office.getRuleVisuals() })),
    getPerformance: () => ({ ...metrics.report(), device: office.getMetrics(), quality: settings.quality }),
    resetPerformance: () => metrics.reset(),
    getValidation: () => ({ validation, workstationIssues, worldValidation: world.validation }),
    dispose: () => {
      office.renderer.setAnimationLoop(null);
      office.dispose(); characterLibrary.dispose(); assets.dispose();
    },
  };
  (window as unknown as Record<string, unknown>).__ROOM_SCENE_RECHECK__ = api;
}

start().catch(error => {
  console.error(error);
  const detail = document.querySelector<HTMLSpanElement>('#detail');
  if (detail) detail.textContent = `验收场景启动失败：${error instanceof Error ? error.message : String(error)}`;
});
