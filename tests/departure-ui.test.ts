import { describe, expect, it } from 'vitest';
import type { UIModel } from '../src/contracts/game';
import {
  renderDepartureHome,
  renderDepartureMultiplayer,
  renderDeparturePaused,
} from '../src/ui/departure-views';

const sample = {
  page: 'paused',
  seed: 618,
  elapsed: 0,
  remaining: 321,
  catches: 0,
  ending: null,
} as UIModel;

describe('departure system views', () => {
  it('uses the project-specific company and offers a real multiplayer entry', () => {
    const html = renderDepartureHome(sample, false, false);
    expect(html).toContain('甩锅有限公司');
    expect(html).toContain('data-action="multiplayer"');
    expect(html).not.toContain('下班事务处');
  });

  it('describes the multiplayer entry without fabricating matchmaking', () => {
    const html = renderDepartureMultiplayer();
    expect(html).toContain('多人游戏');
    expect(html).toContain('联机尚未开放');
    expect(html).not.toContain('data-command="start"');
    expect(html).not.toContain('开始匹配');
  });

  it('replaces the legacy pause notice instead of reskinning it', () => {
    const html = renderDeparturePaused(sample);
    expect(html).toContain('离岗暂停');
    expect(html).toContain('05:21');
    expect(html).not.toContain('喘口气。<br>规矩还在。');
  });

  it('shows the real landscape-orientation pause reason', () => {
    const html = renderDeparturePaused({ ...sample, message: '手机正式玩法使用横屏。请旋转设备为横屏后继续。' });
    expect(html).toContain('请旋转设备为横屏后继续');
  });
});
