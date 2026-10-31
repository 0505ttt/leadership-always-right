import { describe, expect, it, vi } from 'vitest';
import { createNoise, createSlots, detectRegions, FrameLoop, GRID, LINE_ALPHAS, LINE_WIDTHS, LineField, matchRegions, noiseAt, quantize, samplePath, stepSlots } from '../src/loading/field';
import { GAME_SYMBOLS } from '../src/loading/symbols';
import { REFERENCE_SYMBOLS } from '../src/loading/reference-symbols';

describe('quantized loading artwork', () => {
  it('uses exactly four specified bands, including the exact threshold edges', () => {
    expect([-.2, .119999, .12, .419999, .42, .889999, .89, 1.4].map(quantize)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(LINE_WIDTHS).toEqual([.38, 1.12, 2.28, 3.8]); expect(LINE_ALPHAS).toEqual([.15, .64, .93, 1]);
  });
  it('samples each path once with Rec.709 supersampling and destroys its scratch surface', () => {
    const pixels = new Uint8ClampedArray(300 * 300 * 4);
    for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 255; pixels[i + 1] = 128; pixels[i + 2] = 0; pixels[i + 3] = 255; }
    const read = vi.fn(() => ({ data: pixels })), fill = vi.fn();
    const context = { fillRect() {}, translate() {}, scale() {}, fill, getImageData: read } as unknown as CanvasRenderingContext2D;
    const scratch = { width: 0, height: 0, getContext: () => context };
    const source = samplePath('M0 0H24V24H0Z', .82, () => scratch, value => value as unknown as Path2D);
    expect(read).toHaveBeenCalledExactlyOnceWith(0, 0, 300, 300); expect(source).toHaveLength(3600);
    expect(source[0]).toBeCloseTo(.2126 + .7152 * 128 / 255, 6); expect(source[3599]).toBe(source[0]);
    expect(scratch.width).toBe(0); expect(scratch.height).toBe(0);
    const field = new LineField(source, 3);
    field.step(1 / 60, { x: 0, y: 0, width: 300 }, true, true);
    field.step(1 / 60, { x: 0, y: 0, width: 600 }, true, true);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('keeps production artwork original and retains the supplied reference paths separately', () => {
    expect(GAME_SYMBOLS.map(symbol => symbol.id)).toEqual(['pot', 'chair', 'clock']);
    expect(new Set(GAME_SYMBOLS.map(symbol => symbol.path)).size).toBe(3);
    expect(REFERENCE_SYMBOLS.map(symbol => symbol.title)).toEqual(['Apple', 'Google', 'Tesla']);
    expect(REFERENCE_SYMBOLS[0].path.endsWith('3.559-1.701')).toBe(true);
    expect(REFERENCE_SYMBOLS[1].path.endsWith('H12.48z')).toBe(true);
    expect(REFERENCE_SYMBOLS[2].path.endsWith('1.46v.003z')).toBe(true);
  });
  it('reproduces noise across runs and is continuous at wrapped lattice boundaries', () => {
    const a = createNoise(), b = createNoise(); expect(a).toEqual(b); expect(a).toHaveLength(16384);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-1); expect(Math.max(...a)).toBeLessThanOrEqual(1);
    expect(noiseAt(12.3, -1.2, a)).toBeCloseTo(noiseAt(140.3, 126.8, b), 12);
    expect(Math.abs(noiseAt(1 - 1e-6, 4.3) - noiseAt(1 + 1e-6, 4.3))).toBeLessThan(1e-8);
  });
});

function islands(points: { x: number; y: number; value?: number }[]) {
  const field = new Float32Array(GRID * GRID);
  for (const point of points) for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) field[(point.y + y) * GRID + point.x + x] = point.value ?? 1;
  return field;
}
describe('detection and interaction come from the current numerical field', () => {
  it('finds at most three bright separated islands, rejects empty and weak candidates', () => {
    expect(detectRegions(new Float32Array(3600))).toEqual([]);
    const found = detectRegions(islands([{ x: 8, y: 8 }, { x: 30, y: 10 }, { x: 49, y: 39 }, { x: 9, y: 46, value: .2 }]));
    expect(found).toHaveLength(3); expect(found.map(row => [row.x, row.y])).toEqual([[8, 8], [30, 10], [49, 39]]);
    for (const row of found) expect(Number.isInteger(row.x) && Number.isInteger(row.y)).toBe(true);
  });
  it('moves detections when the actual field moves, rather than inventing random frames', () => {
    const before = detectRegions(islands([{ x: 12, y: 18 }]));
    const after = detectRegions(islands([{ x: 39, y: 35 }]), before);
    expect(before[0]).toMatchObject({ x: 12, y: 18 }); expect(after[0]).toMatchObject({ x: 39, y: 35 });
  });
  it('preserves nearby slot identity and fades unrelated targets before relocation', () => {
    const slots = createSlots(); matchRegions(slots, [{ x: 10, y: 10, score: 1 }], true);
    slots[0].vx = 2; matchRegions(slots, [{ x: 14, y: 11, score: 1 }]);
    expect(slots[0].vx).toBe(2); expect(slots[0].x).toBe(10);
    stepSlots(slots, 1 / 60, true); expect(slots[0].x).toBeGreaterThan(10); expect(slots[0].x).toBeLessThan(14);
    matchRegions(slots, [{ x: 49, y: 49, score: 1 }]); expect(slots[0].retiring).toBe(true); expect(slots[0].target?.x).toBe(14);
    for (let i = 0; i < 12; i++) stepSlots(slots, 1 / 60, true);
    expect(slots[0].target?.x).toBe(14);
    for (let i = 0; i < 30; i++) stepSlots(slots, 1 / 60, true);
    expect(slots[0].target?.x).toBe(49);
  });
  it('lets a stationary pointer pulse expire and restores all segment positions', () => {
    const field = new LineField(islands([{ x: 30, y: 30 }]), 3), area = { x: 0, y: 0, width: 300 };
    field.point({ x: 146, y: 148 }, true);
    for (let i = 0; i < 15; i++) field.step(1 / 60, area, true, true);
    expect(Math.max(...field.dx.map(Math.abs))).toBeGreaterThan(.1);
    expect(field.scans).toBeLessThanOrEqual(3);
    for (let i = 0; i < 600; i++) field.step(1 / 60, area, false, true);
    expect(Math.max(...field.dx.map(Math.abs), ...field.dy.map(Math.abs))).toBeLessThan(.0001);
  });
});

