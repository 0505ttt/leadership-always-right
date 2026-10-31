import { createFieldCard, type FieldCard } from '../../../src/loading/canvas-view';
import { GAME_SYMBOLS } from '../../../src/loading/symbols';

export function createEntryLineField(card: HTMLElement, canvas: HTMLCanvasElement, motion: boolean): FieldCard {
  const clock = GAME_SYMBOLS.find(symbol => symbol.id === 'clock');
  if (!clock) throw new Error('缺少原创 18:00 线场图形。');
  return createFieldCard(card, canvas, clock, motion);
}

export const entrySourcePath = GAME_SYMBOLS.find(symbol => symbol.id === 'clock')?.path ?? '';
