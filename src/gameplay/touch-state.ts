export type TouchAction = 'sprint' | 'interact' | 'crouch' | 'jump' | 'pot' | 'drop' | 'throw' | 'aim' | 'computer';
export interface TouchFrame {
  moveX: number; moveZ: number; lookX: number; lookY: number;
  held: ReadonlySet<TouchAction>; pressed: ReadonlySet<TouchAction>;
}
type Point = { x: number; y: number };
type Pointer = { kind: 'move'; origin: Point; point: Point; radius: number }
  | { kind: 'look'; point: Point }
  | { kind: 'action'; action: TouchAction };

/** Pointer ownership is independent from the DOM, so unrelated fingers cannot release a held action. */
export class TouchInputState {
  private enabled = false;
  private pointers = new Map<number, Pointer>();
  private pressed = new Set<TouchAction>();
  private look = { x: 0, y: 0 };

  setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled || !enabled) this.clear();
    this.enabled = enabled;
  }

  startMove(id: number, point: Point, origin: Point, radius = 48): boolean {
    if (!this.canStart(id) || !this.finite(point) || !this.finite(origin) || !Number.isFinite(radius) || radius <= 0 || this.hasKind('move')) return false;
    this.pointers.set(id, { kind: 'move', point: { ...point }, origin: { ...origin }, radius });
    return true;
  }

  startLook(id: number, point: Point): boolean {
    if (!this.canStart(id) || !this.finite(point) || this.hasKind('look')) return false;
    this.pointers.set(id, { kind: 'look', point: { ...point } });
    return true;
  }

  startAction(id: number, action: TouchAction): boolean {
    if (!this.canStart(id)) return false;
    // A second finger can sustain the action but does not double-trigger its rising edge.
    if (!this.isHeld(action)) this.pressed.add(action);
    this.pointers.set(id, { kind: 'action', action });
    return true;
  }

  move(id: number, point: Point): void {
    if (!this.enabled || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const pointer = this.pointers.get(id);
    if (!pointer || pointer.kind === 'action') return;
    if (pointer.kind === 'look') {
      this.look.x += point.x - pointer.point.x;
      this.look.y += point.y - pointer.point.y;
    }
    pointer.point = { ...point };
  }

  release(id: number): void { this.pointers.delete(id); }
  cancel(id: number): void {
    const pointer=this.pointers.get(id);this.pointers.delete(id);
    if(pointer?.kind==='action'&&!this.isHeld(pointer.action))this.pressed.delete(pointer.action);
    if(pointer?.kind==='look')this.look={x:0,y:0};
  }
  owns(id: number): boolean { return this.pointers.has(id); }
  clear(): void { this.pointers.clear(); this.pressed.clear(); this.look = { x: 0, y: 0 }; }

  movement(): Point {
    const pointer = [...this.pointers.values()].find(p => p.kind === 'move');
    if (!this.enabled || !pointer || pointer.kind !== 'move') return { x: 0, y: 0 };
    const x = (pointer.point.x - pointer.origin.x) / pointer.radius;
    const y = (pointer.point.y - pointer.origin.y) / pointer.radius;
    const length = Math.hypot(x, y);
    // A small radial dead zone prevents accidental walking while resting a thumb.
    if (length <= .12) return { x: 0, y: 0 };
    const magnitude = Math.min(1, (length - .12) / .88);
    return { x: x / length * magnitude, y: y / length * magnitude };
  }

  consume(): TouchFrame {
    const point = this.movement();
    const held = new Set<TouchAction>();
    if (this.enabled) for (const pointer of this.pointers.values()) if (pointer.kind === 'action') held.add(pointer.action);
    const frame: TouchFrame = { moveX: point.x, moveZ: point.y ? -point.y : 0, lookX: this.look.x, lookY: this.look.y, held, pressed: new Set(this.pressed) };
    this.pressed.clear(); this.look = { x: 0, y: 0 };
    return frame;
  }

  private finite(point:Point):boolean { return Number.isFinite(point.x)&&Number.isFinite(point.y); }
  private canStart(id: number): boolean { return this.enabled && Number.isFinite(id) && !this.pointers.has(id); }
  private hasKind(kind: Pointer['kind']): boolean { return [...this.pointers.values()].some(pointer => pointer.kind === kind); }
  private isHeld(action: TouchAction): boolean { return [...this.pointers.values()].some(pointer => pointer.kind === 'action' && pointer.action === action); }
}
