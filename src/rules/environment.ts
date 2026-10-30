import type { ActiveRule, GameState, RuleKind, Vec2, WorldDef, WorldQuery } from '../contracts/game';
import { announceMessage, clamp, copyPoint, distance, logEvent, playerHeight, playerSightHeight, runtimeFor } from './runtime';
import { attachPot } from './objects';
import { litAt } from './player';
import { visible } from './boss';

const definitions:Record<Exclude<RuleKind,'return'>,{quote:string;effect:string;duration:number}>={
  cake:{quote:'把饼画大一点，大家才有奔头。',effect:'目标饼膨胀 · 挡双方视线 · 按E推行',duration:22},
  desk:{quote:'这个项目，提高一下优先级。',effect:'目标桌抬到1.9米 · 可从桌下绕行',duration:20},
  pot:{quote:'这锅，你先背起来。',effect:'现有锅转移 · 可断视线避开',duration:.4},
  flow:{quote:'这个流程，你给我再走一遍。',effect:'标记通道逆向阻力 · 顺箭头不减速',duration:16},
  transparent:{quote:'有问题，就透明一点。',effect:'局部隔断透明 · 碰撞仍保留',duration:18},
  pressure:{quote:'这点压力，低头扛住。',effect:'活动顶板降到1.6米 · 椅子可直接滑过',duration:14},
};

const spatial=(rule:ActiveRule):boolean=>rule.kind!=='return'&&rule.kind!=='pot';

function actor(state:GameState,id:string): (Vec2&{yaw:number})|undefined {
  return id==='player'?state.player:state.colleagues.find(c=>c.id===id);
}

function safeCake(state:GameState,id:string,world:WorldDef,query:WorldQuery,scale=3):boolean {
  const prop=state.props.find(item=>item.id===id);
  if(!prop||prop.held)return false;
  const radius=.3*scale;
  const home=world.desks.find(d=>d.home)?.seat??world.spawn;
  if(distance(prop,home)<radius+1||distance(prop,state.player)<radius+.35||distance(prop,state.boss)<radius+.36)return false;
  if(state.colleagues.some(c=>distance(c,prop)<radius+.35))return false;
  const held=prop.held;prop.held=true;
  const safe=query.validPlacement(prop,radius,state);
  prop.held=held;
  return safe;
}

function selectRule(state:GameState,world:WorldDef,query:WorldQuery):ActiveRule|null {
  const runtime=runtimeFor(state),boss=state.boss;
  const active=state.rules.filter(rule=>spatial(rule)&&rule.phase!=='restoring');
  const occupied=new Set(active.map(rule=>rule.roomId));
  const kinds:Exclude<RuleKind,'return'>[]=['cake','desk','pot','flow','transparent','pressure'];
  for(let index=kinds.length-1;index>0;index--){const swap=Math.floor(runtime.random()*(index+1));[kinds[index],kinds[swap]]=[kinds[swap],kinds[index]];}
  for(const kind of kinds) {
    if(state.elapsed-(runtime.lastKinds[kind]??-100)<50)continue;
    if(kind!=='pot'&&active.length>=2)continue;
    let targetId='',roomId=-1,potId:string|undefined,sourceOwner:string|undefined;
    if(kind==='cake') {
      const targets=state.props.filter(prop=>prop.kind==='cake'&&!prop.held&&!prop.large&&!occupied.has(prop.roomId)
        &&distance(prop,boss)<=8&&query.lineOfSight(boss,prop,1.3,state)&&safeCake(state,prop.id,world,query));
      const target=targets[Math.floor(runtime.random()*targets.length)];
      if(!target)continue;targetId=target.id;roomId=target.roomId;
    } else if(kind==='desk') {
      const targets=world.desks.filter(desk=>!occupied.has(desk.roomId)&&(state.deskHeights[desk.id]??.75)<.76
        &&!state.rules.some(rule=>rule.kind==='desk'&&rule.targetId===desk.id)
        &&(desk.home||(distance(boss,desk)<10&&query.lineOfSight(boss,desk,1.4,state))));
      const target=targets[Math.floor(runtime.random()*targets.length)];
      if(!target)continue;targetId=target.id;roomId=target.roomId;
    } else if(kind==='pot') {
      const sources=state.pots.filter(pot=>{const owner=actor(state,pot.owner);return owner&&pot.phase==='attached'&&pot.cooldown<=0&&visible(state,boss,owner,6,1,query);});
      const targets=[{id:'player',point:state.player},...state.colleagues.map(c=>({id:c.id,point:c}))]
        .filter(target=>!state.pots.some(pot=>pot.owner===target.id)&&visible(state,boss,target.point,6,target.id==='player'?playerSightHeight(state):1,query));
      const source=sources[Math.floor(runtime.random()*sources.length)],target=targets[Math.floor(runtime.random()*targets.length)];
      if(!source||!target)continue;
      targetId=target.id;roomId=query.roomAt(target.point)?.id??-1;potId=source.id;sourceOwner=source.owner;
    } else if(kind==='flow') {
      const known=[query.roomAt(boss)?.id,query.roomAt(world.patrol[boss.patrolIndex%Math.max(1,world.patrol.length)]??boss)?.id];
      const targets=world.rooms.filter(room=>known.includes(room.id)&&!occupied.has(room.id));
      const target=targets[Math.floor(runtime.random()*targets.length)];
      if(!target)continue;targetId=`room-${target.id}`;roomId=target.id;
    } else if(kind==='transparent') {
      const targets=world.walls.filter(wall=>wall.partition&&!occupied.has(wall.roomId));
      const target=targets[Math.floor(runtime.random()*targets.length)];
      if(!target)continue;targetId=target.id;roomId=target.roomId;
    } else {
      const homeRoom=world.desks.find(desk=>desk.home)?.roomId;
      const targets=world.rooms.filter(room=>room.pressure&&room.id!==homeRoom&&!occupied.has(room.id));
      const target=targets[Math.floor(runtime.random()*targets.length)];
      if(!target)continue;targetId=`room-${target.id}`;roomId=target.id;
    }
    const definition=definitions[kind];
    const rule:ActiveRule={id:runtime.nextRuleId++,kind,quote:definition.quote,effect:definition.effect,targetId,roomId,phase:'warning',remaining:3,duration:definition.duration,age:0};
    runtime.rules.set(rule.id,{potId,sourceOwner});
    return rule;
  }
  return null;
}

