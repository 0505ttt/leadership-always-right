import type { GameState, InputFrame, Pot, PropState, Vec2, WorldDef, WorldQuery } from '../contracts/game';
import { announceMessage, clamp, copyPoint, distance, explicitAction, forward, lerp, logEvent, runtimeFor } from './runtime';

type FlyingProp = PropState & { y?: number };

function actorPosition(state: GameState, id: string): Vec2 | undefined {
  if (id === 'player') return state.player;
  if (id === 'boss') return state.boss;
  return state.colleagues.find(colleague => colleague.id === id);
}

export function syncPotOwners(state: GameState): void {
  const owned = state.pots.find(pot => pot.owner === 'player');
  state.player.potId = owned?.id ?? null;
  state.player.potInHand = owned?.phase === 'held';
}

export function attachPot(state: GameState, pot: Pot, owner: string, from?: Vec2): boolean {
  if (state.pots.some(other => other !== pot && other.owner === owner)) return false;
  const target = actorPosition(state, owner);
  if (!target) return false;
  const previous = actorPosition(state, pot.owner) ?? pot.to;
  pot.from = copyPoint(from ?? previous);
  pot.to = copyPoint(target);
  pot.owner = owner;
  pot.targetId = owner;
  pot.phase = 'attaching';
  pot.progress = 0;
  pot.cooldown = 2;
  syncPotOwners(state);
  logEvent(state, `${pot.id}:transferred:${owner}`);
  return true;
}

function pointSegmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function forwardProjection(point:Vec2,from:Vec2,to:Vec2):number {
  const dx=to.x-from.x,dz=to.z-from.z;
  return ((point.x-from.x)*dx+(point.z-from.z)*dz)/(Math.hypot(dx,dz)||1);
}

function aimActor(state: GameState, query: WorldQuery): {id: string;name: string;point: Vec2} | null {
  const from = state.player, direction = forward(from.yaw);
  const to = { x: from.x + direction.x * 6, z: from.z + direction.z * 6 };
  const candidates = [{id: 'boss', name: '领导', point: state.boss}, ...state.colleagues.map(c => ({id:c.id,name:c.name,point:c}))];
  candidates.sort((a,b) => distance(from,a.point) - distance(from,b.point));
  return candidates.find(candidate => {
    const ahead = forwardProjection(candidate.point,from,to);
    return ahead > 0.1 && ahead <= 6 && pointSegmentDistance(candidate.point, from, to) < 0.58
      && query.lineOfSight(from, candidate.point, 1.15, state,'solid');
  }) ?? null;
}

export function updateAim(state: GameState, query: WorldQuery): void {
  if (!state.aiming || (!state.player.holding && !state.player.potInHand)) {
    state.aimTarget = '';
    return;
  }
  const actor = aimActor(state, query);
  if (actor?.id === 'boss') state.aimTarget = state.player.potInHand ? '领导 · 命中将被辞退' : '领导 · 投掷会引起追责';
  else if (actor) state.aimTarget = `${actor.name}${state.pots.some(p => p.owner === actor.id) ? ' · 已有锅，会弹回' : ' · 会记仇'}`;
  else state.aimTarget = state.player.potInHand ? '没有目标 · 投空后锅会回到你身上' : '投掷方向 · 最远6米';
}

const propRadius = (prop:PropState):number => Math.SQRT2*(prop.kind==='box'?.275:.3*prop.scale);

function clearOfActors(state:GameState,point:Vec2,radius:number):boolean {
  return [state.player,state.boss,...state.colleagues].every(actor=>distance(actor,point)>radius+.32);
}

function safeRestPoint(state:GameState,world:WorldDef,query:WorldQuery,point:Vec2,radius:number):boolean {
  const home=world.desks.find(desk=>desk.home)?.seat??world.spawn;
  return distance(point,home)>=1.45
    &&!world.doors.some(door=>distance(point,door)<1.3)
    &&!world.exits.some(exit=>distance(point,exit)<1.6)
    &&clearOfActors(state,point,radius)&&query.validPlacement(point,radius,state);
}

function nearbyLanding(state:GameState,world:WorldDef,query:WorldQuery,origin:Vec2,prop:PropState):Vec2|null {
  const radius=propRadius(prop),height=prop.kind==='box'?.55:.4*prop.scale;
  // A landing is independent of the player's current facing. Check all sides,
  // within a small bounded radius, without moving the prop across a wall.
  for(const offset of [0,.4,.8,1.2,1.6])for(let index=0;index<(offset?16:1);index++) {
    const angle=index*Math.PI/8,delta={x:Math.sin(angle)*offset,z:Math.cos(angle)*offset};
    const candidate={x:origin.x+delta.x,z:origin.z+delta.z};
    if(!safeRestPoint(state,world,query,candidate,radius)||!query.lineOfSight(origin,candidate,.6,state,'solid'))continue;
    if(distance(query.move(origin,delta,radius,height,state),candidate)<.001)return candidate;
  }
  return null;
}

