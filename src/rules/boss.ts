import type { GameState, Vec2, WorldDef, WorldQuery } from '../contracts/game';
import { announceMessage, copyPoint, distance, flowFactor, forward, logEvent, playerSightHeight, runtimeFor } from './runtime';
import { litAt } from './player';
import { dropHeld, settlePotForCapture } from './objects';

export function visible(state:GameState,observer:Vec2&{yaw:number},target:Vec2,range:number,height:number,query:WorldQuery):boolean {
  const length=distance(observer,target);
  if(length>range||!litAt(state,target,query))return false;
  const look=forward(observer.yaw);
  if(length>.1&&((target.x-observer.x)*look.x+(target.z-observer.z)*look.z)/length<Math.cos(50*Math.PI/180))return false;
  return query.lineOfSight(observer,target,height,state);
}

function clearOrder(state:GameState):void {
  const runtime=runtimeFor(state);
  runtime.orderActive=false;runtime.pendingReturn=false;runtime.workCalm=0;
  state.boss.seenFor=0;state.boss.contactFor=0;
  state.rules=state.rules.filter(rule=>rule.kind!=='return'||(state.player.sticky&&rule.phase==='active'));
  if(state.player.sticky){
    const rule=state.rules.find(item=>item.kind==='return'&&item.phase==='active');
    if(rule){rule.effect='屁股粘椅 · 本局持续 · 可滑行、打卡、开门';rule.remaining=Infinity;}
  }
}

export function requestReturnWarning(state:GameState):void {
  const runtime=runtimeFor(state);
  if(runtime.orderActive||state.rules.some(rule=>rule.kind==='return'&&rule.phase==='warning'))return;
  if(state.rules.some(rule=>rule.phase==='warning')){runtime.pendingReturn=true;return;}
  const rule={id:runtime.nextRuleId++,kind:'return' as const,quote:'让我逮着，就回工位，屁股给我粘在椅子上。',effect:'3秒后追责 · 亮处接触0.5秒才会被抓',targetId:'player',roomId:state.roomId,phase:'warning' as const,remaining:3,duration:0,age:0};
  state.rules.push(rule);runtime.rules.set(rule.id,{warnedForEvidence:state.boss.evidenceUntil>state.elapsed});
  runtime.pendingReturn=false;state.boss.mode='warning';
  state.history.unshift(rule.quote);state.history=state.history.slice(0,30);
  logEvent(state,'boss:warning');
}

function moveBoss(state:GameState,target:Vec2,speed:number,dt:number,world:WorldDef,query:WorldQuery):boolean {
  const boss=state.boss,runtime=runtimeFor(state);
  if(!runtime.navTarget||distance(runtime.navTarget,target)>.65||state.elapsed>=runtime.nextPathAt||!boss.path.length) {
    boss.path=query.path(boss,target,state).map(copyPoint);
    runtime.navTarget=copyPoint(target);runtime.nextPathAt=state.elapsed+.65;
  }
  while(boss.path.length&&distance(boss,boss.path[0])<.25)boss.path.shift();
  const point=boss.path[0];
  if(!point)return distance(boss,target)<.7;
  const dx=point.x-boss.x,dz=point.z-boss.z,length=Math.hypot(dx,dz);
  if(length<.001)return true;
  const direction={x:dx/length,z:dz/length};
  boss.yaw=Math.atan2(direction.x,direction.z);
  const room=query.roomAt(boss);
  const low=room&&state.pressureRooms.includes(room.id);
  if(low)speed=Math.min(speed,1.6);
  speed=Math.max(1.3,speed*flowFactor(state,boss,direction,room?.id??-1,world.rooms));
  // Environment announcements deliberately slow the leader below the ordinary movement floor.
  if(state.rules.some(rule=>rule.kind!=='return'&&rule.phase==='warning'))speed=Math.min(speed,1.2);
  const amount=Math.min(length,speed*dt),before=copyPoint(boss);
  const moved=query.move(boss,{x:direction.x*amount,z:direction.z*amount},.3,low?1.4:1.8,state);
  boss.x=moved.x;boss.z=moved.z;
  if(distance(before,boss)<.0005)runtime.stuckFor+=dt;else runtime.stuckFor=0;
  if(runtime.stuckFor>.5){runtime.nextPathAt=0;boss.path=[];}
  return distance(boss,target)<.65;
}

const playerHeightForDrag=(state:GameState)=>state.player.sticky?1.42:1.75;

