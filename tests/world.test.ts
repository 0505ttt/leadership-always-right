import { describe,it,expect } from 'vitest';
import type { Vec2 } from '../src/contracts/game';
import { createGame } from '../src/rules/game';
import { generateWorld } from '../src/world/generate';
import { makeWorldQuery, segmentRect } from '../src/world/query';
import { validateWorld } from '../src/world/validate';
describe('V3 offices',()=>{
 for(const seed of [1,2,3,4,5,42,618,666,2026,1030,99999,0xffffffff])it(`seed ${seed} has two routes and all objective clearances`,()=>{const w=generateWorld(seed),s=createGame(w),r=validateWorld(w,s);expect(r.failures,JSON.stringify(r)).toEqual([]);expect(generateWorld(seed)).toEqual(w);});
 it('chair crosses every normal door without walking through the wall',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w);for(const d of w.doors.filter(d=>!d.crawl)){const a={x:d.x+(d.axis==='z'?-.8:0),z:d.z+(d.axis==='x'?-.8:0)},delta={x:d.axis==='z'?1.6:0,z:d.axis==='x'?1.6:0};const b=q.move(a,delta,.3,1.42,s);expect(Math.hypot(b.x-a.x,b.z-a.z)).toBeGreaterThan(1.5);}});
 it('crawlways permit crouch but block chair; overhead prevents standing inside',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w),d=w.doors.find(d=>d.crawl)!;const a={x:d.x,z:d.z-.8};expect(q.move(a,{x:0,z:1.6},.3,.9,s).z).toBeCloseTo(d.z+.8);expect(q.move(a,{x:0,z:1.6},.3,1.42,s).z).toBeLessThan(d.z);expect(q.clearance(d,s)).toBe(.95);});
 it('raised desk opens the actual air underneath, and a jump clears a low box',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w),d=w.desks[0];s.deskHeights[d.id]=1.9;expect(q.lineOfSight({x:d.x-1.1,z:d.z},{x:d.x+1.1,z:d.z},1.5,s)).toBe(true);const p=s.props.find(p=>p.kind==='box')!;const a={x:p.x-1,z:p.z};expect(q.move(a,{x:2,z:0},.3,1.75,s,.65).x).toBeCloseTo(p.x+1);expect(q.move(a,{x:2,z:0},.3,1.75,s,0).x).toBeLessThan(p.x);});
 it('A* path segments stay out of walls even on a long capture route',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w);let p:Vec2={...w.stations[1]};const path=q.path(p,w.spawn,s);expect(path.length).toBeGreaterThan(3);for(const end of path){for(const wall of w.walls)expect(segmentRect(p,end,wall,.3)).toBe(false);p=end;}});
});

describe('tight clearance regressions',()=>{
 it('allows an actor touching a wall to enter and leave the navigation graph',()=>{const w=generateWorld(618),s=createGame(w),q=makeWorldQuery(w);for(const x of [.42,.43,.45]){const edge={x,z:10},open={x:3,z:10};expect(q.validPlacement(edge,.3,s)).toBe(true);expect(q.path(edge,open,s).length).toBeGreaterThan(0);expect(q.path(open,edge,s).length).toBeGreaterThan(0);}});
});
