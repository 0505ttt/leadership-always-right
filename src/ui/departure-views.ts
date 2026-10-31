import type { Settings, UIModel } from '../contracts/game';

function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '本局持续';
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

function button(label: string, command: string, style = 'secondary'): string {
  return `<button type="button" class="button button--${style}" data-command="${command}"><span>${label}</span>${style === 'primary' ? '<span class="button__arrow" aria-hidden="true">→</span>' : ''}</button>`;
}

function header(model: UIModel, section: string): string {
  return `<header class="departure-header"><p class="departure-company"><span aria-hidden="true"></span>甩锅有限公司</p><p class="departure-header__section">${section}</p><p class="departure-header__meta">${model.preview ? '固定视觉样例' : '18:00 / SINGLE PLAYER'}</p></header>`;
}

function footer(note = '领导的话 → 空间规则'): string {
  return `<footer class="departure-footer"><span>FORM 18:00</span><span>${note}</span></footer>`;
}

export function renderDepartureMultiplayer(): string {
  return `<section class="departure-modal" role="dialog" aria-modal="true" aria-labelledby="multiplayer-title">
    <div class="departure-modal__sheet">
      <p class="departure-kicker">多人游戏 / 入口</p>
      <h2 id="multiplayer-title">下班可以一起，<br>联机还没开门。</h2>
      <p>多人入口已经预留。当前版本尚未开放联机房间、匹配或网络同步，不会制造正在寻找队友的假象。</p>
      <div class="departure-multiplayer__status"><span aria-hidden="true"></span><strong>联机尚未开放</strong><small>当前可玩：单人第三人称</small></div>
      <p class="departure-modal__note">你仍可以返回单人模式，亲自控制打工人，利用领导话术形成的空间规则完成下班。</p>
      ${'<button type="button" class="button button--primary" data-action="multiplayer"><span>返回单人模式</span><span class="button__arrow" aria-hidden="true">→</span></button>'}
    </div>
  </section>`;
}

function creditsPanel(): string {
  return `<section class="departure-modal" role="dialog" aria-modal="true" aria-labelledby="credits-title">
    <div class="departure-modal__sheet">
      <p class="departure-kicker">制作说明 / ABOUT</p>
      <h2 id="credits-title">一本正经地工作，<br>千方百计地下班。</h2>
      <p>《领导说的都是真的》是一款单人、近第三人称办公室逃离游戏。职场话术成为真实规则，你需要探索路线、打卡，并与一本正经的领导周旋。</p>
      <p>视觉由 Kimi 设计与制作，角色与道具使用 Tripo 生成。当前版本不包含联机匹配。</p>
      <button type="button" class="button button--secondary" data-action="credits"><span>关闭制作说明</span></button>
    </div>
  </section>`;
}

export function renderDepartureHome(model: UIModel, credits: boolean, multiplayerOpen: boolean): string {
  return `<main class="departure-page departure-home" ${credits || multiplayerOpen ? 'inert' : ''}>
    ${header(model, '离岗通行单')}
    <div class="departure-home__sheet">
      <section class="departure-home__main" aria-labelledby="game-title">
        <p class="departure-kicker">18:00 / 离岗校准</p>
        <h1 id="game-title">领导说的<br>都是真的。</h1>
        <p class="departure-home__intro">领导的话正在改变办公室。<br>准备好后，亲自找路下班。</p>
        <div class="departure-home__actions">
          ${button('开始上班', 'start', 'primary')}
          <div class="departure-button-row">${button('离岗手册', 'tutorial')}${button('设置', 'settings')}</div>
        </div>
        <div class="departure-home__links">
          <button type="button" class="departure-text-link departure-multiplayer-link" data-action="multiplayer" aria-expanded="${multiplayerOpen}">多人游戏 <span>入口</span></button>
          <button type="button" class="departure-text-link" data-action="credits" aria-expanded="${credits}">制作说明</button>
        </div>
      </section>
      <aside class="departure-register" aria-label="离岗登记">
        <p class="departure-kicker">离岗登记 / NO. 1800</p>
        <strong class="departure-register__time">18:00</strong>
        <p>不是坐满工时，<br>是找到离开的办法。</p>
        <ol>
          <li><span>01</span><div><strong>离开工位</strong><small>控制你的打工人</small></div></li>
          <li><span>02</span><div><strong>完成打卡</strong><small>找到唯一打卡机</small></div></li>
          <li><span>03</span><div><strong>寻找出口</strong><small>利用规则，体面离场</small></div></li>
        </ol>
        <div class="departure-register__symbols"><span>锅 / 责任归位</span><span>椅 / 工位校准</span></div>
      </aside>
      <div class="departure-home__foot"><span>单人 · 第三人称</span><span>每局最多 10 分钟</span><span>无需听觉</span></div>
    </div>
    ${footer('先打卡，再离场')}
  </main>
  ${credits ? creditsPanel() : ''}${multiplayerOpen ? renderDepartureMultiplayer() : ''}`;
}