describe('animation lifecycle', () => {
  it('calls native frame functions with their Window receiver', () => {
    const browser = {
      requestAnimationFrame(this: unknown) { expect(this).toBe(browser); return 1; },
      cancelAnimationFrame(this: unknown, id: number) { expect(this).toBe(browser); expect(id).toBe(1); },
    };
    vi.stubGlobal('window', browser);
    try { const loop = new FrameLoop(() => {}); loop.invalidate(); expect(loop.scheduled).toBe(true); loop.dispose(); }
    finally { vi.unstubAllGlobals(); }
  });
  it('stops RAF on pause, modal, background and offscreen, and resumes without catchup', () => {
    let serial = 0; const pending = new Map<number, FrameRequestCallback>(), draw = vi.fn();
    const loop = new FrameLoop(draw, callback => { pending.set(++serial, callback); return serial; }, id => { pending.delete(id); });
    const frame = (time: number) => { const [id, callback] = [...pending][0]; pending.delete(id); callback(time); };
    loop.invalidate(); expect(pending.size).toBe(1); frame(100); expect(draw).toHaveBeenLastCalledWith(1 / 60, true);
    loop.set({ motion: false }); expect(pending.size).toBe(0); expect(draw).toHaveBeenLastCalledWith(0, false);
    loop.invalidate(); expect(pending.size).toBe(0);
    loop.set({ motion: true }); frame(50000); expect(draw).toHaveBeenLastCalledWith(1 / 60, true);
    loop.set({ modal: true }); expect(pending.size).toBe(0);
    loop.set({ modal: false }); expect(pending.size).toBe(1);
    loop.set({ visible: false }); expect(pending.size).toBe(0);
    loop.set({ visible: true, intersecting: false }); expect(pending.size).toBe(0);
    loop.set({ intersecting: true }); expect(pending.size).toBe(1);
    loop.dispose(); expect(pending.size).toBe(0); loop.invalidate(); expect(pending.size).toBe(0);
  });
  it('does not repaint or scan when a parent repeats unchanged visibility while paused', () => {
    const field = new LineField(islands([{ x: 30, y: 30 }]), 3);
    const draw = vi.fn((dt: number, animated: boolean) => field.step(dt, { x: 0, y: 0, width: 300 }, true, animated));
    const schedule = vi.fn(() => 1), cancel = vi.fn();
    const loop = new FrameLoop(draw, schedule, cancel);
    loop.set({ motion: false });
    const scans = field.scans, draws = draw.mock.calls.length;
    for (let i = 0; i < 120; i++) loop.set({ visible: true, motion: false, intersecting: true, modal: false });
    expect(draw).toHaveBeenCalledTimes(draws); expect(field.scans).toBe(scans); expect(schedule).not.toHaveBeenCalled();
    loop.invalidate(); expect(draw).toHaveBeenCalledTimes(draws + 1); expect(field.scans).toBe(scans + 1);
    loop.dispose();
  });
});
