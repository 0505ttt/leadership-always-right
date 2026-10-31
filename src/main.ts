import { createGame, stepGame } from './rules/game';
import { generateWorld } from './world/generate';
import { makeWorldQuery } from './world/query';
import { validateWorld } from './world/validate';
import { OfficeScene } from './presentation/scene';
import { createCharacterLibrary } from './presentation/characters';
import { GameInput } from './gameplay/input';
import { FrameMetrics } from './gameplay/performance';
import { RuntimeAssets } from './gameplay/assets';
import { bindUI } from './ui/bindings';
import type { Page, Settings, UICommand, UIModel } from './contracts/game';

declare const __BUILD_COMMIT__:string;
const version=__BUILD_COMMIT__;
const runtimeAssets=new RuntimeAssets();
const characterLibrary=createCharacterLibrary({assets:runtimeAssets});
const runtimeSpecs=['employee-base-v1','leader-v1','pot-v1','chair-v1','computer-set-v1','box-v1','clock-station-v1','plant-v1'].map(id=>({id,url:`${import.meta.env.BASE_URL}assets/tripo/${id}.glb?v=${version}`}));
const defaults:Settings={quality:'medium',sensitivity:1,invertY:false,reducedMotion:false,textScale:1};
let settings={...defaults};try{const saved=JSON.parse(localStorage.getItem('leadership-settings')??'null');if(saved&&typeof saved==='object')settings={...defaults,...saved};}catch{/* A blocked/corrupt preference store must not prevent local gameplay. */}
let world=generateWorld(618),state=createGame(world),query=makeWorldQuery(world),page:Page='home';
let tutorialPage=0,phone=false,loadingStage='',error='',settingsReturn:Page='home',lastPausedAt=-Infinity,visualAssetsReady=false;
let scene:OfficeScene,input:GameInput,ui:{render:(m:UIModel)=>void;destroy:()=>void};
const host=document.querySelector<HTMLElement>('#scene')!,uiRoot=document.querySelector<HTMLElement>('#ui')!;
const metrics=new FrameMetrics();let accumulator=0,last=performance.now(),uiAccumulator=0,loadingToken=0;
const params=new URLSearchParams(location.search),preview=params.get('preview');
function freshSeed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
function show(){ui?.render(bindUI(state,world,{page,version,tutorialPage,settings,loadingStage,error,phone,preview:!!preview}));}
function pause(reason?:string){if(page!=='playing')return;if(reason){state.message=reason;state.messageUntil=state.elapsed+8;}page='paused';lastPausedAt=performance.now();phone=false;input.setEnabled(false);accumulator=0;show();}
function resumeFromKeyboard(key:'Escape'|'Enter'){
 if(page!=='paused')return false;
 // Native lock-loss can arrive before the key event for the same Escape press.
 if(key==='Enter'||performance.now()-lastPausedAt>150)begin();
 return true;
}
function begin(){page='playing';phone=false;input.yaw=state.player.yaw;input.setEnabled(true);void input.lock();last=performance.now();accumulator=0;show();}
function home(){if(!visualAssetsReady){void loadGame(world.seed,'home');return;}loadingToken++;page='home';phone=false;input?.setEnabled(false);state=createGame(world);scene.load(world);world.decorationColliders=scene.getDecorationColliders();query=makeWorldQuery(world);show();}
async function loadGame(seed:number,nextPage:'ready'|'home'='ready'){
 const token=++loadingToken;page='loading';input.setEnabled(false);scene.clear();loadingStage='生成办公室与验证主路线';error='';show();await new Promise(resolve=>requestAnimationFrame(resolve));
 try{
  if(token!==loadingToken)return;
  await runtimeAssets.preload(runtimeSpecs,({completed,total})=>{if(token===loadingToken){loadingStage=`读取本局模型与贴图 · ${completed}/${total}件已就绪`;show();}});
  if(token!==loadingToken)return;
  await characterLibrary.prepare();if(token!==loadingToken)return;
  scene.useRuntimeAssets(runtimeAssets,runtimeSpecs.map(spec=>spec.id));scene.useCharacterLibrary(characterLibrary);visualAssetsReady=true;
  loadingStage='装配正式场景并验证陈设、碰撞与必经路线';show();
  let accepted=false;
  const seeds=[...Array.from({length:20},(_,attempt)=>(seed+attempt)>>>0),618];
  for(const candidate of seeds){
   if(token!==loadingToken)return;
   world=generateWorld(candidate);state=createGame(world);query=makeWorldQuery(world);
   if(!validateWorld(world,state,query).valid)continue;
   scene.load(world);world.decorationColliders=scene.getDecorationColliders();query=makeWorldQuery(world);
   if(scene.getRuleVisuals().characters.some(actor=>actor.assetId==='technical-placeholder'))throw new Error('正式角色未接入，停止加载占位成品。');
   const result=validateWorld(world,state,query);
   if(result.valid){world.validation.push(...result.spawnClockDistances.map(d=>`打卡路线${d.toFixed(1)}m`),...result.spawnExitDistances.map(d=>`出口路线${d.toFixed(1)}m`));accepted=true;break;}
   scene.clear();await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  if(!accepted)throw new Error('正式办公室的陈设与通行路线校验失败，备用种子也未通过。');
  scene.render(state,state.player.yaw,input.pitch,nextPage,1/60);await scene.prepare();if(token!==loadingToken)return;
  loadingStage='本局资源与场景已准备完成';page=nextPage;accumulator=0;show();
 }catch(e){if(token!==loadingToken)return;error=e instanceof Error?e.message:String(e);page='error';show();}
}
function command(cmd:UICommand){
 switch(cmd.type){
  case 'start':void loadGame(freshSeed());break;
  case 'begin':begin();break;
  case 'home':home();break;
  case 'tutorial':page='tutorial';tutorialPage=0;input?.setEnabled(false);show();break;
  case 'tutorial-page':tutorialPage=Math.max(0,Math.min(2,cmd.page));show();break;
  case 'settings':settingsReturn=page==='paused'?'paused':'home';page='settings';input.setEnabled(false);show();break;
  case 'setting':{
   const v=cmd.value;if(cmd.key==='quality'&&['low','medium','high'].includes(String(v)))settings.quality=v as Settings['quality'];
   else if(cmd.key==='sensitivity')settings.sensitivity=Math.max(.25,Math.min(3,Number(v)||1));
   else if(cmd.key==='textScale')settings.textScale=Math.max(.85,Math.min(1.4,Number(v)||1));
   else if(cmd.key==='invertY'||cmd.key==='reducedMotion')settings[cmd.key]=Boolean(v);
   input.updateSettings(settings);scene.updateSettings(settings);try{localStorage.setItem('leadership-settings',JSON.stringify(settings));}catch{/* Preferences are optional. */}show();break;
  }
  case 'resume':if(page==='settings'){page=settingsReturn;show();}else begin();break;
  case 'restart':void loadGame(state.seed);break;
  case 'new-seed':void loadGame(freshSeed());break;
  case 'retry':void loadGame(state.seed);break;
  case 'close-phone':phone=false;input.setPhoneOpen(false);show();break;
 }
}
/** Temporary technical shell only until the user's Kimi UI is handed over. Never presented as Kimi art. */
function technicalShell(root:HTMLElement,onCommand:(c:UICommand)=>void){
 const style=document.createElement('style');style.textContent='html,body{margin:0;overflow:hidden;background:#192c24;color:#eee;font:16px system-ui}#scene{position:fixed;inset:0}canvas{display:block}#ui{position:fixed;inset:0;pointer-events:none}#ui button{pointer-events:auto;font:inherit;padding:12px;margin:4px}#technical{position:absolute;left:24px;top:24px;background:#18332de8;padding:22px;border-radius:8px;max-width:620px}';document.head.append(style);
 const panel=document.createElement('div');panel.id='technical';root.append(panel);let prev='';panel.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest('button');if(b)onCommand({type:b.dataset.command} as UICommand);});
 return {render(m:UIModel){const content=m.page==='playing'?`<b>${m.clock} · ${Math.ceil(m.remaining)}秒</b>　${m.clocked?'已打卡':'未打卡'}<p>${m.objective}</p><p>${m.interaction?.label??'WASD 移动 · Shift 冲刺 · C 蹲 · Space 跳 · Esc 暂停'}</p><p>${m.warning?.quote??m.message}</p><p>${m.bossStatus} ${m.dark?'暗室保护':''}</p>`:`<h1>领导说的都是真的</h1><p>开发预览 · 程序与交互验收中</p><p>${m.page==='loading'?m.loadingStage:m.page==='error'?m.error:'18:00了。先打卡，再想办法下班。'}</p>${m.page==='home'?'<button data-command="start">开始上班</button>':m.page==='ready'?'<button data-command="begin">开始这一局</button>':m.page==='paused'?'<button data-command="resume">继续</button>':m.page==='result'?`<p>${m.ending}</p><button data-command="restart">同种子重玩</button>`:''}<button data-command="home">首页</button><button disabled>多人模式 · 待开发</button>`;if(content!==prev){panel.innerHTML=content;prev=content;}},destroy(){panel.remove();style.remove();}};
}
async function boot(){
 try{
  scene=new OfficeScene(host,settings);input=new GameInput(scene.canvas,settings,pause,()=>{phone=!phone;input.setPhoneOpen(phone);show();},resumeFromKeyboard);input.yaw=state.player.yaw;
  const modules=import.meta.glob('./ui/views.ts');const importer=modules['./ui/views.ts'];if(importer){const actual=await importer() as {createUI:typeof technicalShell};ui=actual.createUI(uiRoot,command);}else ui=technicalShell(uiRoot,command);
  show();
  requestAnimationFrame(frame);
  await loadGame(618,preview==='character'||preview==='scene'?'ready':'home');
 }catch(e){host.textContent='';uiRoot.style.pointerEvents='auto';const message=document.createElement('p');message.textContent=`无法启动3D画面：${e instanceof Error?e.message:String(e)}。请使用支持WebGL2的桌面浏览器并启用硬件加速。`;uiRoot.append(message);}
}
function frame(now:number){
 const realDelta=(now-last)/1000;last=now;const active=page==='playing'&&!document.hidden;
 metrics.frame(now,active,state.elapsed,`${state.boss.mode}/${state.player.pose}/${state.rules.filter(r=>r.phase==='active').map(r=>r.kind).join('+')||'normal'}`);
 const dt=Math.min(.1,Math.max(0,realDelta));
 if(active){accumulator+=dt;let count=0;while(accumulator>=1/60&&count<6){const f=input.frame();stepGame(state,f,1/60,world,query);accumulator-=1/60;count++;if(state.ending){page='result';input.setEnabled(false);phone=false;break;}}}else accumulator=0;
 scene.render(state,input.yaw,input.pitch,page,dt);
 uiAccumulator+=dt;if(uiAccumulator>=.08||page!=='playing'){show();uiAccumulator=0;}
 requestAnimationFrame(frame);
}
// Read-only diagnostics are available for transparent validation. No production teleport/win commands.
Object.defineProperty(window,'__OFFICE__',{value:{getSnapshot:()=>JSON.parse(JSON.stringify({page,state,world,version,visuals:scene?.getRuleVisuals()})),getCharacterDiagnostics:()=>scene?.getCharacterDiagnostics(state),getPerformance:()=>({...metrics.report(),device:scene?.getMetrics(),userAgent:navigator.userAgent,quality:settings.quality,version}),resetPerformance:()=>metrics.reset()},configurable:false});
void boot();