function beginDrag(state:GameState,world:WorldDef,query:WorldQuery):boolean {
  const home=world.desks.find(desk=>desk.home),destination=home?.seat??world.spawn;
  let path=query.path(state.player,destination,state);
  if(!path.length&&state.player.y>.05) {
    // A player standing on a small object is not on the ground navigation plane.
    // Pull them over its edge along a collision-checked elevated segment first.
    const start=state.player;
    searchEdge: for(const radius of [.8,1.2,1.6])for(let i=0;i<8;i++) {
      const angle=i*Math.PI/4,delta={x:Math.sin(angle)*radius,z:Math.cos(angle)*radius};
      const edge=query.move(start,delta,.3,playerHeightForDrag(state),state,start.y);
      if(distance(edge,{x:start.x+delta.x,z:start.z+delta.z})>.03)continue;
      const rest=query.path(edge,destination,state);if(!rest.length)continue;
      path=[edge,...rest];break searchEdge;
    }
  }
  if(!path.length) {
    // The geometry layer owns path validity. Do not hide a failed route behind a teleport.
    announceMessage(state,'回工位的路被挡住了，领导正在改道。',2);
    state.boss.contactFor=0;return false;
  }
  path=[copyPoint(state.player),...path.map(copyPoint)];
  path=path.filter((point,index)=>index===0||distance(point,path[index-1])>.001);
  if(distance(path[path.length-1],destination)>.5){state.boss.contactFor=0;return false;}
  const runtime=runtimeFor(state);
  runtime.dragDistance=path.slice(1).reduce((sum,point,index)=>sum+distance(point,path[index]),0);
  runtime.dragSpeed=runtime.dragDistance/3.2;
  runtime.dragTravelled=0;runtime.dragElapsed=0;
  state.dragPath=path.slice(1);state.dragProgress=0;
  state.player.pose='dragged';state.player.vy=0;
  state.player.moving=false;state.player.sprinting=false;state.aiming=false;
  state.boss.mode='drag';state.boss.path=[];
  state.interaction=null;runtime.interactionId='';runtime.interactionElapsed=0;
  settlePotForCapture(state);dropHeld(state,world,query);
  if(home) {
    for(const rule of state.rules)if(rule.kind==='desk'&&rule.targetId===home.id&&rule.phase==='active'){rule.phase='restoring';rule.remaining=0;rule.age=0;}
  }
  announceMessage(state,'回工位！屁股别离开椅子。',3.2);
  logEvent(state,'boss:caught');return true;
}

export function updateDrag(state:GameState,dt:number,world:WorldDef,query:WorldQuery):boolean {
  if(state.player.pose!=='dragged')return false;
  const runtime=runtimeFor(state),player=state.player;
  runtime.dragElapsed+=dt;
  let amount=runtime.dragSpeed*dt;
  let iterations=0;
  while(amount>1e-6&&state.dragPath.length&&iterations++<160) {
    const target=state.dragPath[0],length=distance(player,target);
    if(length<.035){state.dragPath.shift();continue;}
    const step=Math.min(amount,length,.16),direction={x:(target.x-player.x)/length,z:(target.z-player.z)/length};
    const old=copyPoint(player);
    const moved=query.move(player,{x:direction.x*step,z:direction.z*step},.3,playerHeightForDrag(state),state,player.y);
    const travelled=distance(player,moved);
    player.x=moved.x;player.z=moved.z;player.yaw=Math.atan2(direction.x,direction.z);
    state.boss.x=old.x;state.boss.z=old.z;state.boss.yaw=player.yaw;
    runtime.dragTravelled+=travelled;amount-=step;
    if(travelled<step*.1){runtime.nextPathAt=0;break;}
  }
  if(player.y>0) {
    const beforeY=player.y,surface=query.supportHeight(player,state);
    player.vy-=12*dt;player.y=Math.max(0,player.y+player.vy*dt);
    if(beforeY>=surface-.025&&player.y<=surface){player.y=surface;player.vy=0;}
  }
  state.dragProgress=Math.min(1,runtime.dragTravelled/Math.max(.01,runtime.dragDistance));
  // Re-plan a genuinely changed route; never place the character through an obstacle.
  if(runtime.dragElapsed>3.65&&state.dragPath.length) {
    const destination=world.desks.find(d=>d.home)?.seat??world.spawn;
    const reroute=query.path(player,destination,state);
    if(reroute.length){
      state.dragPath=reroute;runtime.dragSpeed=Math.max(runtime.dragSpeed,reroute.reduce((sum,point,index)=>sum+distance(index?reroute[index-1]:player,point),0)/.3);
    }
  }
  if(!state.dragPath.length&&runtime.dragElapsed>=2) {
    player.sticky=true;player.pose='working';player.protection=8;
    runtime.workingDesk=world.desks.find(d=>d.home)?.id??null;
    state.catches++;
    state.boss.evidenceUntil=0;state.boss.evidenceId=null;state.boss.contactFor=0;
    runtime.explicitEvent=null;runtime.eventSeenFor=0;runtime.pendingReturn=false;
    clearOrder(state);
    state.boss.mode='leave';state.boss.path=[];runtime.nextPathAt=0;
    const destination=world.desks.find(d=>d.home)?.seat??world.spawn;
    const places=world.patrol.filter(point=>distance(point,destination)>=8.2).sort((a,b)=>distance(a,destination)-distance(b,destination));
    runtime.leaveTarget=copyPoint(places[0]??world.bossSpawn);
    let persistent=state.rules.find(rule=>rule.kind==='return'&&rule.phase==='active');
    if(!persistent){persistent={id:runtime.nextRuleId++,kind:'return',quote:'屁股别离开椅子。',effect:'屁股粘椅 · 本局持续 · 可滑行、打卡、开门',targetId:'player',roomId:state.roomId,phase:'active',remaining:Infinity,duration:0,age:0};state.rules.push(persistent);}
    persistent.effect='屁股粘椅 · 本局持续 · 可滑行、打卡、开门';persistent.remaining=Infinity;
    announceMessage(state,'屁股粘住了，轮子没有。WASD滑行，Shift蹬地；8秒抓回保护。',5);
    logEvent(state,'player:sticky-chair');return true;
  }
  return true;
}

