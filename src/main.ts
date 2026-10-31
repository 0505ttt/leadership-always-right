import { createGame, stepGame } from './rules/game';
import { generateWorld } from './world/generate';
import { makeWorldQuery } from './world/query';
import { validateWorld } from './world/validate';
import { OfficeScene } from './presentation/scene';
import { createCharacterLibrary } from './presentation/characters';
import { GameInput } from './gameplay/input';
import { FrameMetrics } from './gameplay/performance';
import { RuntimeAssets } from './gameplay/assets';
import { runtimeAssetSpecs } from './gameplay/runtime-catalog';
import { createOfficeAudio } from './audio/engine';
import { createAudioObserver } from './audio/observer';
import { createComputerView } from './computer/view';
import { availableComputer,openComputer,closeComputer,advanceComputer,commandComputer } from './computer/game';
import { createLoadingScreen } from './loading/index';
import type { LoadingProgress,LoadingScreen } from './loading/types';
import { bindUI } from './ui/bindings';
import type { Page, Settings, UICommand, UIModel } from './contracts/game';

declare const __BUILD_COMMIT__:string;
const version=__BUILD_COMMIT__;
const runtimeAssets=new RuntimeAssets();
const characterLibrary=createCharacterLibrary({assets:runtimeAssets});
const runtimeSpecs=runtimeAssetSpecs(import.meta.env.BASE_URL,version);
const defaults:Settings={quality:'medium',sensitivity:1,invertY:false,reducedMotion:false,textScale:1,musicVolume:.4,effectsVolume:.75,voiceVolume:.85};
let settings={...defaults};try{const saved=JSON.parse(localStorage.getItem('leadership-settings')??'null');if(saved&&typeof saved==='object')settings={...defaults,...saved};}catch{/* A blocked/corrupt preference store must not prevent local gameplay. */}
let world=generateWorld(618),state=createGame(world),query=makeWorldQuery(world),page:Page='home';
let tutorialPage=0,phone=false,loadingStage='',error='',settingsReturn:Page='home',lastPausedAt=-Infinity,visualAssetsReady=false;
let scene:OfficeScene,input:GameInput,ui:{render:(m:UIModel)=>void;destroy:()=>void};
const audio=createOfficeAudio({music:settings.musicVolume,effects:settings.effectsVolume,voice:settings.voiceVolume});
const audioObserver=createAudioObserver(audio);
let loadingScreen:LoadingScreen,computerView:ReturnType<typeof createComputerView>,loadingProgress:LoadingProgress={stage:'download',completedResources:0,totalResources:runtimeSpecs.length},pendingDestination:'ready'|'home'='home',pausedFromComputer=false,loadingSeed=618;
const host=document.querySelector<HTMLElement>('#scene')!,uiRoot=document.querySelector<HTMLElement>('#ui')!;
const metrics=new FrameMetrics();let accumulator=0,last=performance.now(),uiAccumulator=0,loadingToken=0;
const params=new URLSearchParams(location.search),preview=params.get('preview');
function freshSeed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
function show(){loadingScreen?.setVisible(page==='loading'||page==='ready'||page==='error');if(loadingScreen&&(page==='loading'||page==='ready'||page==='error'))loadingScreen.update(loadingProgress);computerView?.update(page==='computer'?state:{...state,computer:null});uiRoot.style.visibility=(page==='loading'||page==='ready'||page==='error')?'hidden':'';const model=bindUI(state,world,{page,version,tutorialPage,settings,loadingStage,error,phone,preview:!!preview});if(page==='playing'&&availableComputer(state,world,query))model.interaction={label:`${model.interaction?.label??''} · F 使用电脑`,progress:model.interaction?.progress??0};ui?.render(model);}
function pause(reason?:string){if(page!=='playing'&&page!=='computer')return;pausedFromComputer=page==='computer';audio.pause();if(reason){state.message=reason;state.messageUntil=state.elapsed+8;}page='paused';lastPausedAt=performance.now();phone=false;input.setEnabled(false);accumulator=0;show();}
function resumeFromKeyboard(key:'Escape'|'Enter'){
 if(page!=='paused')return false;
 // Native lock-loss can arrive before the key event for the same Escape press.
 if(key==='Enter'||performance.now()-lastPausedAt>150)begin();
 return true;
}
function begin(){void audio.resume();if(pausedFromComputer&&state.computer){pausedFromComputer=false;page='computer';input.setEnabled(false);}else{page='playing';phone=false;input.yaw=state.player.yaw+(state.elapsed===0?Math.PI:0);input.setEnabled(true);void input.lock();}last=performance.now();accumulator=0;show();}
function home(){audioObserver.reset();pausedFromComputer=false;if(!visualAssetsReady){void loadGame(world.seed,'home');return;}loadingToken++;page='home';phone=false;input?.setEnabled(false);state=createGame(world);scene.load(world);world.decorationColliders=scene.getDecorationColliders();query=makeWorldQuery(world);show();}
async function loadGame(seed:number,nextPage:'ready'|'home'='ready'){
 const token=++loadingToken;loadingSeed=seed;pendingDestination=nextPage;audioObserver.reset();closeComputer(state);pausedFromComputer=false;loadingProgress={stage:'download',completedResources:0,totalResources:runtimeSpecs.length,detail:'读取本局必需模型，已成功的资源会复用缓存'};page='loading';input.setEnabled(false);scene.clear();loadingStage='生成办公室与验证主路线';error='';show();await new Promise(resolve=>requestAnimationFrame(resolve));
 try{
  if(token!==loadingToken)return;
  await runtimeAssets.preload(runtimeSpecs,({completed,total,id,phase,failed})=>{if(token===loadingToken){loadingStage=`模型与贴图就绪 ${completed}/${total}`;loadingProgress={stage:phase??loadingProgress.stage,completedResources:completed,totalResources:total,detail:id?`${phase==='parse'?'解析模型与图片':'读取资源'} · ${id}`:loadingStage,failedItems:failed?.map(item=>({...item,label:item.id}))};show();}});
  if(token!==loadingToken)return;
  loadingProgress={...loadingProgress,stage:'audio',detail:'声音合成与本地语音模块已准备；点击进入时启用播放'};show();
  await characterLibrary.prepare();if(token!==loadingToken)return;
  scene.useRuntimeAssets(runtimeAssets,runtimeSpecs.map(spec=>spec.id));scene.useCharacterLibrary(characterLibrary);visualAssetsReady=true;
  loadingStage='装配正式场景并验证陈设、碰撞与必经路线';loadingProgress={...loadingProgress,stage:'scene',detail:loadingStage};show();
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
  input.yaw=state.player.yaw+Math.PI;scene.render(state,input.yaw,input.pitch,'ready',1/60);await scene.prepare(stage=>{loadingProgress={...loadingProgress,stage,detail:stage==='textures'?'上传本局贴图到显存':'预编译本局材质与透明规则着色器'};show();});if(token!==loadingToken)return;
  loadingStage='本局资源与场景已准备完成';loadingProgress={...loadingProgress,stage:'ready',detail:loadingStage,failedItems:[]};page='ready';accumulator=0;show();
 }catch(e){if(token!==loadingToken)return;error=e instanceof Error?e.message:String(e);page='error';loadingProgress={...loadingProgress,stage:'error',detail:error,failedItems:loadingProgress.failedItems?.length?loadingProgress.failedItems:[{id:'scene',label:'场景准备',message:error}]};show();}
}
// Serialize distinct retry clicks: each completed item must update the shared
// failed list before another retry owns the loading generation.
let retryQueue:Promise<void>=Promise.resolve();
const queuedRetries=new Map<string,Promise<void>>();
function retryAsset(id:string):Promise<void>{
 const queued=queuedRetries.get(id);if(queued)return queued;
 const task=retryQueue.then(async()=>{if(page==='error'&&loadingProgress.failedItems?.some(item=>item.id===id))await performAssetRetry(id);});
 retryQueue=task.catch(()=>{});
 queuedRetries.set(id,task);
 void task.finally(()=>{if(queuedRetries.get(id)===task)queuedRetries.delete(id);}).catch(()=>{});
 return task;
}
async function performAssetRetry(id:string){
 const spec=runtimeSpecs.find(item=>item.id===id);
 if(!spec){await loadGame(loadingSeed,pendingDestination);return;}
 const token=++loadingToken,previous=loadingProgress.completedResources;
 page='loading';loadingProgress={...loadingProgress,stage:'download',detail:`重试 ${id}`};show();
 try{
  await runtimeAssets.preload([spec],progress=>{if(token!==loadingToken)return;loadingProgress={...loadingProgress,stage:progress.phase??'parse',completedResources:previous+progress.completed,detail:`重试 ${id}`};show();});
  if(token!==loadingToken)return;
  const failed=loadingProgress.failedItems?.filter(item=>item.id!==id)??[];
  if(failed.length){page='error';loadingProgress={...loadingProgress,stage:'error',failedItems:failed,detail:'此资源已恢复，其余失败项可继续分别重试'};show();}
  else await loadGame(loadingSeed,pendingDestination);
 }catch(cause){if(token!==loadingToken)return;page='error';loadingProgress={...loadingProgress,stage:'error',detail:cause instanceof Error?cause.message:String(cause)};show();}
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
   else if(['musicVolume','effectsVolume','voiceVolume'].includes(cmd.key)){settings[cmd.key as 'musicVolume'|'effectsVolume'|'voiceVolume']=Math.max(0,Math.min(1,Number(v)||0));audio.setVolumes({music:settings.musicVolume,effects:settings.effectsVolume,voice:settings.voiceVolume});}
   else if(cmd.key==='invertY'||cmd.key==='reducedMotion')settings[cmd.key]=Boolean(v);
   input.updateSettings(settings);scene.updateSettings(settings);try{localStorage.setItem('leadership-settings',JSON.stringify(settings));}catch{/* Preferences are optional. */}show();break;
  }
  case 'resume':if(page==='settings'){page=settingsReturn;show();}else begin();break;
  case 'restart':void loadGame(state.seed);break;
  case 'new-seed':void loadGame(freshSeed());break;
  case 'retry':void loadGame(loadingSeed,pendingDestination);break;
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
  computerView=createComputerView(document.body,cmd=>{if(cmd==='close'){closeComputer(state);page='playing';input.setEnabled(true);void input.lock();void audio.resume();last=performance.now();accumulator=0;}else commandComputer(state,cmd);show();});
  loadingScreen=createLoadingScreen(document.body,{onEnter(){void audio.resume();if(pendingDestination==='home'){page='home';show();}else begin();},onRetry:retryAsset,onTutorial(){page='tutorial';show();}});
  window.addEventListener('blur',()=>pause());document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  show();
  requestAnimationFrame(frame);
  await loadGame(618,preview==='character'||preview==='scene'?'ready':'home');
 }catch(e){host.textContent='';uiRoot.style.pointerEvents='auto';const message=document.createElement('p');message.textContent=`无法启动3D画面：${e instanceof Error?e.message:String(e)}。请使用支持WebGL2的桌面浏览器并启用硬件加速。`;uiRoot.append(message);}
}
function frame(now:number){
 const realDelta=(now-last)/1000;last=now;const active=page==='playing'&&!document.hidden;
 metrics.frame(now,active,state.elapsed,`${state.boss.mode}/${state.player.pose}/${state.rules.filter(r=>r.phase==='active').map(r=>r.kind).join('+')||'normal'}`);
 const dt=Math.min(.1,Math.max(0,realDelta));
 if(active){accumulator+=dt;let count=0;while(accumulator>=1/60&&count<6){const f=input.frame();if(f.computerPressed){if(openComputer(state,world,query)){page='computer';input.setEnabled(false);phone=false;accumulator=0;show();break;}state.message='靠近电脑按 F；正在追责或检查时不能打开电脑。';state.messageUntil=state.elapsed+3;}stepGame(state,f,1/60,world,query);accumulator-=1/60;count++;if(state.ending){page='result';input.setEnabled(false);phone=false;break;}}}else accumulator=0;
 if(page==='computer'&&!document.hidden)advanceComputer(state,realDelta);
 audioObserver.update(state,world,query,!document.hidden&&['playing','computer','result'].includes(page));
 if(!['loading','ready','error'].includes(page))scene.render(state,input.yaw,input.pitch,page,dt);
 uiAccumulator+=dt;if(uiAccumulator>=.08||page!=='playing'){show();uiAccumulator=0;}
 requestAnimationFrame(frame);
}
// Read-only diagnostics are available for transparent validation. No production teleport/win commands.
Object.defineProperty(window,'__OFFICE__',{value:{getSnapshot:()=>JSON.parse(JSON.stringify({page,state,world,version,visuals:scene?.getRuleVisuals()})),getAudio:()=>audio.getDiagnostics(),getLoading:()=>loadingScreen?.getDiagnostics(),getComputerAvailable:()=>availableComputer(state,world,query),getCharacterDiagnostics:()=>scene?.getCharacterDiagnostics(state),getPerformance:()=>({...metrics.report(),device:scene?.getMetrics(),userAgent:navigator.userAgent,quality:settings.quality,version}),resetPerformance:()=>metrics.reset()},configurable:false});
void boot();