const tutorialPages = [
  {
    title: '先离开那把椅子。',
    intro: '工作先放一放。你的目标是离开，不是把办公室收拾完。',
    items: [
      ['起身探索', 'WASD 移动，鼠标观察。Shift 冲刺、C 蹲、Space 跳；靠近物件后按 E 交互。'],
      ['先找打卡机', '找到唯一打卡机，按住 E 完成打卡。完成后，成果不会因被抓回而失去。'],
      ['再找出口', '出口的位置需要探索。靠近门后按住 E 开门，然后真正走出去。'],
    ],
  },
  {
    title: '他说的话，别当耳旁风。',
    intro: '领导每句实际指令，都可能成为办公室的物理规则。',
    items: [
      ['看见宣告，提前反应', '中上方会先出现领导原话。看清影响范围和倒计时，及时换路线或找遮挡。'],
      ['锅会真的跟着你', '背锅会拖慢行动；坐着时，锅会顶在头上。可以把锅拿下来，也可以甩给同事。'],
      ['椅子也可能走不了', '被领导抓回工位后，你会和椅子黏在一起。不能蹲跳，但仍可滑动寻找出路。'],
    ],
  },
  {
    title: '利用办公室，别硬碰硬。',
    intro: '被注意到不等于结束。让空间和物件替你争取一点时间。',
    items: [
      ['关灯与遮挡', '普通房间的灯可以手动关闭。暗室里领导不能抓你；被追赶时，先切断他的视线。'],
      ['同事也会记仇', '同事看见你可能举报。甩锅给他们之后，下一次见面未必还能心平气和。'],
      ['完成打卡，体面离场', '不必先坐满工时，也没有钥匙收集。打卡＋走出出口，就是这次下班的全部手续。'],
    ],
  },
];

export function renderDepartureTutorial(model: UIModel): string {
  const index = Math.max(0, Math.min(2, model.tutorialPage));
  const page = tutorialPages[index]!;
  return `<main class="departure-page departure-sheet-page">
    ${header(model, `离岗手册 / 0${index + 1}`)}
    <section class="departure-sheet departure-tutorial" aria-labelledby="tutorial-title">
      <p class="departure-kicker">员工离岗手册</p>
      <h1 id="tutorial-title">${page.title}</h1>
      <p class="departure-sheet__intro">${page.intro}</p>
      <ol class="departure-tutorial__list">${page.items.map(([title, copy], itemIndex) => `<li><span>0${itemIndex + 1}</span><div><h2>${title}</h2><p>${copy}</p></div></li>`).join('')}</ol>
      <div class="departure-sheet__actions"><button type="button" class="departure-text-link" data-command="home">返回首页</button><div class="departure-page-dots" aria-label="教程页码">${tutorialPages.map((_, dot) => `<button type="button" class="${dot === index ? 'is-active' : ''}" data-command="tutorial-page" data-page="${dot}" aria-label="第 ${dot + 1} 页" aria-current="${dot === index ? 'page' : 'false'}"></button>`).join('')}</div>${index < 2 ? `<button type="button" class="button button--primary" data-command="tutorial-page" data-page="${index + 1}"><span>下一页</span><span class="button__arrow" aria-hidden="true">→</span></button>` : button('我准备好了', 'start', 'primary')}</div>
    </section>
    ${footer()}
  </main>`;
}

