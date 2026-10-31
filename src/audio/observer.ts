import type { GameState, WorldDef, WorldQuery } from '../contracts/game';
import type { AudioRoom, OfficeAudio, OfficeAudioEvent, SoundCue, SoundSource, VoiceRole, VoiceLineId } from './types';
/** Read-only bridge. Every gameplay cue follows a state change or real movement. */
export function createAudioObserver(audio:OfficeAudio){
 let current:GameState|null=null,seen=new WeakSet<object>(),serial=0,lastStep=0,lastAmbient=0,lastBubble='',lastBoss:{x:number;z:number}|null=null,bossStride=0,wasMoving=false;
 const source=(state:GameState,query:WorldQuery,p:{x:number;z:number},y=1):SoundSource=>({position:{x:p.x,y,z:p.z},occlusion:query.lineOfSight(state.player,p,1,state,'solid')?0:1});
 return {reset(){current=null;seen=new WeakSet();serial=0;lastStep=0;lastAmbient=0;lastBubble='';lastBoss=null;bossStride=0;wasMoving=false;audio.reset();},update(state:GameState,world:WorldDef,query:WorldQuery,active:boolean){
  if(current!==state){current=state;seen=new WeakSet();lastBoss=null;lastStep=state.elapsed;lastAmbient=state.elapsed;}
  const room=world.rooms.find(r=>r.id===state.roomId),events:OfficeAudioEvent[]=[];
  const cue=(cue:SoundCue,p?:{x:number;z:number})=>events.push({id:`${state.seed}:${++serial}`,kind:'cue',cue,source:p?source(state,query,p):undefined});
  const speech=(role:VoiceRole,line:VoiceLineId,text?:string,p?:{x:number;z:number})=>events.push({id:`${state.seed}:${++serial}`,kind:'speech',speech:{role,line,text},source:p?source(state,query,p):undefined});
  for(const entry of state.eventLog){if(seen.has(entry))continue;seen.add(entry);if(!active)continue;
   const e=entry.event,parts=e.split(':');
   if(parts[0]==='rule'&&['warning','active','ended'].includes(parts[2])){const rule=state.rules.find(r=>r.kind===parts[1]);events.push({id:`${state.seed}:${++serial}`,kind:'rule',rule:parts[1] as import('./types').AudioRule,phase:parts[2]==='ended'?'restore':parts[2] as 'warning'|'active',text:parts[2]==='warning'?rule?.quote:undefined,source:source(state,query,state.boss)});}
   else if(e.startsWith('inspection:announced'))speech('leader-broadcast','inspect');
   else if(e==='inspection:empty-search')speech('leader-search','empty-desk',undefined,state.boss);
   else if(e==='boss:caught')speech('leader-near','caught',undefined,state.boss);
   else if(e==='inspection:passed'||e==='boss:search-ended')speech('leader-near','release',undefined,state.boss);
   else if(e.startsWith('colleague:reported:')){const colleague=state.colleagues.find(c=>c.id===parts[2]);speech('colleague','report',undefined,colleague);}
   else if(e==='player:sticky-chair')cue('chair-stick',state.player);
   else if(e==='player:left-desk')cue('chair-drag',state.player);
   else if(e.startsWith('player:working:'))cue('chair-sit',state.player);
   else if(e==='objective:clocked')cue('clock-in',state.player);
   else if(e.startsWith('exit:opened:'))cue('door-open',state.player);
   else if(e.startsWith('light:'))cue(e.endsWith('true')?'light-on':'light-off',state.player);
   else if(e.startsWith('pot:thrown:'))cue('pot-throw',state.player);
   else if(e.includes(':transferred:'))cue('pot-hit-body',state.player);
   else if(e.startsWith('prop:safe-landing:'))cue('pot-hit-wood',state.props.find(p=>p.id===parts[2]));
   else if(e.startsWith('computer:enter:'))cue('computer-enter');
   else if(e==='computer:exit')cue('computer-exit');
   else if(e==='computer:move')cue('computer-move');
   else if(e==='computer:chat-arrive')cue('chat-arrive');
   else if(e==='computer:company-hour')cue('company-hour');
   else if(e.startsWith('computer:game-complete:'))cue('computer-win');
  }
  if(active&&!state.computer){
   if(state.player.moving&&state.elapsed-lastStep>(state.player.sprinting?.3:.45)){lastStep=state.elapsed;cue(state.player.sticky?'chair-roll':room?.kind==='meeting'?'step-wood':['front','print','tea','admin'].includes(room?.kind??'')?'step-tile':'step-carpet',state.player);}
   if(wasMoving&&!state.player.moving)cue('shoe-stop',state.player);wasMoving=state.player.moving;
   if(lastBoss)bossStride+=Math.hypot(state.boss.x-lastBoss.x,state.boss.z-lastBoss.z);
   if(bossStride>.85){bossStride=0;cue('step-wood',state.boss);}lastBoss={x:state.boss.x,z:state.boss.z};
   if(state.elapsed-lastAmbient>3.2){lastAmbient=state.elapsed;const colleague=state.colleagues.find(c=>c.roomId===state.roomId);if(colleague)cue('keyboard',colleague);else if(room?.kind==='print')cue('printer',{x:room.x,z:room.z});else if(room?.kind==='tea')cue('water',{x:room.x,z:room.z});}
   if(state.bubble&&state.bubble!==lastBubble)speech('player','complaint',state.bubble,state.player);lastBubble=state.bubble;
  }else {lastBoss={x:state.boss.x,z:state.boss.z};wasMoving=false;}
  const mood=state.ending==='escaped'?'success':state.computer?'computer':state.boss.mode==='chase'?'pursuit':state.inspection||state.boss.mode==='warning'?'inspection':state.boss.mode==='leave'?'release':'office';
  audio.update({active,listener:{x:state.player.x,y:state.player.y+1.3,z:state.player.z,yaw:state.player.yaw},room:(room?.kind??'work') as AudioRoom,mood,computer:!!state.computer},events);
 }};
}
