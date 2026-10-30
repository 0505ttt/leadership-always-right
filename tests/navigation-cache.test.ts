import { describe, expect, it } from 'vitest';
import type { WorldDef } from '../src/contracts/game';
import { createGame } from '../src/rules/game';
import { makeWorldQuery } from '../src/world/query';

function corridor(gap:number) {
 const world:WorldDef={seed:618,rooms:[{id:0,name:'导航测试',kind:'work',x:6,z:5,w:12,d:10,lit:true,permanentLight:false,switch:{x:1,z:1},pressure:false}],walls:[{id:'divider',roomId:0,x:6,z:(gap+10)/2,w:.2,d:10-gap,height:2.8}],doors:[],desks:[{id:'home',roomId:0,x:2,z:8,seat:{x:2,z:7},yaw:0,home:true}],stations:[],exits:[],props:[],colleagues:[],spawn:{x:2,z:5},bossSpawn:{x:10,z:5},patrol:[],width:12,depth:10,validation:[]};
 return world;
}

// Each scenario warms the same query, changes live obstacles, and checks that a route closes/reopens.
describe('navigation occupancy follows live geometry',()=>{
 it('invalidates when a cake grows and shrinks across the only passage',()=>{
  const world=corridor(2.2);world.props=[{id:'cake',kind:'cake',roomId:0,x:6,z:1.1}];
  const state=createGame(world),query=makeWorldQuery(world),route=()=>query.path(world.spawn,world.bossSpawn,state);
  expect(route().length).toBeGreaterThan(0);
  state.props[0].scale=3;expect(route()).toEqual([]);
  state.props[0].scale=1;expect(route().length).toBeGreaterThan(0);
 });
 it('invalidates a moved, carried or airborne box without waiting for a new state object',()=>{
  const world=corridor(1.1);world.props=[{id:'box',kind:'box',roomId:0,x:8,z:.55}];
  const state=createGame(world),query=makeWorldQuery(world),route=()=>query.path(world.spawn,world.bossSpawn,state);
  expect(route().length).toBeGreaterThan(0);
  const box=state.props[0];box.x=6;expect(route()).toEqual([]);
  box.held=true;expect(route().length).toBeGreaterThan(0);
  box.held=false;expect(route()).toEqual([]);
  box.y=.4;expect(route().length).toBeGreaterThan(0);
  box.y=0;expect(route()).toEqual([]);
 });
 it('reopens a passage beneath a raised desk and blocks it on restoration',()=>{
  const world=corridor(1.1);world.desks.push({id:'raised',roomId:0,x:6,z:.55,seat:{x:6,z:1.8},yaw:0});
  const state=createGame(world),query=makeWorldQuery(world),route=()=>query.path(world.spawn,world.bossSpawn,state);
  expect(route()).toEqual([]);
  state.deskHeights.raised=1.9;expect(route().length).toBeGreaterThan(0);
  state.deskHeights.raised=.75;expect(route()).toEqual([]);
 });
 it('observes opening and closing exit geometry immediately',()=>{
  const world=corridor(2.2);world.exits=[{id:'gate',roomId:0,x:5.35,z:1.1,yaw:Math.PI/2,outward:{x:1,z:0}}];
  const state=createGame(world),query=makeWorldQuery(world),route=()=>query.path(world.spawn,world.bossSpawn,state);
  expect(route()).toEqual([]);
  state.openedExits.push('gate');expect(route().length).toBeGreaterThan(0);
  state.openedExits=[];expect(route()).toEqual([]);
 });
 it('does not retain mutable wall references as its geometry snapshot',()=>{
  const world=corridor(2.2),state=createGame(world),query=makeWorldQuery(world),route=()=>query.path(world.spawn,world.bossSpawn,state);
  expect(route().length).toBeGreaterThan(0);
  Object.assign(world.walls[0],{z:5,d:10});expect(route()).toEqual([]);
  Object.assign(world.walls[0],{z:6.1,d:7.8});expect(route().length).toBeGreaterThan(0);
 });
});