function cancelRule(state:GameState,rule:ActiveRule,reason:string):void {
  state.rules=state.rules.filter(item=>item!==rule);
  runtimeFor(state).rules.delete(rule.id);
  announceMessage(state,reason,3);logEvent(state,`rule:${rule.kind}:cancelled`);
}

function activate(state:GameState,rule:ActiveRule,world:WorldDef,query:WorldQuery):void {
  const runtime=runtimeFor(state),metadata=runtime.rules.get(rule.id);
  if(rule.kind==='return') {
    const sees=visible(state,state.boss,state.player,10,playerSightHeight(state),query);
    if((!sees||state.player.pose==='working')&&state.boss.evidenceUntil<=state.elapsed){cancelRule(state,rule,'这次离岗预警取消。');state.boss.mode='patrol';return;}
    runtime.orderActive=true;state.boss.mode=sees?'chase':'search';state.boss.searchFor=0;
    state.rules=state.rules.filter(other=>other===rule||other.kind!=='return');
    rule.phase='active';rule.remaining=Infinity;rule.age=0;
    rule.effect='正在追责 · 亮处接触0.5秒被拖回 · 黑暗可避抓';
    logEvent(state,'boss:chase-started');return;
  }
  if(rule.kind==='cake'&&!safeCake(state,rule.targetId,world,query)){cancelRule(state,rule,'饼没有安全膨胀空间，或已被拿走。这次画饼作废。');return;}
  if(rule.kind==='pot') {
    const pot=state.pots.find(item=>item.id===metadata?.potId),target=actor(state,rule.targetId),source=pot&&actor(state,pot.owner);
    if(!pot||!target||!source||pot.owner!==metadata?.sourceOwner||pot.phase!=='attached'||pot.cooldown>0||state.pots.some(item=>item.owner===rule.targetId)
      ||!visible(state,state.boss,source,6,1,query)||!visible(state,state.boss,target,6,rule.targetId==='player'?playerSightHeight(state):1,query)||!litAt(state,target,query)) {
      cancelRule(state,rule,'分锅条件不成立。这口锅没有转移。');return;
    }
    if(!attachPot(state,pot,rule.targetId,copyPoint(source))){cancelRule(state,rule,'目标已经有锅，不能再叠一口。');return;}
  }
  if(rule.kind==='desk') {
    if(runtime.workingDesk===rule.targetId){state.player.pose=state.player.sticky?'rolling':'standing';runtime.workingDesk=null;announceMessage(state,'桌子升高了，电脑暂时够不到；可以换工位装忙。');}
  }
  rule.phase='active';rule.remaining=rule.duration;rule.age=0;
  if(rule.kind==='cake')state.props.find(prop=>prop.id===rule.targetId)!.large=true;
  if(rule.kind==='transparent'&&!state.transparentWalls.includes(rule.targetId))state.transparentWalls.push(rule.targetId);
  if(rule.kind==='pressure') {
    if(!state.pressureRooms.includes(rule.roomId))state.pressureRooms.push(rule.roomId);
    state.pressureHeights[rule.roomId]=2.8;
  }
  if(rule.kind==='flow'&&!state.flowRooms.includes(rule.roomId))state.flowRooms.push(rule.roomId);
  logEvent(state,`rule:${rule.kind}:active`);
}

