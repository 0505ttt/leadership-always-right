import { FrameLoop, GRID, LINE_ALPHAS, LINE_WIDTHS, LineField, quantize, samplePath, type FieldArea } from './field';
import type { FieldSymbol, LoadingDiagnostics } from './types';

export interface FieldCard {
  setMotion(value: boolean): void;
  setVisible(value: boolean): void;
  setModal(value: boolean): void;
  diagnostics(): LoadingDiagnostics['cards'][number];
  destroy(): void;
}

export function createFieldCard(card: HTMLElement, canvas: HTMLCanvasElement, symbol: FieldSymbol, motion: boolean): FieldCard {
  const context = canvas.getContext('2d');
  if (!context || typeof Path2D === 'undefined') throw new Error('此浏览器不支持线场画布，资源准备仍可继续。');
  const field = new LineField(samplePath(symbol.path, symbol.scale), symbol.seed);
  const events = new AbortController();
  let width = 1, height = 1, dpr = 0, visible = true, hovered = false, focused = false, touching = false;
  let pending: { x: number; y: number; force: boolean } | null = null;
  let destroyed = false, lastStatus = '';
  const status = card.querySelector<HTMLElement>('.office-loader__field-status');
  const area = (): FieldArea => {
    const compact = width > height * 1.1;
    const size = compact ? Math.min(height * .65, width * .43) : Math.min(width * .8, height * .58);
    return { width: Math.max(1, size), x: compact ? width - size - 15 : (width - size) / 2, y: compact ? (height - size) / 2 : height * .17 };
  };
  function syncBacking() {
    const nextDpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * nextDpr)), pixelHeight = Math.max(1, Math.round(height * nextDpr));
    if (dpr !== nextDpr || canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      dpr = nextDpr; canvas.width = pixelWidth; canvas.height = pixelHeight;
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }
  function lines(region: FieldArea, miniature = false) {
    const cell = region.width / GRID, half = Math.max(0, (cell * 2 - .7) / 2);
    context!.strokeStyle = symbol.ink; context!.lineCap = 'butt';
    for (let band = 0; band < 4; band++) {
      context!.beginPath(); context!.globalAlpha = LINE_ALPHAS[band]; context!.lineWidth = LINE_WIDTHS[band] * cell / 5.25;
      for (let index = 0; index < field.brightness.length; index++) {
        const col = index % GRID, row = Math.floor(index / GRID) * 2;
        const brightness = miniature ? (field.source[row * GRID + col] + field.source[(row + 1) * GRID + col]) / 2 : field.brightness[index];
        if (quantize(brightness) !== band) continue;
        const x = region.x + (col + .5) * cell + (miniature ? 0 : field.dx[index]);
        const y = region.y + (row + 1) * cell + (miniature ? 0 : field.dy[index]);
        context!.moveTo(x, y - half); context!.lineTo(x, y + half);
      }
      context!.stroke();
    }
    context!.globalAlpha = 1;
  }
  function detection(region: FieldArea) {
    const cell = region.width / GRID;
    context!.strokeStyle = symbol.detection; context!.fillStyle = symbol.detection;
    context!.lineWidth = 1; context!.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const slots = field.slots.filter(slot => slot.target && slot.alpha >= .01);
    for (let i = 1; i < slots.length; i++) {
      const a = slots[i - 1], b = slots[i];
      context!.globalAlpha = Math.min(a.alpha, b.alpha) * .5;
      context!.beginPath(); context!.moveTo(region.x + (a.x + .5) * cell, region.y + (a.y + .5) * cell);
      context!.lineTo(region.x + (b.x + .5) * cell, region.y + (b.y + .5) * cell); context!.stroke();
    }
    for (const slot of slots) {
      const x = region.x + (slot.x - 4) * cell, y = region.y + (slot.y - 4) * cell, side = cell * 9, corner = Math.min(7, side / 3);
      context!.globalAlpha = slot.alpha * .1; context!.fillRect(x, y, side, side);
      context!.globalAlpha = slot.alpha * .72; context!.strokeRect(x, y, side, side);
      context!.globalAlpha = slot.alpha; context!.lineWidth = 1.5; context!.beginPath();
      for (const sx of [0, 1]) for (const sy of [0, 1]) {
        const px = x + sx * side, py = y + sy * side;
        context!.moveTo(px + (sx ? -corner : corner), py); context!.lineTo(px, py); context!.lineTo(px, py + (sy ? -corner : corner));
      }
      context!.stroke(); context!.lineWidth = 1;
      const moving = Math.abs(slot.vx) + Math.abs(slot.vy) > .005;
      context!.fillText(`${slot.x.toFixed(moving ? 1 : 0)},${slot.y.toFixed(moving ? 1 : 0)}`, x, y - 4);
    }
    context!.globalAlpha = 1;
  }
  const loop = new FrameLoop((dt, animated) => {
    syncBacking();
    if (pending) {
      // Pointer events are coalesced; only this frame reads the card boundary.
      const rect = card.getBoundingClientRect();
      field.point({ x: pending.x - rect.left, y: pending.y - rect.top }, pending.force); pending = null;
    }
    const overlay = hovered || focused || touching, region = area();
    field.step(dt, region, overlay, animated);
    context.clearRect(0, 0, width, height);
    lines(region); lines({ x: 21, y: 18, width: 25 }, true); detection(region);
    const text = overlay ? '数值线场 · 可视区域' : '触摸或聚焦，查看线场';
    if (status && text !== lastStatus) { status.textContent = text; lastStatus = text; }
  });
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height); loop.invalidate();
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    const entry = entries[0]; if (!entry) return;
    width = Math.max(1, entry.contentRect.width); height = Math.max(1, entry.contentRect.height); loop.invalidate();
  });
  observer?.observe(canvas);
  const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.target === card) loop.set({ intersecting: entry.isIntersecting });
  });
  intersection?.observe(card);
  const options = { signal: events.signal };
  const pointer = (event: PointerEvent, force = false) => {
    pending = { x: event.clientX, y: event.clientY, force: force || !!pending?.force }; loop.invalidate();
  };
  card.addEventListener('pointerenter', event => { hovered = event.pointerType !== 'touch'; pointer(event, true); }, options);
  card.addEventListener('pointermove', event => pointer(event), options);
  card.addEventListener('pointerdown', event => { touching = event.pointerType !== 'mouse'; pointer(event, true); }, options);
  const release = () => { touching = false; loop.invalidate(); };
  card.addEventListener('pointerup', release, options);
  card.addEventListener('pointercancel', release, options);
  card.addEventListener('pointerleave', () => { hovered = touching = false; pending = null; field.clearPointer(); loop.invalidate(); }, options);
  card.addEventListener('focusin', () => { focused = true; loop.invalidate(); }, options);
  card.addEventListener('focusout', event => { focused = !!event.relatedTarget && card.contains(event.relatedTarget as Node); loop.invalidate(); }, options);
  const visibility = () => loop.set({ visible: visible && !document.hidden });
  document.addEventListener('visibilitychange', visibility, options);
  window.addEventListener('resize', resize, options);
  let resolution: MediaQueryList | null = null;
  const dprChanged = () => { watchDpr(); loop.invalidate(); };
  function watchDpr() {
    resolution?.removeEventListener('change', dprChanged);
    resolution = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    resolution?.addEventListener('change', dprChanged);
  }
  watchDpr(); resize(); loop.set({ motion, visible: !document.hidden });
  return {
    setMotion(value) { loop.set({ motion: value }); },
    setVisible(value) { visible = value; visibility(); },
    setModal(value) { loop.set({ modal: value }); },
    diagnostics: () => ({ id: symbol.id, samples: 1, width: canvas.width, height: canvas.height, cssWidth: width, cssHeight: height, dpr, scheduled: loop.scheduled, scans: field.scans, targets: field.slots.filter(slot => slot.target && slot.alpha >= .04).length }),
    destroy() {
      if (destroyed) return; destroyed = true;
      loop.dispose(); events.abort(); observer?.disconnect(); intersection?.disconnect(); resolution?.removeEventListener('change', dprChanged);
      canvas.width = canvas.height = 0;
    },
  };
}
