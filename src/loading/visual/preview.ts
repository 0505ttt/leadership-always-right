import './preview.css';
import { createLoadingScreen } from '../screen';
import type { LoadingProgress } from '../types';

const presets = {
  loading: {
    stage: 'textures',
    completedResources: 7,
    totalResources: 14,
    bytes: { completed: 4404019, total: 8808038 },
    detail: '正在准备纹理与办公物资；此处为独立预览的固定样例状态。',
  },
  error: {
    stage: 'error',
    completedResources: 7,
    totalResources: 14,
    bytes: { completed: 4404019, total: 8808038 },
    detail: '2 项资源需要处理。全部准备完成后，入口才会开放。',
    failedItems: [
      { id: 'chair-v1', label: '办公椅模型', message: '纹理读取失败，请重新准备这一项。', retryable: true },
      { id: 'office-briefing', label: '办公室广播', message: '音频尚未就绪，可继续等待资源管理器处理。', retryable: false },
    ],
  },
  ready: {
    stage: 'ready',
    completedResources: 14,
    totalResources: 14,
    bytes: { completed: 8808038, total: 8808038 },
    detail: '本局所需资源与场景已就绪。点击进入后启用声音。',
  },
} satisfies Record<string, LoadingProgress>;

const host = document.querySelector<HTMLElement>('#loading-preview');
if (!host) throw new Error('Missing loading preview host.');

const callbackLog: { name: string; id?: string; at: number }[] = [];
const tools = document.createElement('details');
tools.className = 'loading-preview-tools';
const summary = document.createElement('summary');
summary.textContent = '预览状态';
const panel = document.createElement('div');
panel.className = 'loading-preview-tools__panel';
const buttons = document.createElement('div');
buttons.className = 'loading-preview-tools__buttons';
const log = document.createElement('p');
log.className = 'loading-preview-tools__log';
log.setAttribute('aria-live', 'polite');
log.textContent = '尚未触发回调。';
const note = document.createElement('p');
note.className = 'loading-preview-tools__note';
note.textContent = '仅复用正式封面；不会启动主游戏或真实资源加载。';
panel.append(buttons, log, note);
tools.append(summary, panel);
document.body.append(tools);

const reportCallback = (name: string, id?: string) => {
  callbackLog.push({ name, id, at: performance.now() });
  log.textContent = id ? `${name}：${id}` : `${name}：已在本次点击中调用`;
};

const screen = createLoadingScreen(host, {
  onEnter: () => reportCallback('onEnter（未启动游戏）'),
  onRetry: id => reportCallback('onRetry', id),
  onTutorial: () => reportCallback('onTutorial'),
});

const setState = (name: keyof typeof presets) => {
  screen.update(presets[name]);
  document.body.dataset.previewState = name;
};

for (const name of Object.keys(presets) as (keyof typeof presets)[]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name === 'loading' ? '加载中' : name === 'error' ? '失败／重试' : '就绪';
  button.addEventListener('click', () => setState(name));
  buttons.append(button);
}
const visibilityButton = document.createElement('button');
visibilityButton.type = 'button';
visibilityButton.textContent = '隐藏封面';
visibilityButton.addEventListener('click', () => {
  const show = host.querySelector('.office-loader')?.hasAttribute('hidden');
  screen.setVisible(Boolean(show));
  visibilityButton.textContent = show ? '隐藏封面' : '显示封面';
});
buttons.append(visibilityButton);

const params = new URLSearchParams(location.search);
if (params.get('chrome') === '0') tools.hidden = true;
const initial = params.get('state');
setState(initial === 'error' || initial === 'ready' ? initial : 'loading');

Object.defineProperty(window, '__LOADING_PREVIEW__', {
  configurable: false,
  value: {
    update: (progress: LoadingProgress) => screen.update(progress),
    setState,
    setVisible: (visible: boolean) => screen.setVisible(visible),
    getDiagnostics: () => screen.getDiagnostics(),
    getCallbackLog: () => callbackLog.slice(),
    presets,
  },
});
