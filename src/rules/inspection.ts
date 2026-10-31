import type { ActiveRule, GameState, Vec2, WorldDef, WorldQuery } from '../contracts/game';
import { announceMessage, copyPoint, distance, logEvent, runtimeFor } from './runtime';
import { deskWorkingPoint } from '../world/workstations';

export const INSPECTION_SEARCH_SPEED=7.2;
export const INSPECTION_SEARCH_DURATION=24;
const LOOK_SWEEP=40*Math.PI/180;

function pathLength(start:Vec2,points:Vec2[]):number {
  return points.reduce((sum,point,index)=>sum+distance(index?points[index-1]:start,point),0);
}

export function inspectionCompliant(state:GameState,world:WorldDef):boolean {
  const home=world.desks.find(desk=>desk.home),player=state.player;
  if(!home||player.pose!=='working'||distance(player,deskWorkingPoint(home))>.65)return false;
  if((player.workstationId??runtimeFor(state).workingDesk)!==home.id)return false;
  // The sticky-chair contradiction is an intentional player loophole. A borrowed
  // workstation never satisfies the home check, even if it looks like office work.
  return (state.deskHeights[home.id]??.75)<=.85||player.sticky||player.workStance==='chair-standing';
}

export function beginInspection(state:GameState,rule:ActiveRule,world:WorldDef,query:WorldQuery):boolean {
  const home=world.desks.find(desk=>desk.home);
  if(!home||state.inspection)return false;
  const playerRoute=query.path(state.player,home.seat,state),bossRoute=query.path(state.boss,home.seat,state);
  // Reject an impossible inspection instead of inventing a deadline or teleport.
  if(!playerRoute.length||!bossRoute.length)return false;
  const playerSpeed=state.player.sticky?3.6:3.1;
  const returnTime=Math.max(8,pathLength(state.player,playerRoute)/playerSpeed+5,pathLength(state.boss,bossRoute)/2+2);
  state.inspection={id:rule.id,ruleId:rule.id,phase:'notice',homeDeskId:home.id,
    returnBy:state.elapsed+3+returnTime,checkFor:0,searchUntil:0,scanYaw:state.boss.yaw,lastKnown:null};
  const runtime=runtimeFor(state);
  runtime.inspectionSearchPoints=[];runtime.inspectionSearchIndex=0;runtime.inspectionPauseUntil=0;
  runtime.nextPathAt=0;runtime.patrolInspection=null;
  state.boss.mode='inspection';state.boss.path=[];state.boss.contactFor=0;
  state.boss.lookYaw=state.boss.yaw;
  if(rule.kind==='desk')rule.duration=Math.max(rule.duration,returnTime+4);
  rule.effect+=` · ${Math.ceil(3+returnTime)}秒内回本人工位，领导随后到场检查`;
  announceMessage(state,'宣布新规后检查工位：回自己的电脑前装忙。',4);
  logEvent(state,`inspection:announced:${rule.kind}`);
  return true;
}

export function cancelInspection(state:GameState,ruleId?:number):void {
  if(!state.inspection||(ruleId!==undefined&&state.inspection.ruleId!==ruleId))return;
  state.inspection=null;
  if(state.boss.mode==='inspection'||state.boss.mode==='alert')state.boss.mode='patrol';
  state.boss.lookYaw=state.boss.yaw;
  const runtime=runtimeFor(state);
  runtime.inspectionSearchPoints=[];runtime.nextPathAt=0;
}

interface InspectionControls {
  seesPlayer():boolean;
  move(target:Vec2,speed:number):boolean;
  capture():boolean;
  inspectLights():boolean;
}

function searchPoints(state:GameState,world:WorldDef,query:WorldQuery):Vec2[] {
  const inspection=state.inspection!;
  const origin=inspection.lastKnown??world.desks.find(d=>d.home)!.seat;
  const room=query.roomAt(origin);
  // Search the remembered room's exits, then plausible cover. No hidden player
  // coordinates are used after the last actual sighting.
  const candidates=[origin,
    ...world.doors.filter(door=>door.a===room?.id||door.b===room?.id),
    ...world.props.filter(prop=>prop.roomId===room?.id).map(prop=>({x:prop.x+1.5,z:prop.z})),
    ...world.patrol.slice(0,4)];
  return candidates.filter((point,index)=>candidates.findIndex(p=>distance(p,point)<.5)===index
    &&query.path(state.boss,point,state).length>0).map(copyPoint);
}

function startSearch(state:GameState,world:WorldDef,query:WorldQuery):void {
  const inspection=state.inspection!,runtime=runtimeFor(state);
  inspection.phase='search';inspection.searchUntil=state.elapsed+INSPECTION_SEARCH_DURATION;
  inspection.scanYaw=state.boss.yaw;inspection.checkFor=0;
  state.boss.mode='search';state.boss.searchUntil=inspection.searchUntil;state.boss.contactFor=0;
  state.boss.lastSeen=inspection.lastKnown&&copyPoint(inspection.lastKnown);
  runtime.inspectionSearchPoints=searchPoints(state,world,query);runtime.inspectionSearchIndex=0;
  runtime.inspectionPauseUntil=state.elapsed+.5;runtime.nextPathAt=0;
  announceMessage(state,'工位没人！领导开始限时搜查；可借掩体、暗室或回本人工位应对。',4);
  logEvent(state,'inspection:empty-search');
}

