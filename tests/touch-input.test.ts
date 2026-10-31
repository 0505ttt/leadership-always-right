import {afterEach,describe,expect,it,vi} from 'vitest';
import {TouchInputState} from '../src/gameplay/touch-state';
import {GameInput} from '../src/gameplay/input';
import type {Settings} from '../src/contracts/game';
const point=(x:number,y:number)=>({x,y});
const active=()=>{const state=new TouchInputState();state.setEnabled(true);return state;};

describe('independent touch pointer ownership',()=>{
 it('walks, looks and holds a timed interaction simultaneously',()=>{
  const state=active();state.startMove(1,point(0,0),point(0,0));state.startLook(2,point(150,90));state.startAction(3,'interact');
  state.move(1,point(48,-48));state.move(2,point(164,81));
  const frame=state.consume();expect(Math.hypot(frame.moveX,frame.moveZ)).toBeCloseTo(1);expect(frame.moveZ).toBeGreaterThan(0);expect(frame.lookX).toBe(14);expect(frame.lookY).toBe(-9);expect(frame.held.has('interact')).toBe(true);expect(frame.pressed.has('interact')).toBe(true);
  const next=state.consume();expect(next.lookX).toBe(0);expect(next.pressed.size).toBe(0);expect(next.held.has('interact')).toBe(true);
 });
 it('up/cancel/lost capture of one pointer leaves other fingers active',()=>{
  const state=active();state.startMove(1,point(48,0),point(0,0));state.startLook(2,point(100,20));state.startAction(3,'sprint');state.startAction(4,'aim');state.release(3);
  let frame=state.consume();expect(frame.held.has('sprint')).toBe(false);expect(frame.held.has('aim')).toBe(true);expect(frame.moveX).toBe(1);
  state.release(1);state.move(1,point(0,-48));state.move(2,point(115,20));frame=state.consume();expect(frame.moveX).toBe(0);expect(frame.lookX).toBe(15);
 });
 it('preserves a short button tap until the next simulation frame only once',()=>{
  const state=active();state.startAction(5,'jump');state.release(5);expect(state.consume().pressed.has('jump')).toBe(true);expect(state.consume().pressed.has('jump')).toBe(false);
 });
 it('does not let a second thumb steal the movement or camera pointer',()=>{
  const state=active();expect(state.startMove(1,point(0,0),point(0,0))).toBe(true);expect(state.startMove(2,point(0,0),point(0,0))).toBe(false);expect(state.startLook(3,point(0,0))).toBe(true);expect(state.startLook(4,point(0,0))).toBe(false);expect(state.startAction(1,'jump')).toBe(false);
 });
 it('two fingers on the same held action do not double-trigger or release each other',()=>{
  const state=active();state.startAction(1,'interact');expect(state.consume().pressed.has('interact')).toBe(true);state.startAction(2,'interact');expect(state.consume().pressed.size).toBe(0);state.release(1);expect(state.consume().held.has('interact')).toBe(true);state.release(2);expect(state.consume().held.has('interact')).toBe(false);
 });
 it('clears held, queued and camera input on modal/background/rotation; stale moves stay inert',()=>{
  const state=active();state.startMove(1,point(48,0),point(0,0));state.startLook(2,point(20,20));state.startAction(3,'throw');state.move(2,point(50,60));state.setEnabled(false);
  expect(state.startAction(4,'jump')).toBe(false);state.setEnabled(true);state.move(1,point(48,-48));state.move(2,point(99,99));
  const frame=state.consume();expect(frame).toMatchObject({moveX:0,moveZ:0,lookX:0,lookY:0});expect(frame.held.size).toBe(0);expect(frame.pressed.size).toBe(0);
 });
 it('cancellation drops an unconsumed action and look delta without inventing a final tap',()=>{
  const state=active();state.startAction(1,'throw');state.startLook(2,point(10,10));state.move(2,point(90,20));state.cancel(1);state.cancel(2);const frame=state.consume();expect(frame.pressed.size).toBe(0);expect(frame.lookX).toBe(0);expect(state.startMove(3,point(NaN,0),point(0,0))).toBe(false);expect(state.startLook(4,point(Infinity,0))).toBe(false);
 });
 it('centers the joystick with a dead zone and bounds diagonal speed',()=>{
  const state=active();state.startMove(1,point(2,2),point(0,0));expect(state.consume().moveX).toBe(0);state.move(1,point(900,900));const frame=state.consume();expect(Math.hypot(frame.moveX,frame.moveZ)).toBeCloseTo(1);state.clear();expect(state.movement()).toEqual({x:0,y:0});
 });
});

afterEach(()=>vi.unstubAllGlobals());
function browser(coarse=false){
 const media=Object.assign(new EventTarget(),{matches:coarse});
 const win=Object.assign(new EventTarget(),{matchMedia:()=>media});
 const doc=Object.assign(new EventTarget(),{pointerLockElement:null,hidden:false});
 vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
 const canvas=Object.assign(new EventTarget(),{requestPointerLock:vi.fn()});
 const settings:Settings={quality:'medium',sensitivity:1,invertY:false,reducedMotion:false,textScale:1};
 const pause=vi.fn(),input=new GameInput(canvas as unknown as HTMLCanvasElement,settings,pause,()=>{});
 return {input,canvas,win,doc,pause};
}
it('enters on a coarse pointer without requesting desktop pointer lock',async()=>{
 const {input,canvas}=browser(true);input.setEnabled(true);expect(input.touchMode).toBe(true);expect(await input.lock()).toBe(true);expect(canvas.requestPointerLock).not.toHaveBeenCalled();input.dispose();
});
it('recognizes a start-button touch before its click and ignores synthetic mouse input',async()=>{
 const {input,canvas,doc}=browser();doc.dispatchEvent(Object.assign(new Event('pointerdown'),{pointerType:'touch'}));input.setEnabled(true);expect(await input.lock()).toBe(true);canvas.dispatchEvent(Object.assign(new Event('mousedown'),{button:0}));expect(input.frame().throwPressed).toBe(false);expect(canvas.requestPointerLock).not.toHaveBeenCalled();input.dispose();
});
it('desktop F opens a computer only on the rising edge and modal mode isolates input',()=>{
 const {input,win}=browser();input.setEnabled(true);
 const key=(code:string,repeat=false)=>win.dispatchEvent(Object.assign(new Event('keydown'),{code,repeat}));
 key('KeyF');expect(input.frame().computerPressed).toBe(true);key('KeyF',true);expect(input.frame().computerPressed).toBe(false);input.setEnabled(false);key('KeyW');key('KeyF');expect(input.frame()).toMatchObject({moveZ:0,computerPressed:false});input.dispose();
});
it('rotation and blur clear previously held keyboard actions as well',()=>{
 const {input,win,pause}=browser(true);input.setEnabled(true);win.dispatchEvent(Object.assign(new Event('keydown'),{code:'KeyW',repeat:false}));expect(input.frame().moveZ).toBe(1);win.dispatchEvent(new Event('orientationchange'));expect(input.frame().moveZ).toBe(0);win.dispatchEvent(Object.assign(new Event('keydown'),{code:'KeyE',repeat:false}));win.dispatchEvent(new Event('blur'));expect(input.frame().interact).toBe(false);expect(pause).toHaveBeenCalledOnce();input.dispose();
});
