import './theme.css';
import type { Page, Settings, UICommand, UIModel } from '../contracts/game';

export interface UIInstance {
  render(model: UIModel): void;
  destroy(): void;
}

type Command = UICommand['type'];
type IconName = 'arrow' | 'clock' | 'door' | 'card' | 'person' | 'chair' | 'pot' | 'eye' | 'close' | 'file' | 'sliders' | 'book' | 'check';

const icons: Record<IconName, string> = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  door: '<path d="M5 21V3h12v18M5 21h16M12 12h1M17 3l3 2v16"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="8" cy="11" r="2"/><path d="M5 16c.7-2 5.3-2 6 0M13 10h5M13 14h4"/>',
  person: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M8 12l-2 5M16 12l2 5"/>',
  chair: '<path d="M7 4v9h10V4M6 13h12v4H6zM12 17v4M7 21l5-1 5 1M5 17l-2 3M19 17l2 3"/>',
  pot: '<path d="M6 9h12v6a6 6 0 0 1-12 0zM6 11H3v3h3M18 11h3v3h-3M8 21h8"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
  sliders: '<path d="M4 7h7M15 7h5M4 17h3M11 17h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  book: '<path d="M12 5v16M12 5C8 2 4 3 3 4v15c2-1 6-1 9 2 3-3 7-3 9-2V4c-1-1-5-2-9 1Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

