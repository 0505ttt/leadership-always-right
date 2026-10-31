import type { EntryCallbacks, EntryExperience, EntryPhase } from './contracts';
import type { LoadingProgress, LoadingStage } from '../../../src/loading/types';
import { createEntryLineField, entrySourcePath } from './line-field';

const stageLabels: Record<LoadingStage, string> = {
  download: '下载本局资源', parse: '解析模型与动作', textures: '准备纹理与办公物资', audio: '准备音频',
  scene: '初始化办公室', shaders: '预编译场景着色器', ready: '离岗准备完成', error: '资源准备中断',
};
const stageGroups: Record<string, number> = { download: 0, parse: 1, textures: 1, audio: 2, scene: 3, shaders: 3, ready: 4, error: 0 };
const stepNames = ['download', 'parse', 'audio', 'scene', 'ready'];
const tutorials = [
  { index: '01 / 移动与交互', title: '先保住下班的念头。', copy: 'WASD 移动，鼠标环视，Shift 冲刺，C 或 Ctrl 蹲下，Space 跳跃，E 交互。靠近电脑可按 F，Esc 暂停。被粘在椅子上后不能蹲跳，但可以连人带椅继续移动。' },
  { index: '02 / 规则与道具', title: '领导说的话，别只当废话。', copy: '醒目宣告会改变办公室。Q 取锅或归位，鼠标右键瞄准、左键投出，R 轻放；甩给领导会被炒鱿鱼。暗室里领导不能抓人，关键状态无需听觉也能阅读。' },
  { index: '03 / 离场与触控', title: '利用规则，而不是服从规则。', copy: '探索出口并打卡，再真正走出门外。Tab 打开手机规则记录，每局最多 10 分钟。触控设备使用屏幕移动、视角与动作控件，支持同时移动和观察。资源在启动时预先加载，首页开始后立即开局。' },
];