function finish(state:GameState,passed:boolean):void {
  logEvent(state,passed?'inspection:passed':'inspection:search-ended');
  if(passed)announceMessage(state,state.player.sticky?'检查通过：屁股没离椅子，滚回工位也算遵守。':'检查通过，领导暂时离开了。',3);
  state.boss.mode='patrol';state.boss.path=[];state.boss.lastSeen=null;state.boss.contactFor=0;
  cancelInspection(state);
}

/** Owns this single inspection until it resolves; ordinary patrol cannot stack an order on it. */
export function updateInspection(state:GameState,dt:number,world:WorldDef,query:WorldQuery,controls:InspectionControls):boolean {
  const inspection=state.inspection;
  if(!inspection)return false;
  const home=world.desks.find(d=>d.id===inspection.homeDeskId);
  if(!home){cancelInspection(state);return false;}
  const boss=state.boss,runtime=runtimeFor(state);
  if(state.player.pose==='dragged'){cancelInspection(state);return false;}
  if(inspection.phase==='notice') {
    boss.lookYaw=boss.yaw;
    if(state.rules.some(rule=>rule.id===inspection.ruleId&&rule.phase==='warning'))return true;
    inspection.phase='approach';runtime.nextPathAt=0;
  }
  if(inspection.phase==='approach'||inspection.phase==='checking') {
    if(controls.inspectLights())return true;
    if(controls.seesPlayer())inspection.lastKnown=copyPoint(state.player);
    const close=distance(boss,home.seat)<=1.8&&query.lineOfSight(boss,home.seat,1.1,state,'solid');
    if(!close) {
      controls.move(home.seat,2);boss.lookYaw=boss.yaw;
      inspection.phase='approach';inspection.checkFor=0;
      if(state.elapsed>inspection.returnBy+20) {
        announceMessage(state,'检查路线暂时受阻，本轮检查取消。',3);
        logEvent(state,'inspection:route-blocked');cancelInspection(state);
      }
      return true;
    }
    if(inspection.phase!=='checking')logEvent(state,'inspection:arrived');
    inspection.phase='checking';boss.yaw=Math.atan2(home.seat.x-boss.x,home.seat.z-boss.z);boss.lookYaw=boss.yaw;
    if(inspectionCompliant(state,world)) {
      inspection.checkFor+=dt;
      if(inspection.checkFor>=1)finish(state,true);
    } else {
      inspection.checkFor=0;
      if(state.elapsed>=inspection.returnBy)startSearch(state,world,query);
    }
    return true;
  }
  if(inspection.phase==='alert') {
    boss.mode='alert';boss.lookYaw=boss.yaw+Math.sin((state.elapsed-inspection.searchUntil)*2)*LOOK_SWEEP;
    if(state.elapsed>=inspection.searchUntil+3)finish(state,false);
    return true;
  }
  boss.lookYaw=boss.yaw+Math.sin(state.elapsed*2.2)*LOOK_SWEEP;
  const sees=controls.seesPlayer();
  if(sees) {
    inspection.lastKnown=copyPoint(state.player);boss.lastSeen=copyPoint(state.player);
    if(inspectionCompliant(state,world)) {
      inspection.checkFor+=dt;boss.contactFor=0;
      if(inspection.checkFor>=2)finish(state,true);
      return true;
    }
    inspection.checkFor=0;boss.mode='chase';boss.lookYaw=boss.yaw;
    if(distance(boss,state.player)>1||!query.lineOfSight(boss,state.player,1.1+state.player.y,state,'solid'))controls.move(state.player,4.1);
    else boss.yaw=Math.atan2(state.player.x-boss.x,state.player.z-boss.z);
    if(state.player.protection<=0&&distance(boss,state.player)<=1.1&&query.lineOfSight(boss,state.player,1.1+state.player.y,state,'solid'))boss.contactFor+=dt;
    else boss.contactFor=0;
    if(boss.contactFor>=.5&&controls.capture())cancelInspection(state);
    return true;
  }
  boss.contactFor=0;inspection.checkFor=0;
  if(state.elapsed>=inspection.searchUntil) {
    inspection.phase='alert';boss.mode='alert';boss.path=[];
    return true;
  }
  if(boss.mode==='chase') {
    runtime.inspectionSearchPoints=searchPoints(state,world,query);runtime.inspectionSearchIndex=0;runtime.nextPathAt=0;
  }
  boss.mode='search';
  if(controls.inspectLights())return true;
  if(state.elapsed<runtime.inspectionPauseUntil)return true;
  const target=runtime.inspectionSearchPoints[runtime.inspectionSearchIndex];
  if(target&&controls.move(target,INSPECTION_SEARCH_SPEED)) {
    runtime.inspectionSearchIndex=(runtime.inspectionSearchIndex+1)%runtime.inspectionSearchPoints.length;
    runtime.inspectionPauseUntil=state.elapsed+.6;runtime.nextPathAt=0;
  }
  return true;
}
