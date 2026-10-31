export const GRID = 60;
export const SEGMENTS = GRID * 30;
export const LINE_WIDTHS = [.38, 1.12, 2.28, 3.8] as const;
export const LINE_ALPHAS = [.15, .64, .93, 1] as const;
export type Band = 0 | 1 | 2 | 3;
export const quantize = (value: number): Band => value < .12 ? 0 : value < .42 ? 1 : value < .89 ? 2 : 3;

/** One shared reproducible lattice. Animation never calls Math.random. */
export function createNoise(seed = 7319): Float32Array {
  const values = new Float32Array(128 * 128);
  let state = seed | 0;
  for (let i = 0; i < values.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    values[i] = (state >>> 0) / 4294967295 * 2 - 1;
  }
  return values;
}
const NOISE = createNoise();
const smooth = (value: number) => value * value * (3 - 2 * value);
export function noiseAt(x: number, y: number, lattice = NOISE): number {
  const ix = Math.floor(x), iy = Math.floor(y), tx = smooth(x - ix), ty = smooth(y - iy);
  const value = (dx: number, dy: number) => lattice[((iy + dy) & 127) * 128 + ((ix + dx) & 127)];
  const a = value(0, 0) * (1 - tx) + value(1, 0) * tx;
  const b = value(0, 1) * (1 - tx) + value(1, 1) * tx;
  return a * (1 - ty) + b * ty;
}

export interface SampleCanvas {
  width: number; height: number;
  getContext(context: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
}

/** Reads pixels exactly once, then releases the scratch surface and pixel reference. */
export function samplePath(path: string, scale: number, createCanvas: () => SampleCanvas = () => document.createElement('canvas'), createPath: (value: string) => Path2D = value => new Path2D(value)): Float32Array {
  const canvas = createCanvas(); canvas.width = canvas.height = GRID * 5;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器不支持 Canvas 2D。');
    context.fillStyle = '#000'; context.fillRect(0, 0, 300, 300);
    context.translate(150, 150); context.scale(300 * scale / 24, 300 * scale / 24); context.translate(-12, -12);
    context.fillStyle = '#fff'; context.fill(createPath(path));
    const pixels = context.getImageData(0, 0, 300, 300).data;
    const field = new Float32Array(GRID * GRID);
    for (let row = 0; row < GRID; row++) for (let col = 0; col < GRID; col++) {
      let sum = 0;
      for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
        const offset = ((row * 5 + y) * 300 + col * 5 + x) * 4;
        sum += (.2126 * pixels[offset] + .7152 * pixels[offset + 1] + .0722 * pixels[offset + 2]) / 255;
      }
      field[row * GRID + col] = sum / 25;
    }
    return field;
  } finally { canvas.width = 0; canvas.height = 0; }
}

export interface Region { x: number; y: number; score: number }
export interface FieldArea { x: number; y: number; width: number }
export interface Pointer { x: number; y: number }

export function detectRegions(field: Float32Array, previous: readonly Region[] = []): Region[] {
  const stride = GRID + 1, integral = new Float64Array(stride * stride);
  for (let y = 0; y < GRID; y++) {
    let row = 0;
    for (let x = 0; x < GRID; x++) { row += field[y * GRID + x]; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row; }
  }
  const candidates: (Region & { ranked: number })[] = [];
  let brightest = 0;
  for (let y = 0; y <= GRID - 7; y++) for (let x = 0; x <= GRID - 7; x++) {
    const score = (integral[(y + 7) * stride + x + 7] - integral[y * stride + x + 7] - integral[(y + 7) * stride + x] + integral[y * stride + x]) / 49;
    brightest = Math.max(brightest, score);
    const cx = x + 3, cy = y + 3;
    const continuity = previous.reduce((best, old) => Math.max(best, .025 * Math.exp(-((cx - old.x) ** 2 + (cy - old.y) ** 2) / 128)), 0);
    candidates.push({ x: cx, y: cy, score, ranked: score + continuity });
  }
  if (brightest < .04) return [];
  candidates.sort((a, b) => b.ranked - a.ranked || a.y - b.y || a.x - b.x);
  const select = (distance: number) => {
    const result: Region[] = [];
    for (const candidate of candidates) {
      if (candidate.score < brightest * .48 || result.some(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) < distance)) continue;
      result.push({ x: candidate.x, y: candidate.y, score: candidate.score });
      if (result.length === 3) break;
    }
    return result;
  };
  const separated = select(16);
  return separated.length >= 2 ? separated : select(12);
}

