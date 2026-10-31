import { expect, it } from 'vitest';
import type { UIModel } from '../src/contracts/game';
import { renderDepartureSettings } from '../src/ui/departure-views';

it('presents only background music as adjustable and marks the muted channels honestly', () => {
  const model = { settings: { quality: 'medium', sensitivity: 1, textScale: 1, invertY: false, reducedMotion: false, musicVolume: .4, effectsVolume: 0, voiceVolume: 0 } } as UIModel;
  const html = renderDepartureSettings(model);
  expect(html).toContain('data-setting="musicVolume" min="0" max="0.4"');
  expect(html).toContain('环境与动作音效<small>已关闭</small>');
  expect(html).toContain('人物语音<small>已关闭</small>');
  expect(html).not.toContain('data-setting="effectsVolume"');
  expect(html).not.toContain('data-setting="voiceVolume"');
});