function restoreDesk(state:GameState,rule:ActiveRule,dt:number,world:WorldDef):boolean {
  const desk=world.desks.find(item=>item.id===rule.targetId);
  if(!desk)return true;
  let minimum=.75;
  const current=state.deskHeights[desk.id]??.75;
  const under=(point:Vec2)=>Math.abs(point.x-desk.x)<1.1&&Math.abs(point.z-desk.z)<.73;
  if(under(state.player)&&state.player.y<current+.04)minimum=Math.max(minimum,playerHeight(state)+state.player.y+.16);
  if(under(state.boss))minimum=Math.max(minimum,1.96);
  const next=Math.max(Math.min(current,minimum),current-(1.9-.75)*dt/.8);
  state.deskHeights[desk.id]=next<=.751?.75:next;
  rule.effect=minimum>.75?'复位受阻 · 桌下有人，离开后安全下降':'桌面正在安全复位';
  return next<=.751;
}

function safePressureHeight(state:GameState,roomId:number,desired:number,query:WorldQuery):number {
  if(query.roomAt(state.player)?.id!==roomId)return desired;
  // Controllable standing players can duck; seated and dragged players cannot.
  const body=state.player.sticky||state.player.pose==='working'?1.42:state.player.pose==='dragged'?1.75:.9;
  return Math.max(desired,state.player.y+body+.05);
}

export function updateEnvironment(state:GameState,dt:number,world:WorldDef,query:WorldQuery):void {
  const runtime=runtimeFor(state);
  for(const rule of [...state.rules]) {
    rule.age+=dt;
    if(rule.phase==='warning') {
      rule.remaining=Math.max(0,rule.remaining-dt);
      if(rule.remaining<=0)activate(state,rule,world,query);
      continue;
    }
    if(rule.kind==='return')continue;
    if(rule.phase==='active') {
      if(rule.kind==='pressure') {
        // Geometry, actors, camera and presentation all consume this same moving ceiling.
        state.pressureHeights[rule.roomId]=safePressureHeight(state,rule.roomId,Math.max(1.6,2.8-1.2*clamp(rule.age,0,1)),query);
        const holdTime=Math.max(0,rule.age-1)-Math.max(0,rule.age-dt-1);
        rule.remaining=Math.max(0,rule.remaining-holdTime);
      } else rule.remaining=Math.max(0,rule.remaining-dt);
      if(rule.kind==='cake') {
        const prop=state.props.find(item=>item.id===rule.targetId);
        if(prop){
          const desired=1+2*clamp(rule.age/.8,0,1);
          if(desired>prop.scale&&(!safeCake(state,prop.id,world,query,desired))) {
            rule.phase='restoring';rule.age=0;rule.remaining=0;
            announceMessage(state,'饼的膨胀空间被占用，正在安全缩回。',2);
          } else prop.scale=desired;
        }
      }
      if(rule.kind==='desk')state.deskHeights[rule.targetId]=.75+(1.9-.75)*clamp(rule.age/.8,0,1);
      if(rule.remaining<=0&&rule.phase==='active'){rule.phase='restoring';rule.age=0;logEvent(state,`rule:${rule.kind}:ended`);}
    }
    if(rule.phase==='restoring') {
      let complete=true;
      if(rule.kind==='cake'){
        const prop=state.props.find(item=>item.id===rule.targetId);
        if(prop){prop.scale=Math.max(1,prop.scale-2*dt/.8);prop.large=prop.scale>1.05;complete=prop.scale<=1;}
      } else if(rule.kind==='desk')complete=restoreDesk(state,rule,dt,world);
      else if(rule.kind==='transparent')state.transparentWalls=state.transparentWalls.filter(id=>id!==rule.targetId);
      else if(rule.kind==='flow')state.flowRooms=state.flowRooms.filter(id=>id!==rule.roomId);
      else if(rule.kind==='pressure'){
        state.pressureHeights[rule.roomId]=safePressureHeight(state,rule.roomId,1.6+1.2*clamp(rule.age,0,1),query);
        complete=rule.age>=1;
        if(complete){state.pressureRooms=state.pressureRooms.filter(id=>id!==rule.roomId);delete state.pressureHeights[rule.roomId];}
      }
      if(complete){state.rules=state.rules.filter(item=>item!==rule);runtime.rules.delete(rule.id);}
    }
  }
  if(state.player.pose==='dragged'||state.elapsed<15||runtime.pendingReturn||state.rules.some(rule=>rule.phase==='warning')||state.elapsed<runtime.nextEnvironment)return;
  if(state.elapsed-runtime.lastEnvironment<18)return;
  const rule=selectRule(state,world,query);
  if(!rule){runtime.nextEnvironment=state.elapsed+3;return;}
  state.rules.push(rule);runtime.lastEnvironment=state.elapsed;runtime.lastKinds[rule.kind]=state.elapsed;
  runtime.nextEnvironment=state.elapsed+24+runtime.random()*12;
  state.history.unshift(rule.quote);state.history=state.history.slice(0,30);
  logEvent(state,`rule:${rule.kind}:warning`);
}