export function legalDrop(state: GameState, world: WorldDef, query: WorldQuery, origin:Vec2 = state.player, item?:PropState): Vec2 | null {
  const prop=item??state.props.find(candidate=>candidate.id===state.player.holding);
  const radius=prop?propRadius(prop):.35;
  const direction = forward(state.player.yaw);
  const right = {x:direction.z,z:-direction.x};
  for (const length of [0.9, 1.25, 1.6]) {
    for (const offset of [0, 0.65, -0.65, 1, -1]) {
      const candidate = {x:origin.x + direction.x * length + right.x * offset,z:origin.z + direction.z * length + right.z * offset};
      if (safeRestPoint(state,world,query,candidate,radius) && query.lineOfSight(origin,candidate,0.6,state,'solid')) return candidate;
    }
  }
  return null;
}

export function dropHeld(state: GameState, world: WorldDef, query: WorldQuery): boolean {
  if (!state.player.holding) return true;
  const item = state.props.find(prop => prop.id === state.player.holding) as FlyingProp | undefined;
  if (!item) { state.player.holding = null; return true; }
  const spot = legalDrop(state,world,query);
  if (!spot) { announceMessage(state, '这里放不下，换个不挡门的位置。'); return false; }
  Object.assign(item, spot, {held:false,y:0});
  item.roomId = query.roomAt(spot)?.id ?? item.roomId;
  state.player.holding = null;
  logEvent(state, `prop:dropped:${item.id}`);
  return true;
}

export function handleObjectInput(state: GameState, input: InputFrame, world: WorldDef, query: WorldQuery): void {
  const player = state.player, runtime = runtimeFor(state);
  if (player.pose === 'dragged') return;
  const pot = state.pots.find(item => item.owner === 'player');
  if (input.potPressed && pot) {
    if (pot.phase === 'attached' || pot.phase === 'held') {
      if (pot.phase === 'attached' && !dropHeld(state,world,query)) return;
      runtime.potReturningToHand.set(pot.id, pot.phase === 'attached');
      pot.phase = 'drawing';
      pot.progress = 0;
      syncPotOwners(state);
    }
  } else if (input.potPressed && !pot) announceMessage(state, '你现在没有背锅。靠近背锅同事可能接到他的锅。');
  if (input.dropPressed) {
    if (player.holding) dropHeld(state,world,query);
    else if (pot?.phase === 'held') {
      runtime.potReturningToHand.set(pot.id, false);
      pot.phase = 'drawing'; pot.progress = 0; syncPotOwners(state);
    }
  }
  if (!input.throwPressed) return;
  if (pot?.phase === 'held') {
    const direction = forward(player.yaw);
    pot.phase = 'flying'; pot.progress = -0.2;
    pot.from = copyPoint(player);
    pot.to = {x:player.x + direction.x * 6,z:player.z + direction.z * 6};
    pot.targetId = null;
    runtime.potReleasePosition.set(pot.id, copyPoint(player));
    if (aimActor(state,query)) explicitAction(state,'throw');
    syncPotOwners(state);
    logEvent(state,`pot:thrown:${pot.id}`);
  } else if (player.holding) {
    const prop = state.props.find(item => item.id === player.holding) as FlyingProp | undefined;
    if (!prop) return;
    const direction = forward(player.yaw);
    const from = copyPoint(player);
    let to: Vec2 | null = null;
    // Reserve a legal resting point before releasing, so an airborne object cannot seal an exit.
    for (let length=6; length>=0.8; length-=0.2) {
      const candidate = {x:from.x + direction.x * length,z:from.z + direction.z * length};
      const home = world.desks.find(desk => desk.home)?.seat ?? world.spawn;
      if (distance(candidate,home)<1.4 || world.doors.some(d=>distance(candidate,d)<1.3) || world.exits.some(e=>distance(candidate,e)<1.6)) continue;
      if (clearOfActors(state,candidate,propRadius(prop)) && query.lineOfSight(from,candidate,1.1,state,'solid') && query.validPlacement(candidate,propRadius(prop),state)) { to=candidate; break; }
    }
    if (!to) { announceMessage(state,'前方没有安全落点，物件仍在手里。'); return; }
    if (aimActor(state,query)) explicitAction(state,'throw');
    prop.held = false; prop.y=1.1;
    player.holding = null;
    runtime.propFlights.set(prop.id,{from,to,elapsed:0,duration:.55});
    logEvent(state,`prop:thrown:${prop.id}`);
  }
}

function startReturn(state: GameState, pot: Pot, from: Vec2): void {
  pot.phase = 'returning'; pot.progress = 0;
  pot.from = copyPoint(from);
  pot.to = copyPoint(actorPosition(state,pot.owner) ?? state.player);
  pot.targetId = null;
}

