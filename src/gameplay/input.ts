import type { InputFrame, Settings } from '../contracts/game';
import { TouchInputState } from './touch-state';
import { createTouchControls, type TouchControls } from './touch-controls';

/** Browser input belongs to the app, not UI presentation. A pointer-lock click never throws. */
export class GameInput {
 yaw=0; pitch=-.08;
 private keys=new Set<string>();private pressed=new Set<string>();private mouse=new Set<number>();private shots=false;private disposers:(()=>void)[]=[];
 private readonly touch=new TouchInputState();private touchControls?:TouchControls;
 private coarsePointer=false;private usedTouch=false;
 enabled=false; private phoneOpen=false;private lockEpoch=0;
 get touchMode():boolean{return this.coarsePointer||this.usedTouch;}
 constructor(private canvas:HTMLCanvasElement,private settings:Settings,private onPause:(reason?:string)=>void,private onPhone:()=>void,private onResume?:(key:'Escape'|'Enter')=>boolean){
  const listen=(target:EventTarget,type:string,listener:EventListener,options?:AddEventListenerOptions)=>{target.addEventListener(type,listener,options);this.disposers.push(()=>target.removeEventListener(type,listener,options));};
  if(typeof window.matchMedia==='function'){
   const coarse=window.matchMedia('(pointer: coarse)');this.coarsePointer=coarse.matches;
   const changed=()=>{const before=this.touchMode;this.coarsePointer=coarse.matches;if(before!==this.touchMode)this.inputModeChanged();};
   coarse.addEventListener('change',changed);this.disposers.push(()=>coarse.removeEventListener('change',changed));
  }
  if(typeof document.createElement==='function'&&document.body){
   this.touchControls=createTouchControls(canvas,this.touch,{pause:()=>this.onPause(),phone:()=>this.onPhone(),activate:()=>this.activateTouch()});
  }
  // Observe the start/resume tap before its click handler requests pointer lock.
  listen(document,'pointerdown',((e:PointerEvent)=>{if(e.pointerType==='touch'||e.pointerType==='pen')this.activateTouch();}) as EventListener,{capture:true});
  listen(window,'keydown',((e:KeyboardEvent)=>{
   if(e.code==='Escape'){if(!e.repeat){if(this.enabled)this.onPause();else this.onResume?.('Escape');}return;}
   const target=e.target as Element|null;
   const editable=typeof target?.closest==='function'&&target.closest('input,select,textarea,[contenteditable]');
   if(!this.enabled){
    const interactive=typeof target?.closest==='function'&&target.closest('button,a,input,select,textarea,[contenteditable],[role="button"]');
    if(e.code==='Enter'&&!e.repeat&&!interactive&&this.onResume?.('Enter'))e.preventDefault();
    return;
   }
   if(editable)return;
   if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ControlLeft','ControlRight'].includes(e.code))e.preventDefault();
   if(e.code==='Tab'&&!e.repeat){this.onPhone();return;}if(this.phoneOpen)return;
   if(!e.repeat&&!this.keys.has(e.code))this.pressed.add(e.code);this.keys.add(e.code);
  }) as EventListener);
  listen(window,'keyup',((e:KeyboardEvent)=>{this.keys.delete(e.code);}) as EventListener);
  listen(canvas,'mousedown',((e:MouseEvent)=>{if(!this.enabled||this.phoneOpen||this.touchMode)return;if(document.pointerLockElement!==canvas){void this.lock();return;}e.preventDefault();this.mouse.add(e.button);if(e.button===0)this.shots=true;}) as EventListener);
  listen(window,'mouseup',((e:MouseEvent)=>{this.mouse.delete(e.button);}) as EventListener);
  listen(canvas,'contextmenu',(e=>e.preventDefault()) as EventListener);
  listen(document,'mousemove',((e:MouseEvent)=>{if(!this.enabled||this.phoneOpen||this.touchMode||document.pointerLockElement!==canvas)return;this.look(e.movementX,e.movementY,.0022);}) as EventListener);
  listen(document,'pointerlockchange',(()=>{if(this.enabled&&!this.phoneOpen&&!this.touchMode&&document.pointerLockElement!==canvas)this.onPause();}) as EventListener);
  listen(window,'blur',(()=>{this.clear();if(this.enabled)this.onPause();}) as EventListener);
  listen(document,'visibilitychange',(()=>{if(document.hidden){this.clear();if(this.enabled)this.onPause();}}) as EventListener);
  // Rotation can cancel only some fingers in mobile browsers. Clear all ownership together.
  listen(window,'orientationchange',(()=>this.clear()) as EventListener);
  if(window.screen?.orientation)listen(window.screen.orientation,'change',(()=>this.clear()) as EventListener);
  this.syncTouchControls();
 }
 private look(x:number,y:number,gain:number){
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  this.yaw-=x*gain*this.settings.sensitivity;
  this.pitch=Math.max(-.7,Math.min(.5,this.pitch+y*gain*this.settings.sensitivity*(this.settings.invertY?1:-1)));
 }
 private activateTouch(){if(this.usedTouch)return;const wasTouch=this.touchMode;this.usedTouch=true;if(!wasTouch)this.inputModeChanged();}
 private inputModeChanged(){
  this.lockEpoch++;this.clear();
  if(this.touchMode&&document.pointerLockElement===this.canvas)document.exitPointerLock();
  this.syncTouchControls();
 }
 private syncTouchControls(){const active=this.enabled&&!this.phoneOpen&&this.touchMode;this.touch.setEnabled(active);this.touchControls?.setEnabled(active);}
 updateSettings(settings:Settings){this.settings=settings;}
 async lock(){
  const epoch=++this.lockEpoch;if(!this.enabled||this.phoneOpen)return false;
  if(this.touchMode){this.syncTouchControls();return true;}
  try{
   await this.canvas.requestPointerLock();
   if(!this.enabled||this.phoneOpen||this.touchMode){if(document.pointerLockElement===this.canvas)document.exitPointerLock();return false;}
   if(epoch!==this.lockEpoch)return false;
   if(document.pointerLockElement!==this.canvas)throw new Error('pointer lock unavailable');return true;
  }catch{
   if(epoch!==this.lockEpoch||!this.enabled||this.phoneOpen||this.touchMode)return false;
   if(document.pointerLockElement===this.canvas)return true;
   this.onPause('鼠标未能锁定。请按 Enter 或点击继续；浏览器需允许鼠标控制。');return false;
  }
 }
 setPhoneOpen(open:boolean){this.phoneOpen=open;this.clear();this.syncTouchControls();if(open){this.lockEpoch++;if(document.pointerLockElement===this.canvas)document.exitPointerLock();}else if(this.enabled)void this.lock();}
 setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled){this.lockEpoch++;this.phoneOpen=false;this.clear();if(document.pointerLockElement===this.canvas)document.exitPointerLock();}this.syncTouchControls();}
 clear(){this.keys.clear();this.pressed.clear();this.mouse.clear();this.shots=false;this.touch.clear();this.touchControls?.clear();}
 frame():InputFrame {
  const k=this.keys,p=this.pressed,touch=this.touch.consume();
  if(this.enabled&&!this.phoneOpen)this.look(touch.lookX,touch.lookY,.0034);
  const frame:InputFrame={moveX:Number(k.has('KeyD'))-Number(k.has('KeyA'))+touch.moveX,moveZ:Number(k.has('KeyW'))-Number(k.has('KeyS'))+touch.moveZ,yaw:this.yaw,sprint:k.has('ShiftLeft')||k.has('ShiftRight')||touch.held.has('sprint'),crouchPressed:p.has('KeyC')||p.has('ControlLeft')||p.has('ControlRight')||touch.pressed.has('crouch'),jumpPressed:p.has('Space')||touch.pressed.has('jump'),interact:k.has('KeyE')||touch.held.has('interact'),interactPressed:p.has('KeyE')||touch.pressed.has('interact'),potPressed:p.has('KeyQ')||touch.pressed.has('pot'),dropPressed:p.has('KeyR')||touch.pressed.has('drop'),throwPressed:this.shots||touch.pressed.has('throw'),aim:this.mouse.has(2)||touch.held.has('aim'),computerPressed:p.has('KeyF')||touch.pressed.has('computer')};
  p.clear();this.shots=false;return frame;
 }
 dispose(){this.setEnabled(false);this.touchControls?.destroy();this.disposers.forEach(dispose=>dispose());}
}
