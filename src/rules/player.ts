import type { GameState, InputFrame, Interaction, Vec2, WorldDef, WorldQuery } from '../contracts/game';
import { announceMessage, clamp, copyPoint, distance, explicitAction, flowFactor, forward, logEvent, playerHeight, runtimeFor } from './runtime';
import { dropHeld } from './objects';

export function litAt(state: GameState, point: Vec2, query: WorldQuery): boolean {
  const room = query.roomAt(point);
  return !room || room.permanentLight || state.lights[room.id] !== false;
}

function clearance(state: GameState, query: WorldQuery): number {
  const reported=query.clearance(state.player,state);
  const ceiling=reported<=state.player.y+.08?Infinity:reported;
  const pressure=state.pressureRooms.includes(state.roomId)?(state.pressureHeights[state.roomId]??1.6):Infinity;
  return Math.min(ceiling,pressure)-state.player.y;
}

function updateLanding(state:GameState,query:WorldQuery,previousY:number):void {
  const player=state.player;
  const surface=query.supportHeight(player,state);
  // A surface can only catch a descending character from above. Never pop up through a desk.
  const floor=previousY>=surface-.025?surface:0;
  if(player.vy<=0&&player.y<=floor){player.y=floor;player.vy=0;}
}

export function updatePlayer(state: GameState, input: InputFrame, dt: number, world: WorldDef, query: WorldQuery): void {
  const player=state.player,runtime=runtimeFor(state);
  player.moving=false;player.sprinting=false;
  player.protection=Math.max(0,player.protection-dt);
  if(player.pose==='dragged')return;
  player.yaw=input.yaw;
  state.aiming=input.aim;
  const room=query.roomAt(player);
  state.roomId=room?.id??state.roomId;
  state.dark=!litAt(state,player,query);
  const overhead=clearance(state,query);
  const previousY=player.y;
  const support=query.supportHeight(player,state);
  const grounded=player.y<=.001||(Math.abs(player.y-support)<.001&&player.vy<=0);
  if(input.crouchPressed) {
    if(player.sticky)announceMessage(state,'屁股粘在椅子上了，不能蹲。轮子还能走。');
    else if(player.pose!=='working') {
      if(player.crouchIntent&&overhead<1.8)announceMessage(state,'上方空间不足，先低头出去。');
      else player.crouchIntent=!player.crouchIntent;
    }
  }
  if(player.pose!=='working') {
    player.pose=player.sticky?'rolling':(player.crouchIntent||overhead<1.8?'crouching':'standing');
  }
  if(input.jumpPressed) {
    if(player.sticky)announceMessage(state,'连人带椅，不能跳。主通道都可以滑过去。');
    else if(player.pose==='standing'&&grounded&&overhead>2.5)player.vy=Math.sqrt(2*12*.65);
  }
  if(!grounded||player.vy>0) {
    player.vy-=12*dt;
    player.y=Math.max(0,player.y+player.vy*dt);
    if(player.y<=0)player.vy=0;
  }
  let localX=input.moveX, localZ=input.moveZ;
  const length=Math.hypot(localX,localZ);
  if(length>1){localX/=length;localZ/=length;}
  if(player.pose==='working'&&player.sticky&&length>.05) {
    player.pose='rolling';runtimeFor(state).workingDesk=null;
  }
  if(player.pose==='working'||length<.01) {
    player.stamina=Math.min(4,player.stamina+dt*.5);
    updateLanding(state,query,previousY);
    return;
  }
  const direction={x:-localX*Math.cos(input.yaw)+localZ*Math.sin(input.yaw),z:localX*Math.sin(input.yaw)+localZ*Math.cos(input.yaw)};
  if(runtime.sprintExhausted&&player.stamina>=1)runtime.sprintExhausted=false;
  player.sprinting=input.sprint&&player.stamina>0&&!runtime.sprintExhausted&&player.pose!=='crouching';
  let speed=player.pose==='rolling'?(player.sprinting?4.4:3.6):player.pose==='crouching'?1.6:player.sprinting?4.8:3.1;
  if(player.sprinting){player.stamina=Math.max(0,player.stamina-dt);if(player.stamina<=0)runtime.sprintExhausted=true;}
  else player.stamina=Math.min(4,player.stamina+dt*.5);
  if(player.potId)speed*=.85;
  speed*=flowFactor(state,player,direction,state.roomId,world.rooms);
  speed=Math.max(1.3,speed);
  const before=copyPoint(player);
  const next=query.move(player,{x:direction.x*speed*dt,z:direction.z*speed*dt},.3,playerHeight(state),state,player.y);
  player.x=next.x;player.z=next.z;
  updateLanding(state,query,previousY);
  player.moving=distance(before,player)>.0001;
  state.roomId=query.roomAt(player)?.id??state.roomId;
  state.dark=!litAt(state,player,query);
}

interface Candidate extends Interaction { point: Vec2; roomId?: number; priority: number }

