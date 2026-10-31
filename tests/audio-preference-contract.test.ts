import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('background-music-only preference patch', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  it('mutes effects and voice while retaining bounded background music', () => {
    expect(main).toContain('effectsVolume:0,voiceVolume:0');
    expect(main).toContain('settings.effectsVolume=0;');
    expect(main).toContain('settings.voiceVolume=0;');
    expect(main).toContain('settings.musicVolume=Math.max(0,Math.min(.4,settings.musicVolume??.4));');
    expect(main).toContain('audio.setVolumes({music:settings.musicVolume,effects:0,voice:0});');
  });

  it('persists the preference without forcing background music to zero', () => {
    expect(main).toContain("localStorage.setItem('leadership-settings',JSON.stringify(settings))");
    expect(main).not.toContain('settings.musicVolume=0;');
  });
});
