import { TouchInputState, type TouchAction } from './touch-state';
import { touchActionGroups } from './touch-actions';
import './touch-controls.css';

const actions: readonly { action: TouchAction; label: string; help: string }[] = [
  { action: 'interact', label: '交互', help: '交互；打卡、开门、开关灯需要按住' },
  { action: 'sprint', label: '奔跑', help: '按住奔跑' },
  { action: 'jump', label: '跳跃', help: '跳跃' },
  { action: 'crouch', label: '蹲下', help: '切换蹲下或站立' },
  { action: 'pot', label: '持锅', help: '取下或收回责任锅' },
  { action: 'aim', label: '瞄准', help: '按住瞄准' },
  { action: 'throw', label: '甩出', help: '甩锅或投出手中物品' },
  { action: 'drop', label: '放下', help: '放下手中物品' },
  { action: 'computer', label: '电脑', help: '打开附近电脑' },
];
const actionButton = (action: TouchAction) => {
  const item = actions.find(candidate => candidate.action === action)!;
  return `<button type="button" data-touch-action="${item.action}" aria-label="${item.help}">${item.label}</button>`;
};

export interface TouchControls {
  setEnabled(enabled: boolean): void;
  clear(): void;
  destroy(): void;
}

/** A control adapter only: state stays in GameInput/TouchInputState and Kimi owns the game's visual theme. */
export function createTouchControls(canvas: HTMLCanvasElement, state: TouchInputState, callbacks: { pause(): void; phone(): void; activate(): void }): TouchControls {
  const root = document.createElement('div');
  root.className = 'touch-controls';root.hidden = true;
  root.setAttribute('aria-label', '触控操作');
  root.innerHTML = `<div class="touch-toolbar"><button type="button" data-touch-menu="pause" aria-label="暂停游戏">暂停</button><button type="button" data-touch-menu="phone" aria-label="查看规则记录">规则</button></div><div class="touch-stick" role="group" aria-label="移动摇杆"><span class="touch-stick__label">移动</span><span class="touch-stick__knob" aria-hidden="true"></span></div><span class="touch-look-hint" aria-hidden="true">右侧空白处滑动观察</span><div class="touch-actions"><div class="touch-actions__more" hidden>${touchActionGroups.secondary.map(actionButton).join('')}</div><div class="touch-actions__primary">${touchActionGroups.primary.map(actionButton).join('')}<button type="button" data-touch-menu="actions" aria-label="展开更多动作" aria-expanded="false">动作</button></div></div>`;
  document.body.append(root);
  const moreActions = root.querySelector<HTMLElement>('.touch-actions__more')!;
  const actionsToggle = root.querySelector<HTMLButtonElement>('[data-touch-menu="actions"]')!;
  const stick = root.querySelector<HTMLElement>('.touch-stick')!;
  const knob = root.querySelector<HTMLElement>('.touch-stick__knob')!;
  const captures = new Map<number, HTMLElement>();
  const disposers: (() => void)[] = [];
  const previousTouchAction = canvas.style.touchAction;
  let enabled = false;
  const listen = (target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions) => {
    target.addEventListener(type, listener, options); disposers.push(() => target.removeEventListener(type, listener, options));
  };
  const display = () => {
    const point = state.movement();
    knob.style.transform = `translate(${point.x * 34}px, ${point.y * 34}px)`;
    for (const button of root.querySelectorAll<HTMLElement>('[data-touch-action]')) {
      button.classList.toggle('is-held', [...captures.values()].some(element => element === button));
    }
  };
  const capture = (event: PointerEvent, element: HTMLElement) => {
    captures.set(event.pointerId, element);
    try { element.setPointerCapture(event.pointerId); } catch { /* Window up/cancel still clears ownership if capture is unavailable. */ }
    display();
  };
  const release = (id: number) => {
    state.release(id);
    const element = captures.get(id);captures.delete(id);
    try { if (element?.hasPointerCapture(id)) element.releasePointerCapture(id); } catch { /* Pointer may already have been cancelled by the browser. */ }
    display();
  };
  const clear = () => {
    state.clear();
    for (const id of [...captures.keys()]) release(id);
    display();
  };
  const handleMenu = (menu: string) => {
    if (menu === 'actions') {
      const expanded = moreActions.hidden;
      moreActions.hidden = !expanded;
      actionsToggle.textContent = expanded ? '收起' : '动作';
      actionsToggle.setAttribute('aria-expanded', String(expanded));
      actionsToggle.setAttribute('aria-label', expanded ? '收起更多动作' : '展开更多动作');
      return;
    }
    clear();menu === 'pause' ? callbacks.pause() : callbacks.phone();
  };
  const onStick = (event: PointerEvent) => {
    if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = stick.getBoundingClientRect();
    if (!state.startMove(event.pointerId, {x:event.clientX,y:event.clientY}, {x:rect.left+rect.width/2,y:rect.top+rect.height/2}, Math.max(24,rect.width*.4))) return;
    event.preventDefault();event.stopPropagation();capture(event,stick);
  };
  listen(stick, 'pointerdown', onStick as EventListener);
  listen(root, 'pointerdown', ((event: PointerEvent) => {
    if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const target = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!target) return;
    event.preventDefault();event.stopPropagation();
    const menu = target.dataset.touchMenu;
    if (menu) { handleMenu(menu); return; }
    const action = target.dataset.touchAction as TouchAction;
    if (state.startAction(event.pointerId, action)) capture(event,target);
  }) as EventListener);
  // Native keyboard activation still works. Pointer activation is handled above, so its click is ignored.
  listen(root, 'click', ((event: MouseEvent) => {
    if (!enabled || event.detail !== 0) return;
    const button = (event.target as Element).closest<HTMLButtonElement>('button');if (!button) return;
    const menu = button.dataset.touchMenu;
    if (menu) { handleMenu(menu); return; }
    const action = button.dataset.touchAction as TouchAction;
    if (state.startAction(-1,action)) state.release(-1);
  }) as EventListener);
  listen(canvas, 'pointerdown', ((event: PointerEvent) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    callbacks.activate();
    if (!enabled) return;
    const rect=canvas.getBoundingClientRect();
    if (event.clientX < rect.left+rect.width*.42) return;
    if (state.startLook(event.pointerId,{x:event.clientX,y:event.clientY})) {
      event.preventDefault();capture(event,canvas);
    }
  }) as EventListener);
  listen(window,'pointermove',((event: PointerEvent) => {
    if (!state.owns(event.pointerId)) return;
    event.preventDefault();state.move(event.pointerId,{x:event.clientX,y:event.clientY});display();
  }) as EventListener,{passive:false});
  const finish=((event: PointerEvent)=>{if(state.owns(event.pointerId)||captures.has(event.pointerId))release(event.pointerId);}) as EventListener;
  const cancel=((event:PointerEvent)=>{if(state.owns(event.pointerId)||captures.has(event.pointerId)){state.cancel(event.pointerId);release(event.pointerId);}}) as EventListener;
  listen(window,'pointerup',finish);listen(window,'pointercancel',cancel);
  listen(root,'lostpointercapture',cancel);listen(canvas,'lostpointercapture',cancel);
  listen(root,'contextmenu',(event=>event.preventDefault()) as EventListener);
  return {
    setEnabled(value) {
      if (enabled===value) return;
      enabled=value;root.hidden=!enabled;state.setEnabled(enabled);
      canvas.style.touchAction=enabled?'none':previousTouchAction;
      if (!enabled) clear();
    },
    clear,
    destroy() { enabled=false;clear();state.setEnabled(false);canvas.style.touchAction=previousTouchAction;disposers.forEach(dispose=>dispose());root.remove(); },
  };
}