function candidates(state: GameState, world: WorldDef): Candidate[] {
  const player=state.player;
  if(player.pose==='working') return [{id:'stand',kind:'stand',label:player.sticky?'E 离开工位 · 椅子仍粘住':'E 起身 · 下班得自己找路',duration:0,progress:0,point:player,priority:100}];
  const result:Candidate[]=[];
  for(const station of world.stations)result.push({id:station.id,kind:'clock',label:state.clocked?'已完成下班打卡 · 找出口':`按住 E 打卡 1.5秒${player.protection>0?' · 将结束抓回保护':''}`,duration:1.5,progress:0,point:station,roomId:station.roomId,priority:8});
  for(const exit of world.exits)result.push({id:exit.id,kind:'exit',label:state.openedExits.includes(exit.id)?'门已打开 · 走出去下班':state.clocked?`按住 E 开门 4秒${player.protection>0?' · 将结束抓回保护':''}`:'未完成下班打卡 · 先找到打卡机',duration:4,progress:0,point:exit,roomId:exit.roomId,priority:8});
  for(const room of world.rooms)if(!room.permanentLight)result.push({id:`light-${room.id}`,kind:'light',label:(state.switchCooldown[room.id]??0)>0?`开关复位中 · ${Math.ceil(state.switchCooldown[room.id])}秒`:`按住 E ${state.lights[room.id]?'关灯 · 暗室不能抓人':'开灯'} · 0.25秒`,duration:.25,progress:0,point:room.switch,roomId:room.id,priority:6});
  for(const prop of state.props)if(!prop.held&&!runtimeFor(state).propFlights.has(prop.id))result.push({id:prop.id,kind:prop.large?'push':'prop',label:prop.large?'按住 E 推动大饼 · WASD 选择方向':`E 拿起${prop.kind==='cake'?'小饼':'纸箱'}`,duration:0,progress:0,point:prop,roomId:prop.roomId,priority:4});
  for(const desk of world.desks) {
    if(state.colleagues.some(c=>c.deskId===desk.id))continue;
    const raised=(state.deskHeights[desk.id]??.75)>.85;
    result.push({id:desk.id,kind:'sit',label:raised?'电脑被抬高，暂时无法装忙':player.sticky?'E 靠近电脑装忙 · 仍粘在椅子上':'E 坐下装忙',duration:0,progress:0,point:desk.seat,roomId:desk.roomId,priority:2});
  }
  return result;
}

function canInteract(state:GameState,candidate:Candidate,query:WorldQuery,requireFacing:boolean):boolean {
  if(candidate.kind==='stand')return true;
  const dist=distance(state.player,candidate.point);
  const range=candidate.kind==='push'?1.45:1.2;
  if(dist>range)return false;
  const room=query.roomAt(state.player);
  if(candidate.roomId!==undefined&&room?.id!==candidate.roomId)return false;
  if((candidate.kind==='clock'||candidate.kind==='exit')&&!litAt(state,state.player,query))return false;
  const direction=forward(state.player.yaw);
  if(requireFacing&&dist>.2&&((candidate.point.x-state.player.x)*direction.x+(candidate.point.z-state.player.z)*direction.z)/dist<.1)return false;
  return query.lineOfSight(state.player,candidate.point,(candidate.kind==='prop'||candidate.kind==='push')?1.3:1.1,state,'solid');
}

function cancelInteraction(state:GameState):void {
  const runtime=runtimeFor(state);
  if(runtime.explicitEvent&&['clock','exit'].includes(runtime.explicitEvent.kind))runtime.explicitEvent=null;
  runtime.interactionElapsed=0;runtime.interactionId='';
}

