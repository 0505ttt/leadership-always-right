import { afterEach, expect, it, vi } from 'vitest';
import { GameInput } from '../src/gameplay/input';
import type { Settings } from '../src/contracts/game';

afterEach(()=>vi.unstubAllGlobals());
it('routes Escape to pause or resume once while disabled gameplay keys remain ignored',()=>{
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{pointerLockElement:null,hidden:false});
 vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
 const canvas=new EventTarget() as HTMLCanvasElement;
 const settings:Settings={quality:'medium',sensitivity:1,invertY:false,reducedMotion:false,textScale:1};
 const pause=vi.fn(),resume=vi.fn(()=>false),input=new GameInput(canvas,settings,pause,()=>{},resume);
 const key=(code:string,repeat=false)=>win.dispatchEvent(Object.assign(new Event('keydown'),{code,repeat}));
 key('KeyW');expect(input.frame().moveZ).toBe(0);
 key('Escape');key('Escape',true);expect(resume).toHaveBeenCalledTimes(1);expect(pause).not.toHaveBeenCalled();
 input.setEnabled(true);key('Escape');key('Escape',true);
 expect(pause).toHaveBeenCalledTimes(1);expect(resume).toHaveBeenCalledTimes(1);
 input.dispose();key('Escape');expect(resume).toHaveBeenCalledTimes(1);
});

it('only consumes Enter when the app accepts keyboard resume',()=>{
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{pointerLockElement:null,hidden:false});
 vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
 const resume=vi.fn(()=>false),settings:Settings={quality:'medium',sensitivity:1,invertY:false,reducedMotion:false,textScale:1};
 const input=new GameInput(new EventTarget() as HTMLCanvasElement,settings,()=>{},()=>{},resume);
 const key=()=>{const event=Object.assign(new Event('keydown',{cancelable:true}),{code:'Enter',repeat:false});win.dispatchEvent(event);return event;};
 expect(key().defaultPrevented).toBe(false);
 resume.mockReturnValue(true);expect(key().defaultPrevented).toBe(true);
 expect(resume).toHaveBeenLastCalledWith('Enter');
 resume.mockClear();
 const buttonEvent=Object.assign(new Event('keydown',{cancelable:true}),{code:'Enter',repeat:false});
 Object.defineProperty(buttonEvent,'target',{value:{closest:()=>({tagName:'BUTTON'})}});
 win.dispatchEvent(buttonEvent);
 expect(buttonEvent.defaultPrevented).toBe(false);expect(resume).not.toHaveBeenCalled();input.dispose();
});

it('releases a late pointer lock when the game paused while permission was pending',async()=>{
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{pointerLockElement:null as EventTarget|null,hidden:false,exitPointerLock:vi.fn(()=>{doc.pointerLockElement=null;})});
 vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
 let resolve!:()=>void;const pending=new Promise<void>(done=>{resolve=done;});
 const canvas=Object.assign(new EventTarget(),{requestPointerLock:async()=>{await pending;doc.pointerLockElement=canvas;}});
 const settings:Settings={quality:'medium',sensitivity:1,invertY:false,reducedMotion:false,textScale:1};
 const input=new GameInput(canvas as HTMLCanvasElement,settings,()=>{},()=>{});
 input.setEnabled(true);const lock=input.lock();input.setEnabled(false);resolve();
 expect(await lock).toBe(false);expect(doc.pointerLockElement).toBeNull();expect(doc.exitPointerLock).toHaveBeenCalledOnce();input.dispose();
});
