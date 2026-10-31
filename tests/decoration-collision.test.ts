import { describe, expect, it } from 'vitest';
import type { StaticDecorationCollider, Vec2 } from '../src/contracts/game';
import { generateWorld } from '../src/world/generate';
import { createGame } from '../src/rules/game';
import { makeWorldQuery, segmentRect } from '../src/world/query';
import { resolveCamera } from '../src/gameplay/camera';

function emptyOffice() {
 const world=generateWorld(618),state=createGame(world);
 world.width=world.depth=12;
 world.rooms=[{...world.rooms[0],id:0,x:6,z:6,w:12,d:12,pressure:false,permanentLight:true}];
 world.walls=[];world.doors=[];world.desks=[];world.exits=[];world.stations=[];world.props=[];world.colleagues=[];
 world.spawn={x:1,z:1};state.props=[];state.colleagues=[];
 return {world,state,query:makeWorldQuery(world)};
}
const cabinet=():StaticDecorationCollider=>({id:'cabinet',roomId:0,x:6,z:6,w:2,d:1,height:1.2});

describe('assembled visual solids',()=>{
 it('block movement and placement, and support an actor whose feet reach their top',()=>{
  const {world,state,query}=emptyOffice();world.decorationColliders=[cabinet()];
  const start={x:3,z:6},delta={x:6,z:0};
  expect(query.move(start,delta,.3,1.75,state).x).toBeLessThanOrEqual(4.7);
  expect(query.move(start,delta,.3,.9,state).x).toBeLessThanOrEqual(4.7);
  expect(query.move(start,delta,.3,1.42,state,1.19).x).toBeLessThanOrEqual(4.7);
  expect(query.move(start,delta,.3,1.42,state,1.2).x).toBeCloseTo(9);
  expect(query.supportHeight({x:6,z:6},state)).toBe(1.2);
  expect(query.supportHeight({x:3,z:6},state)).toBe(0);
  expect(query.validPlacement({x:6,z:6},.3,state)).toBe(false);
  expect(query.validPlacement({x:9,z:6},.3,state)).toBe(true);
 });

 it.each(['vision','solid'] as const)('blocks low %s rays but allows rays above a cabinet',mode=>{
  const {world,state,query}=emptyOffice();world.decorationColliders=[cabinet()];
  const start={x:3,z:6},end={x:9,z:6};
  state.transparentWalls=['cabinet'];
  expect(query.lineOfSight(start,end,1.1,state,mode)).toBe(false);
  expect(query.lineOfSight(start,end,1.3,state,mode)).toBe(true);
 });

 it('invalidates occupied navigation cells when decoration is registered or moved on an existing query',()=>{
  const {world,state,query}=emptyOffice();
  world.walls=[{id:'fixed-wall',roomId:0,x:6,z:6,w:1,d:4,height:2.8}];
  const start={x:2,z:6},end={x:10,z:6},initial=query.path(start,end,state);
  expect(initial.length).toBeGreaterThan(1);
  // The fixed wall forces the first call to populate the grid. Put the new solid on that actual route.
  const bend=initial[0];
  const decoration={...cabinet(),x:bend.x,z:bend.z,w:1,d:1};
  world.decorationColliders=[decoration];
  const assertSafeRoute=(route:Vec2[])=>{
   expect(route.length).toBeGreaterThan(1);
   let previous=start;
   for(const point of route){
    expect(segmentRect(previous,point,decoration,.3-1e-6)).toBe(false);
    previous=point;
   }
  };
  const rerouted=query.path(start,end,state);
  assertSafeRoute(rerouted);
  expect(rerouted).not.toEqual(initial);
  expect(rerouted).toEqual(makeWorldQuery(world).path(start,end,state));
  // In-place mutation keeps array identity and length: the snapshot must still invalidate.
  decoration.x=rerouted[0].x;decoration.z=rerouted[0].z;
  const moved=query.path(start,end,state);
  assertSafeRoute(moved);
  expect(moved).toEqual(makeWorldQuery(world).path(start,end,state));
  world.decorationColliders=[];
  expect(query.path(start,end,state)).toEqual(initial);
 });

 it('stops a camera sweep at the same cabinet and permits a clear sweep above it',()=>{
  const {world,state}=emptyOffice();world.decorationColliders=[cabinet()];
  const focus={x:3,y:1,z:6},desired={x:9,y:1,z:6};
  const stopped=resolveCamera(world,state,focus,desired);
  expect(stopped.x).toBeGreaterThan(4.7);
  expect(stopped.x).toBeLessThan(4.86);
  expect(resolveCamera(world,state,{...focus,y:1.4},{...desired,y:1.4})).toEqual({...desired,y:1.4});
 });
});
