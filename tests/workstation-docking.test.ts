import { describe, expect, it } from 'vitest';
import type { InputFrame } from '../src/contracts/game';
import { updateDrag } from '../src/rules/boss';
import { createGame } from '../src/rules/game';
import { inspectionCompliant } from '../src/rules/inspection';
import { updateInteraction, updatePlayer } from '../src/rules/player';
import { runtimeFor } from '../src/rules/runtime';
import { generateWorld } from '../src/world/generate';
import { makeWorldQuery } from '../src/world/query';
import { deskWorkingPoint } from '../src/world/workstations';

const idle:InputFrame={moveX:0,moveZ:0,yaw:0,sprint:false,crouchPressed:false,jumpPressed:false,interact:false,interactPressed:false,potPressed:false,dropPressed:false,throwPressed:false,aim:false};
const distance=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);

function fixture(seed=618) {
  const world=generateWorld(seed),state=createGame(world),query=makeWorldQuery(world);
  const home=world.desks.find(desk=>desk.home)!;
  return {world,state,query,home,point:deskWorkingPoint(home)};
}

describe('authoritative workstation docking',()=>{
  it('keeps clear navigation anchors while aligning every occupied chair with its mirrored desk',()=>{
    for(const seed of [1,2,3,42,618,777]) {
      const {world,state,home,point}=fixture(seed);
      expect(world.spawn).toEqual(home.seat);
      expect(distance(home,home.seat)).toBeCloseTo(1.4);
      expect(distance(state.player,point)).toBe(0);
      for(const desk of world.desks) {
        const chair=deskWorkingPoint(desk);
        expect(desk.x-chair.x).toBeCloseTo(Math.sin(desk.yaw)*.79);
        expect(desk.z-chair.z).toBeCloseTo(Math.cos(desk.yaw)*.79);
        expect(distance(chair,desk.seat)).toBeGreaterThan(.4);
      }
      for(const colleague of state.colleagues) {
        const desk=world.desks.find(item=>item.id===colleague.deskId)!;
        expect(distance(colleague,deskWorkingPoint(desk))).toBe(0);
      }
    }
  });

  it.each([1,2,42,618])('lets E stand up and move away from the real chair without sticking to the table (seed %s)',seed=>{
    const {world,state,query,home,point}=fixture(seed);
    updateInteraction(state,{...idle,yaw:home.yaw,interact:true,interactPressed:true},1/60,world,query);
    expect(state.player.pose).toBe('standing');
    expect(state.player.workstationId).toBeNull();
    for(let i=0;i<20;i++)updatePlayer(state,{...idle,yaw:home.yaw,moveZ:-1},1/60,world,query);
    expect(distance(state.player,point)).toBeGreaterThan(.9);
    expect(state.player.moving).toBe(true);
    const continued=query.move(state.player,{x:-Math.sin(home.yaw)*.1,z:-Math.cos(home.yaw)*.1},.3,1.75,state);
    expect(distance(continued,state.player)).toBeCloseTo(.1);
  });

  it.each([false,true])('uses the real E interaction to dock and pass raised-desk inspection (sticky %s)',sticky=>{
    const {world,state,query,home,point}=fixture();
    state.deskHeights[home.id]=1.9;
    Object.assign(state.player,{...home.seat,pose:sticky?'rolling':'standing',sticky,yaw:home.yaw,workstationId:null});
    runtimeFor(state).workingDesk=null;
    updateInteraction(state,{...idle,yaw:home.yaw,interact:true,interactPressed:true},1/60,world,query);
    expect(state.player).toMatchObject({pose:'working',workstationId:home.id,workStance:sticky?'seated':'chair-standing',y:sticky?0:.55});
    expect(distance(state.player,point)).toBe(0);
    expect(inspectionCompliant(state,world)).toBe(true);
    state.player.workstationId='borrowed';
    expect(inspectionCompliant(state,world)).toBe(false);
  });

  it('keeps collision-checked chair routes from the actual working position to every required objective',()=>{
    for(const seed of [1,2,42,618]) {
      const {world,state,query,point}=fixture(seed);
      state.player.sticky=true;
      for(const target of [...world.stations,...world.exits]) {
        const path=query.path(point,target,state);
        expect(path.length,`${seed} ${target.id}`).toBeGreaterThan(0);
        let previous={...point};
        for(const next of path) {
          const moved=query.move(previous,{x:next.x-previous.x,z:next.z-previous.z},.3,1.42,state);
          expect(distance(moved,next),`${seed} ${target.id}`).toBeLessThan(.01);
          previous=moved;
        }
      }
    }
  },30_000);

  it('finishes a capture at the occupied chair and permits rolling away again',()=>{
    const {world,state,query,home,point}=fixture();
    Object.assign(state.player,{...home.seat,pose:'dragged',workstationId:null});
    runtimeFor(state).dragElapsed=2;
    updateDrag(state,.02,world,query);
    expect(state.catches).toBe(1);
    expect(state.player).toMatchObject({pose:'working',sticky:true,yaw:home.yaw,workstationId:home.id});
    expect(distance(state.player,point)).toBeLessThan(.01);
    for(let i=0;i<20;i++)updatePlayer(state,{...idle,yaw:home.yaw,moveZ:-1},1/60,world,query);
    expect(state.player.pose).toBe('rolling');
    expect(distance(state.player,point)).toBeGreaterThan(1);
  });

  it('does not dock through a newly obstructed approach',()=>{
    const {world,state,home,point}=fixture();
    world.walls.push({id:'blocked-chair',roomId:home.roomId,x:(home.seat.x+point.x)/2,z:(home.seat.z+point.z)/2,w:1.6,d:.05,height:2.8});
    const query=makeWorldQuery(world);
    Object.assign(state.player,{...home.seat,pose:'standing',workstationId:null});
    runtimeFor(state).workingDesk=null;
    updateInteraction(state,{...idle,yaw:home.yaw,interact:true,interactPressed:true},1/60,world,query);
    expect(state.player.pose).toBe('standing');
    expect(distance(state.player,home.seat)).toBe(0);
    expect(inspectionCompliant(state,world)).toBe(false);
  });

  it('retains one-anchor compatibility for small authored rule fixtures',()=>{
    const desk={id:'fixture',roomId:0,x:4,z:4,yaw:0,seat:{x:4,z:2.8}};
    expect(deskWorkingPoint(desk)).toBe(desk.seat);
  });
});
