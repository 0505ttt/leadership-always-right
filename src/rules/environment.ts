import type { ActiveRule, GameState, RuleKind, Vec2, Wall, WorldDef, WorldQuery } from '../contracts/game';
import { announceMessage, clamp, copyPoint, distance, logEvent, playerHeight, playerSightHeight, runtimeFor, setWorkingStance, WORK_CHAIR_HEIGHT } from './runtime';
import { attachPot } from './objects';
import { litAt } from './player';
import { visible } from './boss';
import { beginInspection, cancelInspection } from './inspection';
import { safePropPlacement } from './prop-safety';
import { activateBed, findBedPlacement, updateBed } from './bed';

const definitions:Record<Exclude<RuleKind,'return'>,{quote:string;effect:string;duration:number}>={
  cake:{quote:'把饼画大一点，大家才有奔头。',effect:'目标饼膨胀 · 挡双方视线 · 按E推行',duration:22},
  desk:{quote:'所有人的项目，都提高一下优先级。',effect:'全工位抬到1.9米 · 回本人工位站椅办公；粘椅可滚回装忙',duration:20},
  pot:{quote:'这锅，你先背起来。',effect:'现有锅转移 · 可断视线避开',duration:.4},
  flow:{quote:'这个流程，你给我再走一遍。',effect:'标记通道逆向阻力 · 顺箭头不减速',duration:16},
  transparent:{quote:'有问题，就透明一点。',effect:'局部隔断透明 · 碰撞仍保留',duration:18},
  pressure:{quote:'这点压力，低头扛住。',effect:'活动顶板降到1.6米 · 椅子可直接滑过',duration:14},
  bed:{quote:'公司就是你家，还回什么家。',effect:'预告落床 · 保护人员、工位与必经通路 · 无安全落点取消',duration:16},
};

const spatial=(rule:ActiveRule):boolean=>rule.kind!=='return'&&rule.kind!=='pot';

function actor(state:GameState,id:string): (Vec2&{yaw:number})|undefined {
  return id==='player'?state.player:state.colleagues.find(c=>c.id===id);
}

function safeCake(state:GameState,id:string,world:WorldDef,query:WorldQuery,scale=3):boolean {
  const prop=state.props.find(item=>item.id===id);
  if(!prop||prop.held)return false;
  // The current step must be safe now, and the announced final volume must also
  // retain workstation clearances and every mandatory route. Final checks are
  // cached; only the cheap current-volume query runs on every growth frame.
  return safePropPlacement(state,world,query,prop,prop,scale,false)
    && safePropPlacement(state,world,query,prop,prop,3,true);
}

function targetLabel(state:GameState,world:WorldDef,kind:RuleKind,targetId:string,roomId:number,sourceOwner?:string):string {
  const room=world.rooms.find(item=>item.id===roomId)?.name??'办公区';
  const employee=(id:string)=>id==='player'?'你':state.colleagues.find(item=>item.id===id)?.name??'员工';
  let object='';
  if(kind==='cake')object=`${world.props.filter(prop=>prop.kind==='cake').findIndex(prop=>prop.id===targetId)+1}号愿景饼`;
  else if(kind==='desk') {
    const desk=world.desks.find(item=>item.id===targetId),owner=state.colleagues.find(item=>item.deskId===targetId);
    object=desk?.home?'我的工位':owner?`${owner.name}的项目桌`:`${world.desks.findIndex(item=>item.id===targetId)+1}号项目桌`;
  } else if(kind==='pot')object=`${sourceOwner?`${employee(sourceOwner)}的锅 → `:''}${employee(targetId)}`;
  else if(kind==='flow')object='中央通道';
  else if(kind==='transparent')object='局部隔断';
  else if(kind==='pressure')object='活动顶板';
  else if(kind==='bed')object='家用床';
  return `${room} · ${object}`;
}