function inspectLights(state:GameState,dt:number,world:WorldDef,query:WorldQuery):boolean {
  const runtime=runtimeFor(state),boss=state.boss;
  const room=query.roomAt(boss);
  if(!room||room.permanentLight||state.lights[room.id]!==false||!['search','chase'].includes(boss.mode)) {runtime.lightUseFor=0;return false;}
  const actual=world.rooms.find(item=>item.id===room.id)!;
  if(distance(boss,actual.switch)>1.15){moveBoss(state,actual.switch,boss.mode==='chase'?4.1:2,dt,world,query);runtime.lightUseFor=0;return true;}
  if((state.switchCooldown[room.id]??0)>0){runtime.lightUseFor=0;return false;}
  runtime.lightUseFor+=dt;
  if(runtime.lightUseFor>=.25){state.lights[room.id]=true;state.switchCooldown[room.id]=4;runtime.lightUseFor=0;boss.contactFor=0;logEvent(state,`boss:light-on:${room.id}`);}
  return true;
}

export function updateBoss(state:GameState,dt:number,world:WorldDef,query:WorldQuery):void {
  const boss=state.boss,player=state.player,runtime=runtimeFor(state);
  if(player.pose==='dragged')return;
  if(boss.mode==='leave') {
    const home=world.desks.find(d=>d.home)?.seat??world.spawn;
    if(runtime.leaveTarget)moveBoss(state,runtime.leaveTarget,2.6,dt,world,query);
    if(distance(boss,home)>=8){boss.mode='patrol';runtime.leaveTarget=null;runtime.nextPathAt=0;}
    return;
  }
  const sees=visible(state,boss,player,10,playerSightHeight(state),query);
  if(!sees||!litAt(state,player,query))boss.contactFor=0;
  const evidence=boss.evidenceUntil>state.elapsed;
  const event=runtime.explicitEvent;
  if(event&&event.until>state.elapsed&&sees&&!runtime.observedEvents.has(event.id)) {
    if(runtime.eventSeenId!==event.id){runtime.eventSeenId=event.id;runtime.eventSeenFor=0;}
    runtime.eventSeenFor+=dt;
    if(runtime.eventSeenFor>=.2){
      runtime.observedEvents.add(event.id);boss.evidenceId=event.id;boss.evidenceUntil=state.elapsed+20;
      boss.lastSeen=copyPoint(player);requestReturnWarning(state);
      announceMessage(state,'领导目击了离场行为 · 证据保留最多20秒。',3);logEvent(state,`boss:evidence:${event.kind}`);
    }
  } else runtime.eventSeenFor=0;
  if(!evidence&&boss.evidenceUntil!==0&&boss.evidenceUntil<=state.elapsed){
    boss.evidenceUntil=0;boss.evidenceId=null;
    if(!sees&&boss.mode!=='warning'){clearOrder(state);boss.mode='patrol';}
  }
  const returnWarning=state.rules.find(rule=>rule.kind==='return'&&rule.phase==='warning');
  if(returnWarning&&boss.evidenceUntil<=state.elapsed&&(!sees||player.pose==='working')) {
    state.rules=state.rules.filter(rule=>rule!==returnWarning);runtime.rules.delete(returnWarning.id);
    runtime.pendingReturn=false;boss.mode='patrol';boss.seenFor=0;
    announceMessage(state,'离岗预警取消 · 他暂时没抓到把柄。',2);logEvent(state,'boss:warning-cancelled');
  }
  if(sees) {
    boss.lastSeen=copyPoint(player);boss.searchFor=0;
    if(player.pose==='working'&&!evidence&&!returnWarning) {
      runtime.workCalm+=dt;boss.seenFor=0;
      if(runtime.workCalm>=2&&(runtime.orderActive||boss.mode==='search'||boss.mode==='chase')){clearOrder(state);boss.mode='patrol';runtime.reports.shift();logEvent(state,'boss:calmed-by-working');}
    } else {
      runtime.workCalm=0;
      if(!runtime.orderActive&&!returnWarning&&player.protection<=0) {
        boss.seenFor+=dt;
        if(boss.seenFor>=1.2)requestReturnWarning(state);
      }
      if(runtime.orderActive)boss.mode='chase';
    }
  } else {boss.seenFor=0;runtime.workCalm=0;}
  if(runtime.pendingReturn&&!state.rules.some(rule=>rule.phase==='warning')) {
    if(sees||boss.evidenceUntil>state.elapsed)requestReturnWarning(state);else runtime.pendingReturn=false;
  }
  if(!runtime.orderActive&&boss.evidenceUntil>state.elapsed&&!state.rules.some(rule=>rule.kind==='return'&&rule.phase==='warning')&&sees)requestReturnWarning(state);
  if(runtime.orderActive&&!sees&&(boss.mode==='chase'||boss.mode==='warning')){boss.mode='search';boss.searchFor=0;runtime.nextPathAt=0;}
  if(inspectLights(state,dt,world,query))return;
  if(boss.mode==='chase'&&runtime.orderActive) {
    if(sees) {
      if(distance(boss,player)>1)moveBoss(state,boss.lastSeen!,4.1,dt,world,query);
      else boss.yaw=Math.atan2(player.x-boss.x,player.z-boss.z);
      if(player.protection<=0&&litAt(state,player,query)&&distance(boss,player)<=1.1&&query.lineOfSight(boss,player,playerSightHeight(state),state))boss.contactFor+=dt;
      else boss.contactFor=0;
      if(boss.contactFor>=.5)beginDrag(state,world,query);
    } else {boss.contactFor=0;boss.mode='search';}
    return;
  }
  boss.contactFor=0;
  if(boss.mode==='warning') {
    if(boss.lastSeen&&distance(boss,boss.lastSeen)>1.3)moveBoss(state,boss.lastSeen,1.2,dt,world,query);
    return;
  }
  if(boss.mode==='search') {
    const arrived=!boss.lastSeen||moveBoss(state,boss.lastSeen,2,dt,world,query);
    if(arrived){boss.searchFor+=dt;boss.yaw+=dt*.65;}
    if(boss.searchFor>=6||runtime.stuckFor>=7.5) {
      if(boss.evidenceUntil<=state.elapsed)clearOrder(state);
      boss.mode='patrol';boss.lastSeen=null;runtime.nextPathAt=0;runtime.reports.shift();
      logEvent(state,'boss:search-ended');
    }
    return;
  }
  if(runtime.reports.length) {
    boss.lastSeen=copyPoint(runtime.reports[0]);boss.mode='search';boss.searchFor=0;runtime.nextPathAt=0;
    return;
  }
  const target=world.patrol[boss.patrolIndex%Math.max(1,world.patrol.length)];
  if(!target)return;
  if(moveBoss(state,target,2,dt,world,query)||runtime.stuckFor>7.5) {
    boss.patrolIndex=(boss.patrolIndex+1)%world.patrol.length;runtime.nextPathAt=0;runtime.stuckFor=0;
  }
}

