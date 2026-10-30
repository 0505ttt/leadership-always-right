import type { GameState, InputFrame, WorldDef, WorldQuery } from '../contracts/game';
import { initRuntime, logEvent, runtimeFor } from './runtime';
import { checkEscape, updateInteraction, updatePlayer } from './player';
import { handleObjectInput, updateObjects } from './objects';
import { updateBoss, updateColleagues, updateDrag } from './boss';
import { updateEnvironment } from './environment';

export { playerHeight } from './runtime';

export function createGame(world:WorldDef):GameState {
  const home=world.desks.find(desk=>desk.home);
  const holders=[...world.colleagues.filter(colleague=>colleague.pot),...world.colleagues.filter(colleague=>!colleague.pot)].slice(0,2);
  const state:GameState={
    seed:world.seed,elapsed:0,remaining:600,ending:null,clocked:false,openedExits:[],
    player:{...world.spawn,y:0,vy:0,yaw:home?.yaw??0,pose:'working',sticky:false,stamina:4,potId:null,holding:null,potInHand:false,protection:0,crouchIntent:false,moving:false,sprinting:false},
    boss:{...world.bossSpawn,yaw:0,mode:'patrol',lastSeen:null,evidenceUntil:0,evidenceId:null,seenFor:0,contactFor:0,searchFor:0,path:[],patrolIndex:0},
    pots:holders.map((holder,index)=>({id:`pot-${index}`,owner:holder.id,phase:'attached',cooldown:0,progress:0,from:{x:holder.x,z:holder.z},to:{x:holder.x,z:holder.z},targetId:null})),
    props:world.props.map(prop=>({...prop,held:false,large:false,scale:1,y:0})),
    colleagues:world.colleagues.map(colleague=>({...colleague,grudge:false,seenFor:0,reportAt:null,reportPosition:null,cooldown:0})),
    rules:[],lights:Object.fromEntries(world.rooms.map(room=>[room.id,room.lit||room.permanentLight])),switchCooldown:{},
    deskHeights:Object.fromEntries(world.desks.map(desk=>[desk.id,.75])),transparentWalls:[],pressureRooms:[],flowRooms:[],interaction:null,
    message:'18:00了。按E起身，找到打卡机，再从任意出口下班。',messageUntil:8,
    bubble:'规矩立住，下班不烧心。',bubbleUntil:5,nextBubbleAt:35,
    history:['常驻守则：下班先打卡；暗室不能抓人；领导每次指令提前3秒预警。'],catches:0,roomId:home?.roomId??world.rooms[0]?.id??0,dark:false,aiming:false,aimTarget:'',dragPath:[],dragProgress:0,eventLog:[],
  };
  initRuntime(state,home?.id??null);
  logEvent(state,'game:started');
  return state;
}

const complaints=['只要我还在动，就不算原地加班。','领导说得对，但下班也对。','这不是摸鱼，是在等一个合适的时机。','饼再大，也不能当晚饭。','我的工牌没有加班功能。','今天的工作，明天的我会处理。'];

/** Called only while the application is playing. Pausing stops this clock and every rule together. */
export function stepGame(state:GameState,input:InputFrame,dt:number,world:WorldDef,query:WorldQuery):void {
  if(state.ending||!Number.isFinite(dt)||dt<=0)return;
  // The app supplies fixed steps. A stalled tab must not run minutes of catch-up in one call.
  dt=Math.min(dt,.1);
  state.elapsed=Math.min(600,state.elapsed+dt);state.remaining=Math.max(0,600-state.elapsed);
  for(const id of Object.keys(state.switchCooldown))state.switchCooldown[Number(id)]=Math.max(0,state.switchCooldown[Number(id)]-dt);
  if(state.elapsed>=state.messageUntil)state.message='';
  if(state.elapsed>=state.bubbleUntil)state.bubble='';
  const runtime=runtimeFor(state);
  if(state.elapsed>=state.nextBubbleAt&&state.player.pose!=='dragged') {
    let index=Math.floor(runtime.random()*complaints.length);if(index===runtime.lastBubbleIndex)index=(index+1)%complaints.length;
    state.bubble=state.player.sticky?'屁股不能走，轮子可以。':complaints[index];
    runtime.lastBubbleIndex=index;state.bubbleUntil=state.elapsed+5;state.nextBubbleAt=state.elapsed+35;
  }
  const dragging=updateDrag(state,dt,world,query);
  if(!dragging) {
    updatePlayer(state,input,dt,world,query);
    updateInteraction(state,input,dt,world,query);
    handleObjectInput(state,input,world,query);
  }
  updateObjects(state,dt,world,query);
  if(!state.ending) {
    updateColleagues(state,dt,query);
    updateBoss(state,dt,world,query);
    updateEnvironment(state,dt,world,query);
    checkEscape(state,world);
  }
  if(state.remaining<=0&&!state.ending){state.ending='overtime';logEvent(state,'ending:overtime');}
}
