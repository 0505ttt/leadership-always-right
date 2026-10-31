import type { GameState } from '../contracts/game';
import { chatPair, companyClock, computerProgress, type ComputerCommand } from './game';
import './computer.css';
const button=(label:string,command:string)=>`<button class="button button--secondary" data-computer="${command}">${label}</button>`;
/** Functional terminal shell reuses Kimi's palette/buttons; final art is a Kimi handoff. */
export function createComputerView(host:HTMLElement,onCommand:(command:ComputerCommand|'close')=>void){
 const root=document.createElement('section');root.className='computer-terminal';root.hidden=true;root.setAttribute('aria-label','办公室电脑');root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');host.append(root);
 let mode='',lastFocus:HTMLElement|null=null;
 const click=(event:MouseEvent)=>{const b=(event.target as Element).closest<HTMLElement>('[data-computer]');if(b)onCommand(b.dataset.computer as ComputerCommand|'close');};
 const key=(event:KeyboardEvent)=>{if(root.hidden)return;const actions:Record<string,ComputerCommand|'close'>={Escape:'close',ArrowLeft:'left',ArrowDown:'middle',ArrowRight:'right',Digit1:'left',Digit2:'middle',Digit3:'right'};
  if(actions[event.code]){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)onCommand(actions[event.code]);}
  if(event.key==='Tab'){const items=Array.from(root.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));const index=items.indexOf(document.activeElement as HTMLButtonElement);if(event.shiftKey&&index<=0){items.at(-1)?.focus();event.preventDefault();}else if(!event.shiftKey&&index===items.length-1){items[0]?.focus();event.preventDefault();}}
 };
 root.addEventListener('click',click);document.addEventListener('keydown',key,true);
 return {update(state:GameState){const c=state.computer;
  if(!c){if(!root.hidden)lastFocus?.focus();root.hidden=true;mode='';return;}
  const opening=root.hidden;root.hidden=false;if(opening)lastFocus=document.activeElement as HTMLElement;
  if(mode!==c.mode){mode=c.mode;root.innerHTML=`<header><div><p class="eyebrow">甩锅有限公司 · 电脑终端</p><h1>${c.mode==='game'?'需求分拣':c.mode==='chat'?'豆包式工位闲聊':'工位桌面'}</h1></div><div><time></time>${button('关闭电脑 · Esc','close')}</div></header><p>电脑内暂停逃离倒计时；公司时间每 10 分钟前进 1 小时。关闭即可继续探索。</p><nav>${button('桌面','desktop')}${button('小游戏','game')}${button('工位闲聊','chat')}</nav><main></main>`;
   const main=root.querySelector('main')!;
   if(c.mode==='desktop')main.innerHTML='<h2>已到下班时间</h2><p>这里没有必须完成的办公任务。可以玩一局小游戏，或者看看工位闲聊。</p>';
   if(c.mode==='game')main.innerHTML=`<p>用 ← ↓ → / 1 2 3 或点击下方三条通道接需求。每批 12 项，接住得分，漏接不影响逃离。</p><p data-score aria-live="polite"></p><div class="computer-lanes">${[0,1,2].map(i=>`<button class="button" data-computer="${['left','middle','right'][i]}" aria-label="选择第${i+1}条通道"><span class="request-token">需求</span><strong>${i+1}</strong></button>`).join('')}</div>${button('重新一批','game')}`;
   if(c.mode==='chat')main.innerHTML=`<p class="computer-question"></p><p class="computer-answer" aria-live="polite"></p><div>${button('查看回复','reply')}${button('下一段','next')}${button('跳过','skip')}${button('重读本段','reread')}</div><details><summary>本次记录</summary><pre></pre></details>`;
   root.querySelector<HTMLButtonElement>('button')?.focus();
  }
  root.querySelector('time')!.textContent=`公司时间 ${companyClock(state)} · 逃离剩余 ${Math.ceil(state.remaining)}秒`;
  if(c.mode==='game'){root.querySelector('[data-score]')!.textContent=c.rounds>=12?`本批完成：${c.score}/12 · 可重新开始或随时关闭`:`第${c.rounds+1}/12项 · 已接 ${c.score} · 漏接 ${c.misses}`;
   root.querySelectorAll<HTMLButtonElement>('.computer-lanes button').forEach((b,i)=>{b.setAttribute('aria-pressed',String(c.lane===i));const token=b.querySelector<HTMLElement>('.request-token')!;token.hidden=i!==c.targetLane||c.rounds>=12;token.style.transform=`translateY(${computerProgress(c)*140}px)`;});
  }else if(c.mode==='chat'){const pair=chatPair(state);root.querySelector('.computer-question')!.textContent=pair[0];root.querySelector('.computer-answer')!.textContent=c.chatRevealed?pair[1]:'点击“查看回复”，也可跳过。';root.querySelector('pre')!.textContent=c.history.join('\n\n');}
 },destroy(){root.removeEventListener('click',click);document.removeEventListener('keydown',key,true);root.remove();}};
}