export function createEntryExperience(host: HTMLElement, callbacks: EntryCallbacks = {}): EntryExperience {
  const card = host.querySelector<HTMLElement>('.entry-line-field')!;
  const canvas = card.querySelector<HTMLCanvasElement>('canvas')!;
  const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motionEnabled = !systemReduced.matches;
  let phase: EntryPhase = 'loading';
  let tutorialPage = 0;
  let destroyed = false;
  let progress: LoadingProgress = { stage: 'download', completedResources: 0, totalResources: 0, detail: '等待真实加载器提供状态。' };
  const field = createEntryLineField(card, canvas, motionEnabled);
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>('[data-dialog]')];
  const events = new AbortController();
  const options = { signal: events.signal };
  const sourcePath = document.querySelector<HTMLElement>('[data-source-path]');
  if (sourcePath) sourcePath.textContent = entrySourcePath;

  function toast(message: string): void {
    const element = host.querySelector<HTMLElement>('.entry-toast');
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
  }

  function syncMotion(): void {
    field.setMotion(motionEnabled);
    host.classList.toggle('reduce-motion', !motionEnabled);
    const button = host.querySelector<HTMLButtonElement>('[data-action="motion"]')!;
    button.textContent = motionEnabled ? '暂停动效' : '恢复动效';
    button.setAttribute('aria-pressed', String(!motionEnabled));
    const setting = document.querySelector<HTMLInputElement>('[data-setting="motion"]');
    if (setting) setting.checked = !motionEnabled;
  }

  function setPhase(next: EntryPhase): void {
    phase = next;
    host.dataset.phase = next;
    host.querySelector<HTMLElement>('[data-view="home"]')!.hidden = next !== 'home';
    host.querySelector<HTMLElement>('[data-view="loading"]')!.hidden = next !== 'loading';
    host.querySelector<HTMLElement>('.entry-toast')!.hidden = true;
  }

  function openDialog(name: string): void {
    const dialog = dialogs.find(item => item.dataset.dialog === name);
    if (!dialog || dialog.open) return;
    field.setModal(true);
    dialog.showModal();
  }

  function renderTutorial(): void {
    const page = tutorials[tutorialPage];
    const content = document.querySelector<HTMLElement>('[data-tutorial-content]')!;
    content.replaceChildren();
    const index = document.createElement('p');
    index.className = 'eyebrow';
    index.textContent = page.index;
    const title = document.createElement('h2');
    title.id = 'tutorial-title';
    title.textContent = page.title;
    const copy = document.createElement('p');
    copy.textContent = page.copy;
    content.append(index, title, copy);
    document.querySelector<HTMLElement>('[data-tutorial-count]')!.textContent = `0${tutorialPage + 1} / 03`;
    document.querySelector<HTMLButtonElement>('[data-tutorial="prev"]')!.disabled = tutorialPage === 0;
    document.querySelector<HTMLButtonElement>('[data-tutorial="next"]')!.textContent = tutorialPage === tutorials.length - 1 ? '回到首页' : '下一页';
  }

  function formatBytes(value: number): string {
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  }

  function renderFailures(items: NonNullable<LoadingProgress['failedItems']>): void {
    const container = host.querySelector<HTMLElement>('[data-failures]')!;
    container.replaceChildren();
    container.hidden = items.length === 0;
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'failure-item';
      const copy = document.createElement('p');
      const label = document.createElement('strong');
      label.textContent = item.label;
      const message = document.createElement('span');
      message.textContent = `${item.message} / ${item.id}`;
      copy.append(label, message);
      row.append(copy);
      if (item.retryable !== false) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'retry-button';
        retry.textContent = '重试此资源';
        retry.addEventListener('click', () => { void callbacks.onRetry?.(item.id); }, options);
        row.append(retry);
      }
      container.append(row);
    }
  }

  function update(next: LoadingProgress): void {
    progress = { ...next, failedItems: next.failedItems ? [...next.failedItems] : [] };
    host.dataset.loadingStage = progress.stage;
    const failures = progress.failedItems ?? [];
    host.querySelector<HTMLElement>('[data-loading-label]')!.textContent = stageLabels[progress.stage];
    const count = `${progress.completedResources} / ${progress.totalResources} 件资源`;
    host.querySelector<HTMLElement>('[data-loading-count]')!.textContent = count;
    host.querySelector<HTMLElement>('[data-loading-detail]')!.textContent = progress.detail || '正在等待下一次真实状态更新。';
    host.querySelector<HTMLElement>('[data-byte-count]')!.textContent = progress.bytes
      ? `${formatBytes(progress.bytes.completed)} / ${formatBytes(progress.bytes.total)} · 仅显示可靠字节数`
      : '按实际资源件数报告，不显示估算百分比';
    const track = host.querySelector<HTMLElement>('.resource-track')!;
    const fill = host.querySelector<HTMLElement>('[data-progress-fill]')!;
    const measurable = progress.totalResources > 0;
    const ratio = measurable ? Math.max(0, Math.min(1, progress.completedResources / progress.totalResources)) : 0;
    track.setAttribute('aria-valuemax', String(progress.totalResources));
    track.setAttribute('aria-valuenow', String(progress.completedResources));
    track.setAttribute('aria-valuetext', measurable ? count : '等待真实资源总数');
    track.classList.toggle('is-indeterminate', !measurable);
    fill.style.transform = `scaleX(${ratio})`;
    const currentGroup = stageGroups[progress.stage];
    for (const [index, name] of stepNames.entries()) {
      const step = host.querySelector<HTMLElement>(`[data-step="${name}"]`)!;
      const failed = progress.stage === 'error' && index === currentGroup;
      const done = progress.stage === 'ready' || (!failed && index < currentGroup);
      step.dataset.state = failed ? 'error' : done ? 'done' : index === currentGroup ? 'current' : 'pending';
      step.querySelector('span')!.textContent = done ? '完成' : `0${index + 1}`;
    }
    renderFailures(failures);
    const enter = host.querySelector<HTMLButtonElement>('[data-action="enter"]')!;
    const ready = progress.stage === 'ready' && failures.length === 0;
    enter.disabled = !ready;
    enter.querySelector('span')!.textContent = ready ? '进入首页' : progress.stage === 'error' ? '处理失败后进入首页' : '等待资源就绪';
  }

  function goHome(): void {
    if (progress.stage === 'ready' && (progress.failedItems?.length ?? 0) === 0) setPhase('home');
  }

  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'home') { event.preventDefault(); goHome(); }
    else if (action === 'start') {
      if (progress.stage !== 'ready' || (progress.failedItems?.length ?? 0) > 0) return;
      if (callbacks.onStart) callbacks.onStart();
      else toast('资源已就绪，已触发立即开局回调；不会再次进入加载页。');
    } else if (action === 'enter') {
      if (progress.stage !== 'ready' || (progress.failedItems?.length ?? 0) > 0) return;
      if (callbacks.onEnter) callbacks.onEnter();
      else { setPhase('home'); toast('资源已就绪，已进入首页。现在可以立即开局。'); }
    } else if (action === 'motion') {
      motionEnabled = !motionEnabled;
      syncMotion();
      callbacks.onSettingChange?.('reducedMotion', !motionEnabled);
    } else if (action === 'settings') openDialog('settings');
    else if (action === 'tutorial') { tutorialPage = 0; renderTutorial(); openDialog('tutorial'); }
    else if (action === 'credits') openDialog('credits');
    else if (action === 'multiplayer') openDialog('multiplayer');
    else if (action === 'source') openDialog('source');
  }, options);

  for (const dialog of dialogs) {
    dialog.addEventListener('close', () => field.setModal(false), options);
    dialog.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('[data-close]')) dialog.close();
      if (event.target === dialog) dialog.close();
    }, options);
  }
  document.querySelector<HTMLButtonElement>('[data-tutorial="prev"]')!.addEventListener('click', () => {
    tutorialPage = Math.max(0, tutorialPage - 1); renderTutorial();
  }, options);
  document.querySelector<HTMLButtonElement>('[data-tutorial="next"]')!.addEventListener('click', () => {
    if (tutorialPage === tutorials.length - 1) { document.querySelector<HTMLDialogElement>('[data-dialog="tutorial"]')!.close(); goHome(); }
    else { tutorialPage += 1; renderTutorial(); }
  }, options);
  document.querySelector<HTMLInputElement>('[data-setting="motion"]')!.addEventListener('change', event => {
    motionEnabled = !(event.target as HTMLInputElement).checked;
    syncMotion();
    callbacks.onSettingChange?.('reducedMotion', !motionEnabled);
  }, options);
  document.querySelector<HTMLSelectElement>('[data-setting="text"]')!.addEventListener('change', event => {
    const value = Number((event.target as HTMLSelectElement).value);
    host.style.setProperty('--text-scale', String(value));
    callbacks.onSettingChange?.('textScale', value);
  }, options);
  const reducedChanged = (event: MediaQueryListEvent) => { motionEnabled = !event.matches; syncMotion(); };
  systemReduced.addEventListener('change', reducedChanged, options);
  syncMotion();
  update(progress);

  return {
    setPhase,
    update,
    setVisible(visible) { host.hidden = !visible; field.setVisible(visible); },
    getDiagnostics: () => ({ sampleCount: field.diagnostics().samples, cards: [field.diagnostics()], phase, progress, motionEnabled }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      events.abort();
      field.destroy();
      for (const dialog of dialogs) if (dialog.open) dialog.close();
    },
  };
}