function icon(name: IconName, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function button(label: string, command: Command, style = 'secondary', symbol?: IconName): string {
  return `<button type="button" class="button button--${style}" data-command="${command}">${symbol ? icon(symbol) : ''}<span>${label}</span>${style === 'primary' ? icon('arrow', 'button__arrow') : ''}</button>`;
}

function masthead(model: UIModel): string {
  return `<header class="masthead"><div class="wordmark"><span class="wordmark__seal" aria-hidden="true">真</span><span>下班事务处<small>AFTER HOURS / 18:00</small></span></div><div class="masthead__meta"><span class="status-dot"></span>单人模式<span class="meta-divider"></span><span>${model.preview ? '视觉样例' : '开发预览'}</span></div></header>`;
}

function home(credits: boolean): string {
  return `<main class="home page-enter">
    <section class="notice" aria-labelledby="game-title">
      <div class="notice__top"><span>下班事务临时通知</span><span class="mono">NO. 1800</span></div>
      <div class="notice__rule"></div>
      <p class="eyebrow">一本正经地工作，千方百计地下班。</p>
      <h1 id="game-title">领导说的<br><span>都是真的<span class="title-period">。</span></span></h1>
      <p class="home__intro">他说的话，会改变这间办公室。<br>而你，只想在工位上体面地消失。</p>
      <div class="home__actions">${button('开始上班', 'start', 'primary')}
        <div class="button-row">${button('离岗手册', 'tutorial', 'secondary', 'book')}${button('设置', 'settings', 'secondary', 'sliders')}</div>
      </div>
      <div class="home__secondary"><button class="text-button" type="button" disabled>多人模式<span>待开发</span></button><span class="tiny-divider">/</span><button class="text-button" type="button" data-action="credits" aria-expanded="${credits}">制作说明</button></div>
      <div class="notice__footer"><span>单人 · 第三人称</span><span>每局最多 10 分钟</span><span>无需听觉</span></div>
      ${credits ? `<aside class="credits" aria-label="制作说明"><button type="button" class="icon-button credits__close" data-action="credits" aria-label="关闭制作说明">${icon('close')}</button><p class="eyebrow">关于这间办公室</p><h2>认真上班，灵活下班。</h2><p>《领导说的都是真的》是一款单人、近第三人称的办公室逃离游戏。职场话术成为真实规则，你需要探索路线、打卡，并与一本正经的领导周旋。</p><p>视觉由 Kimi 设计与制作，角色与道具使用 Tripo 生成；玩法、程序与整局验收由 Codex 负责。当前为单人版本，不包含联机匹配。</p></aside>` : ''}
    </section>
    <aside class="scene-caption"><span class="scene-caption__line"></span><div><span class="eyebrow">办公室现场</span><p>18:00<br><span>仍然有人坐在工位上。</span></p></div><span class="scene-caption__index mono">LIVE / 001</span></aside>
    <div class="home__route"><span><b>01</b> 离开工位</span>${icon('arrow')}<span><b>02</b> 找到打卡机</span>${icon('arrow')}<span><b>03</b> 寻找出口</span></div>
  </main>`;
}

const tutorials = [
  {
    title: '先离开那把椅子。',
    intro: '工作先放一放。你的目标是离开，不是把办公室收拾完。',
    cards: [
      ['person', '起身探索', 'WASD 移动，鼠标观察。Shift 冲刺、C 蹲、Space 跳；靠近物件后按 E 交互。'],
      ['card', '先找打卡机', '找到任意一台打卡机，按住 E 完成打卡。完成后，成果不会因被抓回而失去。'],
      ['door', '再找出口', '出口的位置需要探索。靠近门后按住 E 开门，然后走出去。'],
    ],
  },
  {
    title: '他说的话，别当耳旁风。',
    intro: '领导每句实际指令，都可能成为办公室的物理规则。',
    cards: [
      ['eye', '看见宣告，提前反应', '中上方会先出现领导原话。看清影响范围和倒计时，及时换路线或找遮挡。'],
      ['pot', '锅会真的跟着你', '背锅会拖慢行动；坐着时，锅会顶在头上。可以把锅拿下来，也可以甩给同事。'],
      ['chair', '椅子也可能走不了', '被领导抓回工位后，你会和椅子黏在一起。不能蹲跳，但仍可滑动寻找出路。'],
    ],
  },
  {
    title: '利用办公室，别硬碰硬。',
    intro: '被注意到不等于结束。让空间和物件替你争取一点时间。',
    cards: [
      ['eye', '关灯与遮挡', '普通房间的灯可以手动关闭。暗室里领导不能抓你；被追赶时，先切断他的视线。'],
      ['person', '同事也会记仇', '同事看见你可能举报。甩锅给他们之后，下一次见面未必还能心平气和。'],
      ['clock', '完成打卡，体面离场', '不必先坐满工时，也没有钥匙收集。打卡＋走出出口，就是这次下班的全部手续。'],
    ],
  },
];

function tutorial(model: UIModel): string {
  const index = Math.max(0, Math.min(2, model.tutorialPage));
  const page = tutorials[index]!;
  return `<main class="sheet-page page-enter">${masthead(model)}<section class="manual" aria-labelledby="tutorial-title"><div class="manual__head"><div><p class="eyebrow">员工离岗手册 / 0${index + 1}</p><h1 id="tutorial-title">${page.title}</h1></div><span class="manual__stamp">内部传阅</span></div><p class="manual__intro">${page.intro}</p><div class="tutorial-grid">${page.cards.map(([name, title, copy], i) => `<article class="tutorial-card"><div class="tutorial-card__top">${icon(name as IconName)}<span class="mono">0${i + 1}</span></div><h2>${title}</h2><p>${copy}</p></article>`).join('')}</div><div class="manual__footer"><button type="button" class="text-button" data-command="home">返回首页</button><div class="page-dots" aria-label="教程页码">${tutorials.map((_, i) => `<button type="button" class="page-dot ${i === index ? 'is-active' : ''}" data-command="tutorial-page" data-page="${i}" aria-label="第 ${i + 1} 页" aria-current="${i === index ? 'page' : 'false'}"></button>`).join('')}</div>${index < 2 ? `<button type="button" class="button button--primary button--compact" data-command="tutorial-page" data-page="${index + 1}"><span>下一页</span>${icon('arrow')}</button>` : button('我准备好了', 'start', 'primary')}</div></section></main>`;
}

function settingSlider(key: keyof Settings, label: string, value: number, min: number, max: number, step: number, suffix: string): string {
  return `<label class="setting setting--range"><span>${label}<output>${value.toFixed(2).replace(/0$/, '')}${suffix}</output></span><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function settings(model: UIModel): string {
  const value = model.settings;
  return `<main class="sheet-page page-enter">${masthead(model)}<section class="settings-panel" aria-labelledby="settings-title"><p class="eyebrow">个人偏好 / 自动保存</p><h1 id="settings-title">按你的习惯上班。</h1><div class="settings-list"><label class="setting"><span>画面质量<small>改变场景细节与渲染开销</small></span><select data-setting="quality"><option value="low" ${value.quality === 'low' ? 'selected' : ''}>流畅</option><option value="medium" ${value.quality === 'medium' ? 'selected' : ''}>均衡</option><option value="high" ${value.quality === 'high' ? 'selected' : ''}>精细</option></select></label>${settingSlider('sensitivity', '鼠标灵敏度', value.sensitivity, .25, 3, .05, '×')}${settingSlider('textScale', '文字大小', value.textScale, .85, 1.4, .05, '×')}${settingSlider('musicVolume', '音乐', value.musicVolume??.4, 0, 1, .05, '')}${settingSlider('effectsVolume', '环境与动作音效', value.effectsVolume??.75, 0, 1, .05, '')}${settingSlider('voiceVolume', '人物语音', value.voiceVolume??.85, 0, 1, .05, '')}<label class="setting"><span>反转纵向视角<small>反转鼠标上下观察方向</small></span><input class="switch" type="checkbox" data-setting="invertY" ${value.invertY ? 'checked' : ''}></label><label class="setting"><span>减弱非必要动效<small>减少纸张漂移、装饰呼吸与位移动效</small></span><input class="switch" type="checkbox" data-setting="reducedMotion" ${value.reducedMotion ? 'checked' : ''}></label></div><div class="settings-panel__footer"><span>设置只影响表现与操作，不改变规则。</span>${button('完成', 'resume', 'primary')}</div></section></main>`;
}

function loading(model: UIModel, ready: boolean): string {
  return `<main class="loading-page page-enter">${masthead(model)}<section class="loading-card"><div class="loading-card__mark ${ready ? 'is-ready' : ''}">${icon(ready ? 'check' : 'file')}</div><p class="eyebrow">${ready ? '入职手续已备齐' : '正在准备办公室'}</p><h1>${ready ? '今天，也准时下班。' : '先把规矩立起来。'}</h1><p class="loading-stage">${escapeHTML(model.loadingStage)}</p>${ready ? `<div class="ready-brief"><span>${icon('card')} 先打卡</span><span>${icon('eye')} 看清领导的话</span><span>${icon('door')} 再离场</span></div>${button('开始这一局', 'begin', 'primary')}<p class="small-note">WASD 移动 · 鼠标观察 · Esc 暂停</p>` : `<div class="loading-line" role="progressbar" aria-label="正在准备游戏资源"><span></span></div><p class="small-note">资源准备完成后才开始计时，请稍等。</p>`}</section></main>`;
}

function paused(): string {
  return `<main class="pause-page page-enter"><section class="pause-card"><p class="eyebrow">暂时离开工位</p><h1>喘口气。<br>规矩还在。</h1><p>办公室已暂停，回来后再继续想办法。</p><div class="stack-actions">${button('继续下班', 'resume', 'primary')}${button('调整设置', 'settings', 'secondary', 'sliders')}${button('重新开始本局', 'restart', 'secondary')}${button('返回首页', 'home', 'text')}</div><span class="small-note">按 Esc 也可以继续</span></section></main>`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '本局持续';
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

const poseLabels = { standing: '站立', crouching: '蹲伏', working: '假装工作', rolling: '滚椅移动', dragged: '被拖回工位' } as const;

function hud(model: UIModel): string {
  return `<main class="hud" aria-label="游戏状态">
    <section class="objective"><p class="eyebrow">当前目标 <span class="objective__status"></span></p><h2></h2><div class="objective__room"><span></span><span class="mono"></span></div></section>
    <section class="timecard"><p class="eyebrow">距离下班失败</p><div class="timecard__time mono"></div><div class="timecard__clock"><span></span><span>办公室时间</span></div></section>
    <section class="declaration" role="status" hidden><div class="declaration__label"><span>领导说</span><span class="mono"></span></div><blockquote></blockquote><p></p><div class="declaration__timer"><span></span></div></section>
    <aside class="active-rules" hidden><p class="eyebrow">办公室现行规则 <span></span></p>${[0, 1].map(() => '<article class="rule-slip" hidden><p></p><div><span></span><b class="mono"></b></div></article>').join('')}</aside>
    <section class="player-state"><div class="player-state__head"><span class="player-state__icon">${icon(model.sticky ? 'chair' : 'person')}</span><strong></strong><span class="player-state__boss"></span></div><div class="stamina"><span>冲刺体力</span><div class="stamina__bars" role="meter" aria-label="冲刺体力" aria-valuemin="0" aria-valuemax="4">${[0, 1, 2, 3].map(() => '<i></i>').join('')}</div><span class="mono"></span></div><div class="state-tags"><span class="state-tag state-tag--safe state-tag--dark" hidden>暗室保护</span><span class="state-tag state-tag--sticky" hidden>${icon('chair')} 椅子黏住了</span><span class="state-tag state-tag--warning state-tag--pot" hidden>${icon('pot')}<span></span></span><span class="state-tag state-tag--protection" hidden></span><span class="state-tag state-tag--evidence" hidden title="领导保留目击记录的剩余时间">${icon('eye')}<span></span></span></div><p class="holding" hidden></p></section>
    <div class="reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="aim-risk" hidden>${icon('pot')}<span></span></div>
    <div class="office-bubble" hidden><span>工位上的声音</span><p></p></div>
    <div class="game-message" role="status" hidden></div>
    <div class="interaction"><div class="interaction__progress"></div><kbd>E</kbd><span class="interaction__label"></span><small>按住</small><span class="interaction__hint">WASD 移动 <b>·</b> E 交互 <b>·</b> 右键瞄准 <b>·</b> Tab 工作记录</span></div>
  </main>`;
}

function syncHUD(root: HTMLElement, model: UIModel): void {
  const element = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const text = (selector: string, value: string | number) => { element(selector).textContent = String(value); };
  const visible = (selector: string, show: boolean) => { element(selector).hidden = !show; };
  const percent = (value: number) => `${Math.max(0, Math.min(100, value * 100))}%`;
  text('.objective__status', model.clocked ? '已打卡' : '未打卡');
  element('.objective__status').classList.toggle('is-done', model.clocked);
  text('.objective h2', model.objective);
  text('.objective__room span:first-child', model.room);
  text('.objective__room .mono', model.clocked ? '02 / 02' : '01 / 02');
  element('.timecard').classList.toggle('is-urgent', model.remaining < 60);
  text('.timecard__time', formatTime(model.remaining));
  text('.timecard__clock span:first-child', model.clock);
  visible('.declaration', !!model.warning);
  if (model.warning) {
    text('.declaration__label .mono', `即将生效 · ${Math.max(0, model.warning.remaining).toFixed(1)}s`);
    text('.declaration blockquote', `“${model.warning.quote}”`);
    text('.declaration > p', model.warning.effect);
    element('.declaration__timer span').style.width = percent(model.warning.remaining / 3);
  }
  visible('.active-rules', model.rules.length > 0);
  text('.active-rules > .eyebrow span', model.rules.length.toString().padStart(2, '0'));
  // Space rules share a two-rule limit; the persistent chair order is a separate state.
  const ruleContainer = element('.active-rules');
  while (ruleContainer.querySelectorAll('.rule-slip').length < model.rules.length) {
    ruleContainer.append(ruleContainer.querySelector('.rule-slip')!.cloneNode(true));
  }
  root.querySelectorAll<HTMLElement>('.rule-slip').forEach((ruleElement, index) => {
    const rule = model.rules[index];
    ruleElement.hidden = !rule;
    if (rule) {
      ruleElement.querySelector('p')!.textContent = `“${rule.quote}”`;
      ruleElement.querySelector('div span')!.textContent = rule.effect;
      ruleElement.querySelector('b')!.textContent = Number.isFinite(rule.remaining) ? `${Math.ceil(rule.remaining)}s` : '持续';
    }
  });
  text('.player-state__head strong', poseLabels[model.pose]);
  text('.player-state__boss', model.bossStatus);
  const poseIcon = model.sticky ? 'chair' : 'person';
  if (element('.player-state__icon').dataset.pose !== poseIcon) {
    element('.player-state__icon').innerHTML = icon(poseIcon);
    element('.player-state__icon').dataset.pose = poseIcon;
  }
  element('.stamina__bars').setAttribute('aria-valuenow', String(model.stamina));
  root.querySelectorAll('.stamina__bars i').forEach((bar, index) => {
    bar.className = model.stamina >= index + 1 ? 'is-full' : model.stamina > index ? 'is-partial' : '';
  });
  text('.stamina > .mono', model.stamina.toFixed(1));
  visible('.state-tag--dark', model.dark);
  visible('.state-tag--sticky', model.sticky);
  visible('.state-tag--pot', model.pot);
  text('.state-tag--pot > span', model.holding === '责任锅' ? '锅在手中' : '身上背锅');
  visible('.state-tag--protection', model.protection > 0);
  text('.state-tag--protection', `抓回保护 ${Math.ceil(model.protection)}s`);
  visible('.state-tag--evidence', model.bossEvidenceRemaining > 0);
  text('.state-tag--evidence > span', `目击证据 ${Math.ceil(model.bossEvidenceRemaining)}s`);
  visible('.holding', !!model.holding && model.holding !== '责任锅');
  text('.holding', `手持 · ${model.holding}`);
  element('.reticle').classList.toggle('is-aiming', model.aiming);
  visible('.aim-risk', model.aiming);
  text('.aim-risk > span', model.aimTarget ? `瞄准 · ${model.aimTarget}` : '松开甩锅 · 命中领导会被解雇');
  visible('.office-bubble', !!model.bubble);
  text('.office-bubble p', `“${model.bubble}”`);
  visible('.game-message', !!model.message);
  text('.game-message', model.message);
  visible('.interaction__label', !!model.interaction);
  visible('.interaction kbd', !!model.interaction);
  visible('.interaction small', !!model.interaction);
  visible('.interaction__hint', !model.interaction);
  if (model.interaction) {
    text('.interaction__label', model.interaction.label);
    element('.interaction__progress').style.width = percent(model.interaction.progress);
  } else element('.interaction__progress').style.width = '0%';
}

function syncSettings(root: HTMLElement, model: UIModel): void {
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach(control => {
    const key = control.dataset.setting as keyof Settings;
    const value = model.settings[key];
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = !!value;
    else if (document.activeElement !== control) control.value = String(value);
    if (control.type === 'range') control.closest('label')!.querySelector('output')!.textContent = `${Number(value).toFixed(2).replace(/0$/, '')}${key === 'sensitivity' ? '×' : '×'}`;
  });
}

function phone(model: UIModel): string {
  return `<aside class="phone-overlay" role="dialog" aria-modal="true" aria-labelledby="phone-title"><div class="phone"><div class="phone__bar"><span class="mono">18:00</span><span>无信号也没关系</span></div><div class="phone__head"><div><p class="eyebrow">工作记录</p><h2 id="phone-title">下班后工作群 <span>${model.history.length}</span></h2></div><button type="button" class="icon-button" data-command="close-phone" aria-label="收起工作记录">${icon('close')}</button></div><p class="phone__caption">办公室发生过的真实对话</p><div class="phone__messages">${model.history.length ? [...model.history].reverse().map((entry, index) => `<article class="chat-entry"><span class="chat-entry__avatar">领</span><div><p class="chat-entry__name">办公室通知 <time>刚刚</time></p><p>${escapeHTML(entry)}</p></div><span class="mono">${String(model.history.length - index).padStart(2, '0')}</span></article>`).join('') : `<div class="phone__empty">${icon('file')}<p>暂时没人说话。</p><span>珍惜这段安静的时间。</span></div>`}</div><div class="phone__footer"><span>记录仅供回顾，不改变游戏规则。</span><kbd>Tab</kbd></div></div></aside>`;
}

const endings = {
  escaped: { label: '离场手续已完成', title: '今天的事，<br>今天到此为止。', copy: '你完成了打卡，也离开了办公室。至于明天——明天的事，明天再说。', tone: 'success', icon: 'door' as IconName },
  overtime: { label: '下班手续未完成', title: '工位还在，<br>你也还在。', copy: '时间到了，你没能完成离场。明天太阳照常升起，办公室的灯也是。', tone: 'warning', icon: 'clock' as IconName },
  fired: { label: '提前下班 · 被动版', title: '恭喜你，<br>提前毕业了。', copy: '那口锅准确地找到了领导。你获得了下班自由，也失去了这份工作。', tone: 'warning', icon: 'pot' as IconName },
};

function result(model: UIModel): string {
  const ending = endings[model.ending ?? 'overtime'];
  return `<main class="result-page result-page--${ending.tone} page-enter">${masthead(model)}<section class="result-card"><div class="result-card__mark">${icon(ending.icon)}</div><p class="eyebrow">${ending.label}</p><h1>${ending.title}</h1><p class="result-card__copy">${ending.copy}</p><div class="result-stats"><div><span>本局用时</span><strong class="mono">${formatTime(model.elapsed)}</strong></div><div><span>被抓回工位</span><strong class="mono">${model.catches}<small> 次</small></strong></div><div><span>办公室编号</span><strong class="mono">${model.seed}</strong></div></div><div class="result-actions">${button('同一间办公室，再来一次', 'restart', 'primary')}${button('换一间办公室', 'new-seed', 'secondary')}${button('返回首页', 'home', 'text')}</div></section><div class="result-footnote">无论哪种结局，都记得带走自己的东西。</div></main>`;
}

function errorPage(model: UIModel): string {
  return `<main class="sheet-page page-enter">${masthead(model)}<section class="error-card"><p class="eyebrow">办公室暂时未能开放</p><h1>这一步，<br>不赖你。</h1><p>资源准备时遇到了问题。你可以重试，或先回到首页。</p><pre>${escapeHTML(model.error || '未知错误')}</pre><div class="button-row">${button('重试', 'retry', 'primary')}${button('返回首页', 'home', 'secondary')}</div></section></main>`;
}

export function createBaseUI(root: HTMLElement, onCommand: (command: UICommand) => void): UIInstance {
  root.classList.add('ui-root');
  let previousHTML = '';
  let credits = false;
  let lastPage: Page | null = null;
  let previousStructure = '';
  let currentModel: UIModel | undefined;
  let update = (_model: UIModel) => {};

  const click = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const control = target.closest<HTMLButtonElement>('button');
    if (!control || control.disabled) return;
    if (control.dataset.action === 'credits') {
      credits = !credits;
      previousHTML = '';
      root.dispatchEvent(new CustomEvent('kimi-ui-refresh'));
      return;
    }
    const command = control.dataset.command;
    if (command === 'tutorial-page') onCommand({ type: command, page: Number(control.dataset.page ?? 0) });
    else if (command && command !== 'setting') onCommand({ type: command } as UICommand);
  };
  const change = (event: Event) => {
    const control = event.target as HTMLInputElement | HTMLSelectElement;
    const key = control.dataset.setting as keyof Settings | undefined;
    if (!key) return;
    const value = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control instanceof HTMLInputElement && control.type === 'range' ? Number(control.value) : control.value;
    onCommand({ type: 'setting', key, value });
  };
  const refresh = () => { if (currentModel) update(currentModel); };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && credits) {
      credits = false;
      previousHTML = '';
      refresh();
      event.preventDefault();
      event.stopImmediatePropagation();
      root.querySelector<HTMLButtonElement>('[data-action="credits"]')?.focus();
    }
  };
  root.addEventListener('click', click);
  root.addEventListener('change', change);
  root.addEventListener('kimi-ui-refresh', refresh);
  document.addEventListener('keydown', keydown, true);

  update = (model: UIModel) => {
      currentModel = model;
      if (lastPage !== model.page) {
        credits = false;
        lastPage = model.page;
      }
      root.dataset.page = model.page;
      root.style.setProperty('--text-scale', String(model.settings.textScale));
      root.classList.toggle('reduce-motion', model.settings.reducedMotion);
      const structure = [model.page, credits, model.tutorialPage, model.phone ? model.history.join('\u0001') : ''].join('|');
      if (structure === previousStructure && model.page === 'playing') {
        syncHUD(root, model);
        return;
      }
      if (structure === previousStructure && model.page === 'settings') {
        syncSettings(root, model);
        return;
      }
      let content: string;
      switch (model.page) {
        case 'home': content = `${masthead(model)}${home(credits)}`; break;
        case 'tutorial': content = tutorial(model); break;
        case 'settings': content = settings(model); break;
        case 'loading': content = loading(model, false); break;
        case 'ready': content = loading(model, true); break;
        case 'playing': content = hud(model); break;
        case 'computer': content = ''; break;
        case 'paused': content = paused(); break;
        case 'result': content = result(model); break;
        case 'error': content = errorPage(model); break;
      }
      if (model.phone && model.page === 'playing') content += phone(model);
      if (model.page === 'playing' || model.page === 'settings' || content !== previousHTML) {
        root.innerHTML = content;
        previousHTML = content;
      }
      previousStructure = structure;
      if (model.page === 'playing') syncHUD(root, model);
  };

  return {
    render(model: UIModel) { update(model); },
    destroy() {
      root.removeEventListener('click', click);
      root.removeEventListener('change', change);
      root.removeEventListener('kimi-ui-refresh', refresh);
      document.removeEventListener('keydown', keydown, true);
      root.innerHTML = '';
      root.classList.remove('ui-root', 'reduce-motion');
      root.style.removeProperty('--text-scale');
      delete root.dataset.page;
    },
  };
}

export function createUI(root: HTMLElement, onCommand: (command: UICommand) => void): UIInstance {
  let instance = createBaseUI(root, onCommand);
  let lastModel: UIModel | undefined;
  let disposed = false;
  const preview = new URLSearchParams(location.search).get('preview');
  if (preview === 'gallery' || preview === 'assets') {
    const loading = preview === 'gallery' ? import('./preview') : import('../presentation/asset-gallery');
    void loading.then(module => {
      if (disposed) return;
      instance.destroy();
      instance = preview === 'gallery'
        ? (module as typeof import('./preview')).mountPreview(root, onCommand)
        : (module as typeof import('../presentation/asset-gallery')).mountAssetGallery(root);
      if (lastModel) instance.render(lastModel);
    }).catch(error => {
      if (!disposed) console.error('独立预览加载失败', error);
    });
  }
  return {
    render(model: UIModel) { lastModel = model; instance.render(model); },
    destroy() { disposed = true; instance.destroy(); },
  };
}
