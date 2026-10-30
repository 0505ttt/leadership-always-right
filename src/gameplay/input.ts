import type { InputFrame, Settings } from '../contracts/game';
/** Browser input belongs to the app, not UI presentation. A pointer-lock click never throws. */
export class GameInput {
 yaw=0; pitch=-.08;
 private keys=new Set<string>();private pressed=new Set<string>();private mouse=new Set<number>();private shots=false;private disposers:(()=>void)[]=[];
 enabled=false; private phoneOpen=false;
 constructor(private canvas:HTMLCanvasElement,private settings:Settings,private onPause:(reason?:string)=>void,private onPhone:()=>void){
  const listen=(target:EventTarget,type:string,listener:EventListener)=>{target.addEventListener(type,listener);this.disposers.push(()=>target.removeEventListener(type,listener));};
  listen(window,'keydown',((e:KeyboardEvent)=>{
   if(!this.enabled)return;
   if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ControlLeft','ControlRight'].includes(e.code))e.preventDefault();
   if(e.code==='Escape'){this.onPause();return;}if(e.code==='Tab'&&!e.repeat){this.onPhone();return;}if(this.phoneOpen)return;
   if(!this.keys.has(e.code))this.pressed.add(e.code);this.keys.add(e.code);
  }) as EventListener);
  listen(window,'keyup',((e:KeyboardEvent)=>{this.keys.delete(e.code);}) as EventListener);
  listen(canvas,'mousedown',((e:MouseEvent)=>{if(!this.enabled||this.phoneOpen)return;if(document.pointerLockElement!==canvas){void this.lock();return;}e.preventDefault();this.mouse.add(e.button);if(e.button===0)this.shots=true;}) as EventListener);
  listen(window,'mouseup',((e:MouseEvent)=>{this.mouse.delete(e.button);}) as EventListener);
  listen(canvas,'contextmenu',(e=>e.preventDefault()) as EventListener);
  listen(document,'mousemove',((e:MouseEvent)=>{if(!this.enabled||this.phoneOpen||document.pointerLockElement!==canvas)return;const gain=.0022*this.settings.sensitivity;this.yaw-=e.movementX*gain;this.pitch=Math.max(-.7,Math.min(.5,this.pitch+e.movementY*gain*(this.settings.invertY?1:-1)));}) as EventListener);
  listen(document,'pointerlockchange',(()=>{if(this.enabled&&!this.phoneOpen&&document.pointerLockElement!==canvas)this.onPause();}) as EventListener);
  listen(window,'blur',(()=>{this.clear();if(this.enabled)this.onPause();}) as EventListener);
  listen(document,'visibilitychange',(()=>{if(document.hidden){this.clear();if(this.enabled)this.onPause();}}) as EventListener);
 }
 updateSettings(settings:Settings){this.settings=settings;}
 async lock(){try{await this.canvas.requestPointerLock();if(document.pointerLockElement!==this.canvas)throw new Error('pointer lock unavailable');return true;}catch{this.onPause('鼠标未能锁定。请点击继续，再点游戏画面；浏览器需允许鼠标控制。');return false;}}
 setPhoneOpen(open:boolean){this.phoneOpen=open;this.clear();if(open){if(document.pointerLockElement===this.canvas)document.exitPointerLock();}else if(this.enabled)void this.lock();}
 setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled){this.phoneOpen=false;this.clear();if(document.pointerLockElement===this.canvas)document.exitPointerLock();}}
 clear(){this.keys.clear();this.pressed.clear();this.mouse.clear();this.shots=false;}
 frame():InputFrame {
  const k=this.keys,p=this.pressed;
  const frame:InputFrame={moveX:Number(k.has('KeyD'))-Number(k.has('KeyA')),moveZ:Number(k.has('KeyW'))-Number(k.has('KeyS')),yaw:this.yaw,sprint:k.has('ShiftLeft')||k.has('ShiftRight'),crouchPressed:p.has('KeyC')||p.has('ControlLeft')||p.has('ControlRight'),jumpPressed:p.has('Space'),interact:k.has('KeyE'),interactPressed:p.has('KeyE'),potPressed:p.has('KeyQ'),dropPressed:p.has('KeyR'),throwPressed:this.shots,aim:this.mouse.has(2)};
  p.clear();this.shots=false;return frame;
 }
 dispose(){this.setEnabled(false);this.disposers.forEach(dispose=>dispose());}
}