function slider(key: keyof Settings, label: string, value: number, min: number, max: number, step: number): string {
  return `<label class="setting setting--range"><span>${label}<output>${value.toFixed(2).replace(/0$/, '')}×</output></span><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function volumeSlider(key: keyof Settings, label: string, value: number): string {
  return `<label class="setting setting--range"><span>${label}<output>${value.toFixed(2).replace(/0$/, '')}</output></span><input type="range" data-setting="${key}" min="0" max="1" step=".05" value="${value}"></label>`;
}

export function renderDepartureSettings(model: UIModel): string {
  const value = model.settings;
  return `<main class="departure-page departure-sheet-page">
    ${header(model, '个人偏好 / 自动保存')}
    <section class="departure-sheet departure-settings" aria-labelledby="settings-title">
      <p class="departure-kicker">离岗通行单 / 设置附页</p>
      <h1 id="settings-title">按你的习惯上班。</h1>
      <div class="settings-list">
        <label class="setting"><span>画面质量<small>改变场景细节与渲染开销</small></span><select data-setting="quality"><option value="low" ${value.quality === 'low' ? 'selected' : ''}>流畅</option><option value="medium" ${value.quality === 'medium' ? 'selected' : ''}>均衡</option><option value="high" ${value.quality === 'high' ? 'selected' : ''}>精细</option></select></label>
        ${slider('sensitivity', '鼠标灵敏度', value.sensitivity, .25, 3, .05)}
        ${slider('textScale', '文字大小', value.textScale, .85, 1.4, .05)}
        ${volumeSlider('musicVolume', '音乐', value.musicVolume ?? .4)}
        ${volumeSlider('effectsVolume', '环境与动作音效', value.effectsVolume ?? .75)}
        ${volumeSlider('voiceVolume', '人物语音', value.voiceVolume ?? .85)}
        <label class="setting"><span>反转纵向视角<small>反转鼠标上下观察方向</small></span><input class="switch" type="checkbox" data-setting="invertY" ${value.invertY ? 'checked' : ''}></label>
        <label class="setting"><span>减弱非必要动效<small>减少装饰呼吸与位移动效</small></span><input class="switch" type="checkbox" data-setting="reducedMotion" ${value.reducedMotion ? 'checked' : ''}></label>
      </div>
      <div class="departure-sheet__actions"><span class="departure-settings__note">设置只影响表现与操作，不改变规则。</span>${button('完成', 'resume', 'primary')}</div>
    </section>
    ${footer()}
  </main>`;
}

export function renderDeparturePaused(model: UIModel): string {
  return `<main class="departure-page departure-sheet-page departure-pause">
    ${header(model, '离岗暂停')}
    <section class="departure-sheet departure-pause__sheet" aria-labelledby="pause-title">
      <p class="departure-kicker">离岗暂停 / 工位暂离</p>
      <h1 id="pause-title">先喘口气，<br>18:00 还在这里。</h1>
      <p class="departure-sheet__intro">${model.message ? `${escapeHTML(model.message)}<br>` : ''}办公室已暂停。准备好后，从当前位置继续找路。</p>
      <div class="departure-pause__facts"><span>剩余时间 <strong>${formatTime(model.remaining)}</strong></span><span>办公室编号 <strong>${model.seed}</strong></span></div>
      <div class="departure-stack-actions">${button('继续下班', 'resume', 'primary')}${button('调整设置', 'settings')}${button('重新开始本局', 'restart')}${button('返回首页', 'home', 'text')}</div>
      <p class="departure-pause__hint">按 Esc 也可以继续</p>
    </section>
    ${footer('暂停不会改变本局资源状态')}
  </main>`;
}

const endings = {
  escaped: { label: '离场手续已完成', title: '今天的事，<br>今天到此为止。', copy: '你完成了打卡，也离开了办公室。至于明天——明天的事，明天再说。', symbol: '18:00' },
  overtime: { label: '下班手续未完成', title: '工位还在，<br>你也还在。', copy: '时间到了，你没能完成离场。明天太阳照常升起，办公室的灯也是。', symbol: '加班' },
  fired: { label: '提前下班 · 被动版', title: '恭喜你，<br>提前毕业了。', copy: '那口锅准确地找到了领导。你获得了下班自由，也失去了这份工作。', symbol: '锅' },
};

export function renderDepartureResult(model: UIModel): string {
  const ending = endings[model.ending ?? 'overtime'];
  return `<main class="departure-page departure-sheet-page departure-result">
    ${header(model, ending.label)}
    <section class="departure-sheet departure-result__sheet" aria-labelledby="result-title">
      <div class="departure-result__heading"><div><p class="departure-kicker">${ending.label}</p><h1 id="result-title">${ending.title}</h1></div><strong aria-hidden="true">${ending.symbol}</strong></div>
      <p class="departure-sheet__intro">${ending.copy}</p>
      <dl class="departure-result__stats"><div><dt>本局用时</dt><dd>${formatTime(model.elapsed)}</dd></div><div><dt>被抓回工位</dt><dd>${model.catches} 次</dd></div><div><dt>办公室编号</dt><dd>${model.seed}</dd></div></dl>
      <div class="departure-result__actions">${button('同一间办公室，再来一次', 'restart', 'primary')}${button('换一间办公室', 'new-seed')}${button('返回首页', 'home', 'text')}</div>
    </section>
    ${footer('无论哪种结局，都记得带走自己的东西')}
  </main>`;
}

export function renderDepartureError(model: UIModel): string {
  return `<main class="departure-page departure-sheet-page">
    ${header(model, '资源准备异常')}
    <section class="departure-sheet departure-error" aria-labelledby="error-title">
      <p class="departure-kicker">离岗通行单 / 暂未签发</p>
      <h1 id="error-title">这一步，<br>不赖你。</h1>
      <p class="departure-sheet__intro">资源准备时遇到了问题。你可以重试，或先回到首页。</p>
      <pre>${escapeHTML(model.error || '未知错误')}</pre>
      <div class="departure-button-row">${button('重试', 'retry', 'primary')}${button('返回首页', 'home')}</div>
    </section>
    ${footer()}
  </main>`;
}
