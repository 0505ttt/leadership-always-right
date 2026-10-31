import type { ComputerSession, GameState, WorldDef, WorldQuery } from '../contracts/game';
import { distance, logEvent, runtimeFor } from '../rules/runtime';
import { visible } from '../rules/boss';

export const COMPANY_HOUR_SECONDS=600;
/** The terminal is a foreground diversion, never an escape objective or a pursuit shield. */
export function availableComputer(state:GameState,world:WorldDef,query:WorldQuery):string|null {
 if(state.ending||state.computer||state.inspection||state.player.pose==='dragged'||['chase','warning','search','inspection','drag'].includes(state.boss.mode))return null;
 if(state.rules.some(rule=>rule.phase==='warning'||rule.phase==='restoring'))return null;
 const action=runtimeFor(state).explicitEvent;
 if(state.boss.evidenceUntil>state.elapsed||(action&&action.until>state.elapsed))return null;
 if(visible(state,state.boss,state.player,10,state.player.y+1.1,query)&&state.player.pose!=='working')return null;
 const desks=world.desks.filter(desk=>distance(desk.seat,state.player)<1.8&&query.roomAt(state.player)?.id===desk.roomId
  &&query.lineOfSight(state.player,desk.seat,Math.max(1.1,state.player.y+.8),state,'solid'));
 return desks.sort((a,b)=>distance(a.seat,state.player)-distance(b.seat,state.player))[0]?.id??null;
}
export function openComputer(state:GameState,world:WorldDef,query:WorldQuery):boolean {
 const deskId=availableComputer(state,world,query);if(!deskId)return false;
 state.computer={deskId,mode:'desktop',elapsed:0,chatIndex:0,chatRevealed:false,rounds:0,score:0,misses:0,lane:1,targetLane:0,roundElapsed:0,history:[]};
 state.player.moving=false;state.player.sprinting=false;state.aiming=false;state.interaction=null;
 logEvent(state,`computer:enter:${deskId}`);return true;
}
export function closeComputer(state:GameState):void {if(!state.computer)return;state.computer=null;logEvent(state,'computer:exit');}
export function companyClock(state:GameState):string {
 const minutes=Math.floor((state.companySeconds??0)/10);
 return `${String((18+Math.floor(minutes/60))%24).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}
export const chatVariants=[
 ['我现在能下班了吗？','把规矩立住，才不烧心。最直白、最简单、最不绕弯子：先打卡，再走到出口。电脑里没有必须完成的任务。'],
 ['领导说全工位都要提高优先级。','优先级现在真的在高处。回自己的工位站上椅子装忙。如果屁股粘椅，滚回自己的工位也算守规矩。'],
 ['同事举报我，领导会知道我现在在哪吗？','举报记录的是同事看见你时的位置。换一条路、挡住视线，可以让领导扑空。'],
 ['在这里待着算加班吗？','逃离倒计时暂停，公司的钟还在走：前台电脑里每过真实十分钟，公司时间前进一小时。下班仍然随时可以尝试。'],
 ['饼这么大，能吃吗？','不能当晚饭，但能挡住领导和你的视线，也能推动改变路线。它对双方都生效。'],
];
export function chatPair(state:GameState):readonly string[] {
 const c=state.computer;return chatVariants[((state.seed>>>0)%chatVariants.length+(c?.chatIndex??0))%chatVariants.length];
}
function target(state:GameState,round:number):number {
 let n=(state.seed^Math.imul(round+1,0x45d9f3b))>>>0;n=Math.imul(n^(n>>>16),0x45d9f3b)>>>0;return n%3;
}
export type ComputerCommand='desktop'|'game'|'chat'|'left'|'middle'|'right'|'reply'|'next'|'skip'|'reread';
export function commandComputer(state:GameState,command:ComputerCommand):void {
 const c=state.computer;if(!c)return;
 if(command==='desktop'||command==='game'||command==='chat'){
  c.mode=command;if(command==='game'){c.rounds=0;c.score=0;c.misses=0;c.roundElapsed=0;c.targetLane=target(state,0);}
 }else if(['left','middle','right'].includes(command)){c.lane=['left','middle','right'].indexOf(command);logEvent(state,'computer:move');}
 else if(command==='reply'){if(!c.chatRevealed){c.chatRevealed=true;c.history.push(chatPair(state).join('\n'));c.history=c.history.slice(-12);logEvent(state,'computer:chat-arrive');}}
 else if(command==='next'||command==='skip'){c.chatIndex++;c.chatRevealed=false;}
 else if(command==='reread')c.chatRevealed=true;
}
/** Call only with foreground wall-clock delta. A suspended tab must not catch up. */
export function advanceComputer(state:GameState,dt:number):void {
 const c=state.computer;if(!c||!Number.isFinite(dt)||dt<=0)return;
 const oldHour=Math.floor((state.companySeconds??0)/COMPANY_HOUR_SECONDS);
 state.companySeconds=(state.companySeconds??0)+dt;c.elapsed+=dt;
 if(Math.floor(state.companySeconds/COMPANY_HOUR_SECONDS)>oldHour)logEvent(state,'computer:company-hour');
 if(c.mode!=='game'||c.rounds>=12)return;
 c.roundElapsed+=dt;
 while(c.roundElapsed>=1.4&&c.rounds<12){
  c.roundElapsed-=1.4;if(c.lane===c.targetLane)c.score++;else c.misses++;
  c.rounds++;c.targetLane=target(state,c.rounds);
  if(c.rounds===12)logEvent(state,`computer:game-complete:${c.score}`);
 }
}
export function computerProgress(c:ComputerSession):number{return Math.min(1,c.roundElapsed/1.4);}