export function settlePotForCapture(state: GameState): void {
  const runtime = runtimeFor(state);
  for (const pot of state.pots) {
    if (pot.owner !== 'player') continue;
    pot.phase='attached'; pot.progress=0; pot.targetId=null;
    runtime.potReleasePosition.delete(pot.id);
    runtime.potReturningToHand.delete(pot.id);
  }
  syncPotOwners(state);
}

export function updateObjects(state: GameState, dt: number, world: WorldDef, query: WorldQuery): void {
  const runtime = runtimeFor(state);
  for (const prop of state.props as FlyingProp[]) {
    const flight=runtime.propFlights.get(prop.id);
    if (!flight) continue;
    flight.elapsed += dt;
    const progress=clamp(flight.elapsed/flight.duration,0,1);
    prop.x=lerp(flight.from.x,flight.to.x,progress); prop.z=lerp(flight.from.z,flight.to.z,progress);
    prop.y=Math.max(.16,(1-progress)*1.1+Math.sin(progress*Math.PI)*.8);
    if (progress>=1) {
      // Actors can enter a reserved landing point during the flight. Relocate
      // only the small prop to a nearby valid rest point before enabling collision.
      const spot=nearbyLanding(state,world,query,flight.to,prop);
      if(!spot)continue;
      if(distance(prop,spot)>.01)logEvent(state,`prop:safe-landing:${prop.id}`);
      Object.assign(prop,spot);prop.y=0; prop.roomId=query.roomAt(prop)?.id??prop.roomId;
      runtime.propFlights.delete(prop.id);
    }
  }
  for (const pot of state.pots) {
    pot.cooldown=Math.max(0,pot.cooldown-dt);
    if (pot.phase==='drawing') {
      pot.progress+=dt/.3;
      if (pot.progress>=1) { pot.phase=runtime.potReturningToHand.get(pot.id)?'held':'attached'; pot.progress=0; }
    } else if (pot.phase==='attaching') {
      pot.progress+=dt/.25;
      const target=actorPosition(state,pot.owner); if(target) pot.to=copyPoint(target);
      if (pot.progress>=1) {pot.phase='attached';pot.progress=0;pot.targetId=null;}
    } else if (pot.phase==='returning') {
      pot.progress+=dt/.6;
      const owner=actorPosition(state,pot.owner); if(owner)pot.to=copyPoint(owner);
      if(pot.progress>=1){pot.phase='attached';pot.progress=0;}
    } else if (pot.phase==='flying') {
      if (pot.progress<0) { pot.progress=Math.min(0,pot.progress+dt); continue; }
      const old=pot.progress;
      pot.progress=Math.min(1,pot.progress+dt/.5);
      const from={x:lerp(pot.from.x,pot.to.x,old),z:lerp(pot.from.z,pot.to.z,old)};
      const to={x:lerp(pot.from.x,pot.to.x,pot.progress),z:lerp(pot.from.z,pot.to.z,pot.progress)};
      if(!query.lineOfSight(from,to,1.15,state,'solid')){startReturn(state,pot,from);continue;}
      const hit=[{id:'boss',point:state.boss},...state.colleagues.map(c=>({id:c.id,point:c}))]
        .filter(actor=>{
          // Segment-distance clamps to its start: without the release-ray check,
          // a nearby actor behind the thrower would count as an immediate hit.
          const ahead=forwardProjection(actor.point,pot.from,pot.to);
          return actor.id!==pot.owner&&ahead>.1&&ahead<=6
            &&pointSegmentDistance(actor.point,from,to)<.58
            &&query.lineOfSight(from,actor.point,1.15,state,'solid');
        })
        .sort((a,b)=>distance(from,a.point)-distance(from,b.point))[0];
      if(hit?.id==='boss') {
        state.ending='fired'; pot.to=copyPoint(state.boss); pot.progress=1;
        announceMessage(state,'提前下班——明天也不用来了。');logEvent(state,'ending:fired');
        break;
      }
      if(hit) {
        const colleague=state.colleagues.find(c=>c.id===hit.id)!;
        colleague.grudge=true;
        if(attachPot(state,pot,colleague.id,to)) announceMessage(state,`${colleague.name}接了锅，也记住了你。`);
        else {startReturn(state,pot,to);announceMessage(state,`${colleague.name}已经有锅。你的锅弹回来了。`);}
      } else if(pot.progress>=1) startReturn(state,pot,to);
    }
  }
  syncPotOwners(state);
  if(!state.player.potId&&state.player.pose!=='dragged') {
    const donor=state.colleagues.find(colleague=>distance(state.player,colleague)<.85&&query.lineOfSight(state.player,colleague,1.1,state,'solid'));
    const pot=donor&&state.pots.find(item=>item.owner===donor.id&&item.phase==='attached'&&item.cooldown<=0);
    if(pot&&attachPot(state,pot,'player')) announceMessage(state,'接触交接：这口锅，现在归你了。移动速度 −15%。',4);
  }
  updateAim(state,query);
}