export function updateColleagues(state:GameState,dt:number,query:WorldQuery):void {
  const runtime=runtimeFor(state),event=runtime.explicitEvent;
  const explicit=event&&event.until>state.elapsed;
  for(const colleague of state.colleagues) {
    colleague.cooldown=Math.max(0,colleague.cooldown-dt);
    if(colleague.reportAt!==null&&state.elapsed>=colleague.reportAt) {
      if(colleague.reportPosition){runtime.reports.push(copyPoint(colleague.reportPosition));if(runtime.reports.length>4)runtime.reports.shift();}
      colleague.reportAt=null;colleague.reportPosition=null;
      announceMessage(state,`${colleague.name}发出了举报 · 领导只知道十秒前的位置。`,3);
      logEvent(state,`colleague:reported:${colleague.id}`);
    }
    const suspicious=explicit||(colleague.grudge&&state.player.pose!=='working');
    if(suspicious&&colleague.cooldown<=0&&colleague.reportAt===null&&visible(state,colleague,state.player,5,playerSightHeight(state),query)) {
      colleague.seenFor+=dt;
      if(colleague.seenFor>=1) {
        colleague.reportAt=state.elapsed+10;colleague.reportPosition=copyPoint(state.player);colleague.cooldown=25;colleague.seenFor=0;
        announceMessage(state,`${colleague.name}拿起了手机 · 10秒后报告这个位置。`,3);
        logEvent(state,`colleague:observed:${colleague.id}`);
      }
    } else colleague.seenFor=0;
  }
}