export interface DetectionSlot {
  x: number; y: number; vx: number; vy: number; alpha: number;
  target: Region | null; pending: Region | null; retiring: boolean;
}
export function createSlots(): DetectionSlot[] {
  return Array.from({ length: 3 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, alpha: 0, target: null, pending: null, retiring: false }));
}

export function matchRegions(slots: DetectionSlot[], regions: readonly Region[], immediate = false): void {
  const unused = new Set(slots.map((_, index) => index));
  const unmatched: Region[] = [];
  for (const region of regions) {
    let choice = -1, distance = 12 + 1e-9;
    for (const index of unused) {
      const target = slots[index].target;
      if (!target) continue;
      const d = Math.hypot(region.x - target.x, region.y - target.y);
      if (d < distance) { choice = index; distance = d; }
    }
    if (choice < 0) { unmatched.push(region); continue; }
    const slot = slots[choice]; unused.delete(choice);
    slot.target = region; slot.pending = null; slot.retiring = false;
  }
  for (const index of unused) {
    const slot = slots[index], next = unmatched.shift() ?? null;
    if (immediate || slot.alpha < .04) {
      slot.target = next; slot.pending = null; slot.retiring = false;
      if (next) { slot.x = next.x; slot.y = next.y; slot.vx = slot.vy = 0; }
    } else { slot.pending = next; slot.retiring = true; }
  }
  if (immediate) for (const slot of slots) {
    slot.alpha = slot.target ? 1 : 0;
    if (slot.target) { slot.x = slot.target.x; slot.y = slot.target.y; slot.vx = slot.vy = 0; }
  }
}

export function stepSlots(slots: DetectionSlot[], dt: number, visible: boolean): void {
  const count = Math.max(1, Math.ceil(dt * 120)), step = dt / count;
  for (const slot of slots) {
    slot.alpha += ((visible && slot.target && !slot.retiring ? 1 : 0) - slot.alpha) * (1 - Math.exp(-dt * 16));
    if (slot.retiring && slot.alpha < .04) {
      slot.target = slot.pending; slot.pending = null; slot.retiring = false;
      if (slot.target) { slot.x = slot.target.x; slot.y = slot.target.y; slot.vx = slot.vy = 0; }
    }
    if (!slot.target) continue;
    for (let i = 0; i < count; i++) {
      slot.vx += ((slot.target.x - slot.x) * 144 - slot.vx * 24) * step;
      slot.vy += ((slot.target.y - slot.y) * 144 - slot.vy * 24) * step;
      slot.x += slot.vx * step; slot.y += slot.vy * step;
    }
    if (Math.abs(slot.x - slot.target.x) + Math.abs(slot.y - slot.target.y) + Math.abs(slot.vx) + Math.abs(slot.vy) < .002) {
      slot.x = slot.target.x; slot.y = slot.target.y; slot.vx = slot.vy = 0;
    }
  }
}