// Sample the visible face rather than the wall's center, which is itself a vision solid.
function wallFace(wall:Wall,observer:Vec2):Vec2 {
  const point={x:clamp(observer.x,wall.x-wall.w/2,wall.x+wall.w/2),z:clamp(observer.z,wall.z-wall.d/2,wall.z+wall.d/2)};
  const length=distance(point,observer);
  return length>0?{x:point.x+(observer.x-point.x)*.05/length,z:point.z+(observer.z-point.z)*.05/length}:point;
}

function selectRule(state:GameState,world:WorldDef,query:WorldQuery):ActiveRule|null {
  const runtime=runtimeFor(state),boss=state.boss;
  const active=state.rules.filter(rule=>spatial(rule)&&rule.phase!=='restoring');
  // A global desk lift may combine with cake/flow/transparent effects. Only a
  // lowered ceiling over a chair-standing worker is mutually exclusive.
  const occupied=new Set(active.filter(rule=>rule.kind!=='desk').map(rule=>rule.roomId));
  const playerRoom=query.roomAt(state.player)?.id;
  const patrolRoom=query.roomAt(world.patrol[boss.patrolIndex%Math.max(1,world.patrol.length)]??boss)?.id;
  const knownRooms=new Set([query.roomAt(boss)?.id,patrolRoom]);
  if(visible(state,boss,state.player,10,playerSightHeight(state),query))knownRooms.add(playerRoom);
  const localRooms=new Set([playerRoom]);
  for(const door of world.doors) {
    if((door.a!==playerRoom&&door.b!==playerRoom)||distance(state.player,door)>5)continue;
    const room=world.rooms.find(item=>item.id===(door.a===playerRoom?door.b:door.a));
    if(!room)continue;
    const entry={x:door.x+(door.axis==='z'?Math.sign(room.x-door.x)*.4:0),z:door.z+(door.axis==='x'?Math.sign(room.z-door.z)*.4:0)};
    if(query.lineOfSight(state.player,entry,playerSightHeight(state),state))localRooms.add(room.id);
  }
  const observable=(point:Vec2,roomId:number)=>localRooms.has(roomId)&&distance(state.player,point)<=12&&query.lineOfSight(state.player,point,playerSightHeight(state),state);
  const kinds:Exclude<RuleKind,'return'>[]=['cake','desk','pot','flow','transparent','pressure','bed'];
  for(let index=kinds.length-1;index>0;index--){const swap=Math.floor(runtime.random()*(index+1));[kinds[index],kinds[swap]]=[kinds[swap],kinds[index]];}
  const intro=state.props.find(prop=>prop.id==='cake-intro');
  if(intro&&runtime.lastEnvironment<0) {
    const target=[intro,...state.props.filter(prop=>prop.kind==='cake'&&prop!==intro)]
      .find(prop=>safeCake(state,prop.id,world,query)&&observable(prop,prop.roomId)
        &&(prop===intro||(distance(boss,prop)<=8&&query.lineOfSight(boss,prop,1.3,state))));
    // A player may leave immediately. Wait for a genuinely observable cake;
    // never fake the intro elsewhere or lock movement to force them to watch.
    if(!target)return null;
    const definition=definitions.cake;
    const rule:ActiveRule={id:runtime.nextRuleId++,kind:'cake',quote:definition.quote,
      effect:`眼前的愿景饼：${definition.effect}`,targetId:target.id,roomId:target.roomId,
      phase:'warning',remaining:3,duration:definition.duration,age:0};
    runtime.rules.set(rule.id,{});return rule;
  }
  // Prefer observable effects across all kinds, then retain legitimate remote commands.
  // The fallback is seeded, never ranked by a hidden player's live location.
  for(const localOnly of [true,false]) {
   const choose=<T extends Vec2>(targets:T[],roomId:(target:T)=>number,seen:(target:T)=>boolean=target=>observable(target,roomId(target))):T|undefined=>{
    if(!localOnly)return targets[Math.floor(runtime.random()*targets.length)];
    return targets.filter(seen).sort((a,b)=>Number(roomId(a)!==playerRoom)-Number(roomId(b)!==playerRoom)||distance(state.player,a)-distance(state.player,b))[0];
   };
  for(const kind of kinds) {
    if(state.elapsed-(runtime.lastKinds[kind]??-100)<50)continue;
    if(kind!=='pot'&&active.length>=2)continue;
    let targetId='',roomId=-1,potId:string|undefined,sourceOwner:string|undefined;
    if(kind==='cake') {
      const targets=state.props.filter(prop=>prop.kind==='cake'&&!prop.held&&!prop.large&&!occupied.has(prop.roomId)
        &&distance(prop,boss)<=8&&query.lineOfSight(boss,prop,1.3,state)&&safeCake(state,prop.id,world,query));
      const target=choose(targets,target=>target.roomId);
      if(!target)continue;targetId=target.id;roomId=target.roomId;
    } else if(kind==='desk') {
      // It is a global rule; reject conflicting lowered ceilings over any employee
      // workstation rather than silently raising only the chosen nearby desk.
      if(state.rules.some(rule=>rule.kind==='desk')||world.desks.some(desk=>(state.deskHeights[desk.id]??.75)>.76
        ||state.rules.some(rule=>rule.kind==='pressure'&&rule.roomId===desk.roomId)))continue;
      const target=world.desks.find(desk=>desk.home)??world.desks[0];
      if(localOnly&&target&&!observable(target,target.roomId))continue;
      if(!target)continue;targetId=target.id;roomId=target.roomId;
    } else if(kind==='pot') {
      const sources=state.pots.filter(pot=>{const owner=actor(state,pot.owner);return owner&&pot.phase==='attached'&&pot.cooldown<=0&&visible(state,boss,owner,6,1,query);});
      const targets=[{id:'player',point:state.player},...state.colleagues.map(c=>({id:c.id,point:c}))]
        .filter(target=>!state.pots.some(pot=>pot.owner===target.id)&&visible(state,boss,target.point,6,target.id==='player'?playerSightHeight(state):1,query)
          &&(!localOnly||target.id==='player'||observable(target.point,query.roomAt(target.point)?.id??-1)));
      const source=sources[Math.floor(runtime.random()*sources.length)],target=localOnly?targets.sort((a,b)=>distance(state.player,a.point)-distance(state.player,b.point))[0]:targets[Math.floor(runtime.random()*targets.length)];
      if(!source||!target)continue;
      targetId=target.id;roomId=query.roomAt(target.point)?.id??-1;potId=source.id;sourceOwner=source.owner;
    } else if(kind==='flow') {
      const targets=world.rooms.filter(room=>(room.id===query.roomAt(boss)?.id||room.id===patrolRoom)&&!occupied.has(room.id));
      const target=choose(targets,target=>target.id);
      if(!target)continue;targetId=`room-${target.id}`;roomId=target.id;
    } else if(kind==='transparent') {
      const targets=world.walls.filter(wall=>wall.partition&&!occupied.has(wall.roomId)
        &&(knownRooms.has(wall.roomId)||(distance(boss,wall)<=10&&query.lineOfSight(boss,wallFace(wall,boss),1.3,state))));
      const target=choose(targets,target=>target.roomId,target=>observable(wallFace(target,state.player),target.roomId));
      if(!target)continue;targetId=target.id;roomId=target.roomId;
    } else if(kind==='bed') {
      const targets=state.props.filter(prop=>prop.kind==='bed'&&prop.dormant&&!occupied.has(prop.roomId)&&!state.pressureRooms.includes(prop.roomId));
      const target=choose(targets,prop=>prop.roomId);
      // A bed has no observable local target. Try the permitted remote command
      // instead of skipping that fallback and making the rule unreachable.
      if(!target||!findBedPlacement(state,world,query,target)){if(localOnly)break;continue;}
      targetId=target.id;roomId=target.roomId;
    } else {
      const homeRoom=world.desks.find(desk=>desk.home)?.roomId;
      const targets=world.rooms.filter(room=>room.pressure&&room.id!==homeRoom&&!occupied.has(room.id)&&knownRooms.has(room.id)
        &&!world.desks.some(desk=>desk.roomId===room.id&&(state.deskHeights[desk.id]??.75)>.85)
        &&!state.rules.some(rule=>rule.kind==='pressure'&&rule.roomId===room.id));
      const target=choose(targets,target=>target.id,target=>localRooms.has(target.id));
      if(!target)continue;targetId=`room-${target.id}`;roomId=target.id;
    }
    const definition=definitions[kind];
    const location=localOnly?'':roomId===playerRoom?' · 目标暂不可见':' · 目标在其他房间';
    const rule:ActiveRule={id:runtime.nextRuleId++,kind,quote:definition.quote,effect:`${targetLabel(state,world,kind,targetId,roomId,sourceOwner)}：${definition.effect}${location}`,targetId,roomId,phase:'warning',remaining:3,duration:definition.duration,age:0};
    if(kind==='desk'){rule.targetIds=world.desks.map(desk=>desk.id);rule.affectedRoomIds=[...new Set(world.desks.map(desk=>desk.roomId))];}
    runtime.rules.set(rule.id,{potId,sourceOwner});
    return rule;
  }
  }
  return null;
}

