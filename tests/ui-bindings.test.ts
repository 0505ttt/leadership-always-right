import { expect, it } from 'vitest';
import { bindUI } from '../src/ui/bindings';
import { createGame } from '../src/rules/game';
import { generateWorld } from '../src/world/generate';
import type { Settings } from '../src/contracts/game';

it('exposes the actual evidence countdown without changing the authoritative timer',()=>{
 const world=generateWorld(618),state=createGame(world);
 const settings:Settings={quality:'medium',sensitivity:1,invertY:false,reducedMotion:false,textScale:1};
 const options={page:'playing' as const,version:'test',tutorialPage:0,settings,loadingStage:'',error:'',phone:false};
 state.boss.evidenceId='clock';state.boss.evidenceUntil=30;state.elapsed=10;
 expect(bindUI(state,world,options).bossEvidenceRemaining).toBe(20);
 state.elapsed=17.5;
 expect(bindUI(state,world,options).bossEvidenceRemaining).toBe(12.5);
 state.elapsed=31;
 expect(bindUI(state,world,options).bossEvidenceRemaining).toBe(0);
 expect(state.boss.evidenceUntil).toBe(30);
});