export class LineField {
  readonly brightness = new Float32Array(SEGMENTS);
  readonly dx = new Float32Array(SEGMENTS);
  readonly dy = new Float32Array(SEGMENTS);
  private readonly vx = new Float32Array(SEGMENTS);
  private readonly vy = new Float32Array(SEGMENTS);
  readonly projection = new Float32Array(GRID * GRID);
  readonly slots = createSlots();
  pulse = 0;
  time = 0;
  scans = 0;
  private lastScan = -Infinity;
  private pulsePoint: Pointer | null = null;
  private pointer: Pointer | null = null;
  constructor(readonly source: Float32Array, readonly seed: number) {
    if (source.length !== GRID * GRID) throw new Error('Expected a 60 × 60 luminance field');
  }
  point(pointer: Pointer, force = false): void {
    this.pointer = pointer;
    if (force || !this.pulsePoint || Math.hypot(pointer.x - this.pulsePoint.x, pointer.y - this.pulsePoint.y) > 1.5) {
      this.pulsePoint = { ...pointer }; this.pulse = 1;
    }
  }
  clearPointer(): void { this.pointer = null; this.pulsePoint = null; }
  step(dt: number, area: FieldArea, overlay: boolean, animated: boolean): void {
    if (animated) this.time += dt;
    const cell = area.width / GRID, radius = area.width / 4;
    const substeps = Math.max(1, Math.ceil(dt * 30)), step = dt / substeps;
    for (let index = 0; index < SEGMENTS; index++) {
      const col = index % GRID, row = Math.floor(index / GRID) * 2;
      const base = (this.source[row * GRID + col] + this.source[(row + 1) * GRID + col]) / 2;
      this.brightness[index] = base * .94 + noiseAt(col * .15 + this.seed, row * .16 - this.time * .17) * .12 * (.25 + base * .75);
      if (!animated) { this.dx[index] = this.dy[index] = this.vx[index] = this.vy[index] = 0; continue; }
      let tx = 0, ty = 0;
      if (this.pointer) {
        const x = area.x + (col + .5) * cell - this.pointer.x, y = area.y + (row + 1) * cell - this.pointer.y;
        const distance = Math.hypot(x, y), influence = Math.max(0, 1 - distance / radius) ** 2 * this.pulse * 25;
        if (distance > .0001) { tx = x / distance * influence; ty = y / distance * influence * .58; }
      }
      for (let part = 0; part < substeps; part++) {
        this.vx[index] += ((tx - this.dx[index]) * 145 - this.vx[index] * 19) * step;
        this.vy[index] += ((ty - this.dy[index]) * 145 - this.vy[index] * 19) * step;
        this.dx[index] += this.vx[index] * step; this.dy[index] += this.vy[index] * step;
      }
    }
    this.pulse = animated ? this.pulse * Math.exp(-dt * 5.5) : 0;
    if (overlay && (!animated || this.time - this.lastScan >= .1)) {
      const regions = this.scan(cell);
      matchRegions(this.slots, regions, !animated); this.lastScan = this.time;
    }
    if (animated) stepSlots(this.slots, dt, overlay);
    else if (!overlay) for (const slot of this.slots) slot.alpha = 0;
  }
  private scan(cell: number): Region[] {
    this.projection.fill(0);
    const accumulate = (x: number, y: number, value: number) => {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
        const col = ix + ox, row = iy + oy;
        if (col >= 0 && col < GRID && row >= 0 && row < GRID) this.projection[row * GRID + col] += value * (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy);
      }
    };
    for (let index = 0; index < SEGMENTS; index++) {
      const x = index % GRID + this.dx[index] / cell, y = Math.floor(index / GRID) * 2 + this.dy[index] / cell;
      const value = Math.max(0, this.brightness[index]);
      accumulate(x, y, value); accumulate(x, y + 1, value);
    }
    this.scans++;
    return detectRegions(this.projection, this.slots.flatMap(slot => slot.target ? [slot.target] : []));
  }
}

/** One owner for scheduling. Pausing invalidates once and leaves no queued animation. */
export class FrameLoop {
  private request: number | null = null;
  private last: number | null = null;
  private disposed = false;
  private state = { motion: true, visible: true, intersecting: true, modal: false };
  constructor(private draw: (dt: number, animated: boolean) => void, private raf: (callback: FrameRequestCallback) => number = callback => window.requestAnimationFrame(callback), private cancel: (id: number) => void = id => window.cancelAnimationFrame(id)) {}
  get scheduled(): boolean { return this.request !== null; }
  set(state: Partial<typeof this.state>): void {
    if (!Object.entries(state).some(([key, value]) => this.state[key as keyof typeof this.state] !== value)) return;
    Object.assign(this.state, state); this.invalidate();
  }
  private get visible(): boolean { return this.state.visible && this.state.intersecting; }
  private get animating(): boolean { return this.visible && this.state.motion && !this.state.modal; }
  invalidate(): void {
    if (this.disposed) return;
    if (!this.animating) {
      if (this.request !== null) this.cancel(this.request);
      this.request = null; this.last = null;
      if (this.visible) this.draw(0, false);
    } else if (this.request === null) this.request = this.raf(this.tick);
  }
  private tick = (now: number): void => {
    this.request = null;
    if (this.disposed || !this.animating) return;
    const dt = this.last === null ? 1 / 60 : Math.min(.05, Math.max(0, (now - this.last) / 1000));
    this.last = now; this.draw(dt, true); this.invalidate();
  };
  dispose(): void { this.disposed = true; if (this.request !== null) this.cancel(this.request); this.request = null; this.last = null; }
}