function cancelRule(state:GameState,rule:ActiveRule,reason:string):void {
  if(rule.kind==='bed'){const bed=state.props.find(prop=>prop.id===rule.targetId);if(bed){bed.dormant=true;bed.y=2.8;}}
  state.rules=state.rules.filter(item=>item!==rule);
  const runtime=runtimeFor(state);runtime.nextEnvironment=state.elapsed+3;runtime.rules.delete(rule.id);
  cancelInspection(state,rule.id);
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
  if(rule.kind==='bed'){const bed=state.props.find(prop=>prop.id===rule.targetId);if(!bed||!activateBed(state,world,query,bed)){cancelRule(state,rule,'床没有安全落点，这次落床取消。');return;}}
  if(rule.kind==='pot') {
    const pot=state.pots.find(item=>item.id===metadata?.potId),target=actor(state,rule.targetId),source=pot&&actor(state,pot.owner);
    if(!pot||!target||!source||pot.owner!==metadata?.sourceOwner||pot.phase!=='attached'||pot.cooldown>0||state.pots.some(item=>item.owner===rule.targetId)
      ||!visible(state,state.boss,source,6,1,query)||!visible(state,state.boss,target,6,rule.targetId==='player'?playerSightHeight(state):1,query)||!litAt(state,target,query)) {
      cancelRule(state,rule,'分锅条件不成立。这口锅没有转移。');return;
    }
    if(!attachPot(state,pot,rule.targetId,copyPoint(source))){cancelRule(state,rule,'目标已经有锅，不能再叠一口。');return;}
  }
  if(rule.kind==='desk') {
    rule.targetIds=world.desks.map(desk=>desk.id);
    rule.affectedRoomIds=[...new Set(world.desks.map(desk=>desk.roomId))];
    announceMessage(state,'全工位升高：站上自己的椅子办公；屁股粘椅时滚回自己的工位也算。',5);
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
  let complete=true,blocked=false;
  for(const desk of world.desks) {
  let minimum=.75;
  const current=state.deskHeights[desk.id]??.75;
  const under=(point:Vec2)=>Math.abs(point.x-desk.x)<1.1&&Math.abs(point.z-desk.z)<.73;
  if(under(state.player)&&state.player.y<current-.01)minimum=Math.max(minimum,playerHeight(state)+state.player.y+.16);
  if(under(state.boss))minimum=Math.max(minimum,1.96);
  // A cached route can bring an actor under a desk after descent has started.
  // Allow a safety lift back to the raised limit; merely freezing its current
  // height can strand the leader below the navigation clearance indefinitely.
  const next=Math.max(Math.min(1.9,minimum),current-(1.9-.75)*dt/.8);
  state.deskHeights[desk.id]=next<=.751?.75:next;
    complete=complete&&next<=.751;blocked=blocked||minimum>.75;
  }
  rule.effect=blocked?'全工位复位受阻 · 桌下有人的工位暂缓下降':'全工位正在安全复位';
  return complete;
}

function safePressureHeight(state:GameState,roomId:number,desired:number,query:WorldQuery):number {
  for(const colleague of state.colleagues)if(colleague.roomId===roomId&&colleague.workStance==='chair-standing')desired=Math.max(desired,(colleague.y??WORK_CHAIR_HEIGHT)+1.8);
  if(query.roomAt(state.player)?.id!==roomId)return desired;
  // Controllable standing players can duck; seated and dragged players cannot.
  const body=state.player.pose==='working'?playerHeight(state):state.player.sticky?1.42:state.player.pose==='dragged'?1.75:.9;
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
    if(rule.kind==='bed'&&!updateBed(state,rule,world,query)){cancelRule(state,rule,'落点被占用，床已安全撤回；不会挤住玩家。');continue;}
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
      if(rule.kind==='desk')for(const desk of world.desks)state.deskHeights[desk.id]=.75+(1.9-.75)*clamp(rule.age/.8,0,1);
      if(rule.remaining<=0&&rule.phase==='active'){rule.phase='restoring';rule.age=0;logEvent(state,`rule:${rule.kind}:ended`);}
    }
    if(rule.phase==='restoring') {
      let complete=true;
      if(rule.kind==='cake'){
        const prop=state.props.find(item=>item.id===rule.targetId);
        if(prop){prop.scale=Math.max(1,prop.scale-2*dt/.8);prop.large=prop.scale>1.05;complete=prop.scale<=1;}
      } else if(rule.kind==='desk')complete=restoreDesk(state,rule,dt,world);
      else if(rule.kind==='bed')complete=rule.age>=.8;
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
  for(const colleague of state.colleagues) {
    colleague.workStance=(state.deskHeights[colleague.deskId]??.75)>.85?'chair-standing':'seated';
    colleague.y=colleague.workStance==='chair-standing'?WORK_CHAIR_HEIGHT:0;
  }
  if(state.player.pose==='working') {
    const deskId=state.player.workstationId??runtime.workingDesk;
    if(deskId)setWorkingStance(state,deskId);
  }
  // Forced/test overlaps and a newly elevated worker must be safe in this same
  // state update, regardless of the order the two rules were inserted.
  for(const roomId of state.pressureRooms)state.pressureHeights[roomId]=safePressureHeight(state,roomId,state.pressureHeights[roomId]??1.6,query);
  const firstWindow=state.props.some(prop=>prop.id==='cake-intro')?3:15;
  if(state.player.pose==='dragged'||state.inspection||state.elapsed<firstWindow||runtime.pendingReturn||runtime.orderActive
    ||['search','chase','warning','leave'].includes(state.boss.mode)||state.rules.some(rule=>rule.phase==='warning')||state.elapsed<runtime.nextEnvironment)return;
  if(state.elapsed-runtime.lastEnvironment<18)return;
  const rule=selectRule(state,world,query);
  if(!rule){runtime.nextEnvironment=state.elapsed+3;return;}
  if(!beginInspection(state,rule,world,query)){runtime.rules.delete(rule.id);runtime.nextEnvironment=state.elapsed+3;return;}
  state.rules.push(rule);runtime.lastEnvironment=state.elapsed;runtime.lastKinds[rule.kind]=state.elapsed;
  runtime.nextEnvironment=state.elapsed+24+runtime.random()*12;
  state.history.unshift(`${rule.quote}（${rule.effect}）`);state.history=state.history.slice(0,30);
  logEvent(state,`rule:${rule.kind}:warning`);
}