export function updateInteraction(state:GameState,input:InputFrame,dt:number,world:WorldDef,query:WorldQuery):void {
  const runtime=runtimeFor(state),player=state.player;
  if(player.pose==='dragged'){state.interaction=null;cancelInteraction(state);return;}
  const choices=candidates(state,world);
  const continuing=input.interact&&runtime.interactionId&&choices.find(c=>c.id===runtime.interactionId&&canInteract(state,c,query,false));
  const current=continuing||choices.filter(c=>canInteract(state,c,query,true)).sort((a,b)=>distance(player,a.point)-distance(player,b.point)||(b.priority-a.priority))[0];
  if(!input.interact){runtime.interactionLatched=false;cancelInteraction(state);}
  if(!current){state.interaction=null;cancelInteraction(state);return;}
  state.interaction={id:current.id,kind:current.kind,label:current.label,duration:current.duration,progress:0};
  if(!input.interact&&!input.interactPressed)return;
  if(runtime.interactionLatched)return;
  if(current.kind==='stand') {
    if(input.interactPressed) {
      player.pose=player.sticky?'rolling':'standing';runtime.workingDesk=null;
      runtime.interactionLatched=true;logEvent(state,'player:left-desk');
    }
    return;
  }
  if(current.kind==='sit') {
    if(!input.interactPressed)return;
    if((state.deskHeights[current.id]??.75)>.85){announceMessage(state,'提高优先级：先换个工位，或等桌子降下来。');return;}
    player.x=current.point.x;player.z=current.point.z;player.y=0;player.vy=0;player.pose='working';
    runtime.workingDesk=current.id;runtime.interactionLatched=true;cancelInteraction(state);
    logEvent(state,`player:working:${current.id}`);return;
  }
  if(current.kind==='prop') {
    if(!input.interactPressed)return;
    if(state.pots.some(pot=>pot.owner==='player'&&(pot.phase==='held'||pot.phase==='drawing'))){announceMessage(state,'先按 Q 把锅归位，再拿小物件。');return;}
    if(player.holding&&!dropHeld(state,world,query))return;
    const prop=state.props.find(p=>p.id===current.id)!;
    prop.held=true;player.holding=prop.id;runtime.interactionLatched=true;
    logEvent(state,`prop:picked:${prop.id}`);return;
  }
  if(current.kind==='push') {
    const prop=state.props.find(p=>p.id===current.id)!;
    let direction=forward(player.yaw);
    if(Math.hypot(input.moveX,input.moveZ)>.1) {
      direction={x:-input.moveX*Math.cos(input.yaw)+input.moveZ*Math.sin(input.yaw),z:input.moveX*Math.sin(input.yaw)+input.moveZ*Math.cos(input.yaw)};
      const length=Math.hypot(direction.x,direction.z);direction.x/=length;direction.z/=length;
    }
    const next={x:prop.x+direction.x*1.5*dt,z:prop.z+direction.z*1.5*dt};
    const home=world.desks.find(d=>d.home)?.seat??world.spawn;
    const oldHeld=prop.held;prop.held=true;
    const valid=distance(next,home)>1.9&&!world.doors.some(d=>distance(d,next)<1.65)&&!world.exits.some(e=>distance(e,next)<2)
      &&query.validPlacement(next,.9,state)&&distance(next,state.boss)>1.25&&!state.colleagues.some(c=>distance(c,next)<1.25);
    prop.held=oldHeld;
    if(valid){prop.x=next.x;prop.z=next.z;prop.roomId=query.roomAt(prop)?.id??prop.roomId;}
    else announceMessage(state,'大饼不能堵住门、椅位或挤住人。',1);
    return;
  }
  if(player.moving||Math.hypot(input.moveX,input.moveZ)>.05){cancelInteraction(state);return;}
  if(current.kind==='clock'&&state.clocked)return;
  if(current.kind==='exit'&&state.openedExits.includes(current.id))return;
  if(current.kind==='exit'&&!state.clocked){announceMessage(state,'下班要先打卡。工牌在身上，找任意一台打卡机。');return;}
  if(current.kind==='light'&&(state.switchCooldown[current.roomId!]??0)>0)return;
  if(runtime.interactionId!==current.id) {
    runtime.interactionId=current.id;runtime.interactionElapsed=0;
    if(current.kind==='clock'||current.kind==='exit')explicitAction(state,current.kind,current.duration+1.4);
  }
  runtime.interactionElapsed+=dt;
  state.interaction.progress=clamp(runtime.interactionElapsed/current.duration,0,1);
  if(runtime.interactionElapsed+1e-6<current.duration)return;
  runtime.interactionLatched=true;
  if(current.kind==='clock') {
    state.clocked=true;announceMessage(state,'打卡成功。记录永久保留，现在找出口。',4);logEvent(state,'objective:clocked');
  } else if(current.kind==='exit') {
    state.openedExits.push(current.id);announceMessage(state,'门已打开。走过门外边界，才能真正下班。',4);logEvent(state,`exit:opened:${current.id}`);
  } else if(current.kind==='light') {
    const id=current.roomId!;state.lights[id]=!state.lights[id];state.switchCooldown[id]=4;
    state.dark=!litAt(state,player,query);
    announceMessage(state,state.lights[id]?'灯亮了，抓捕仍需视线和近距离接触。':'灯灭了 · 暗室保护。应急前室仍然常亮。');logEvent(state,`light:${id}:${state.lights[id]}`);
  }
  cancelInteraction(state);
}

export function checkEscape(state:GameState,world:WorldDef):void {
  if(!state.clocked||state.ending||state.player.pose==='dragged')return;
  for(const exit of world.exits) {
    if(!state.openedExits.includes(exit.id))continue;
    const dx=state.player.x-exit.x,dz=state.player.z-exit.z;
    const outward=dx*exit.outward.x+dz*exit.outward.z;
    const across=Math.abs(dx*exit.outward.z-dz*exit.outward.x);
    if(outward>.75&&across<1.5){state.ending='escaped';logEvent(state,`ending:escaped:${exit.id}`);break;}
  }
}
