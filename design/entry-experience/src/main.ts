import './styles.css';
import { createEntryExperience } from './app';
import type { LoadingProgress } from './contracts';

const samples: Record<'loading' | 'ready' | 'error', LoadingProgress> = {
  loading: {
    stage: 'textures', completedResources: 7, totalResources: 14,
    bytes: { completed: 4.2 * 1024 * 1024, total: 8.4 * 1024 * 1024 },
    detail: '正在解析员工动作与办公物资纹理；这是固定预览样例。',
  },
  ready: {
    stage: 'ready', completedResources: 14, totalResources: 14,
    bytes: { completed: 8.4 * 1024 * 1024, total: 8.4 * 1024 * 1024 },
    detail: '资源、音频准备与场景初始化均已完成；这是固定预览样例。',
  },
  error: {
    stage: 'error', completedResources: 6, totalResources: 14,
    bytes: { completed: 3.1 * 1024 * 1024, total: 8.4 * 1024 * 1024 },
    detail: '一项资源未能准备完成；这是固定预览样例。',
    failedItems: [{ id: 'leader-v1', label: '领导模型与动作', message: '本地文件读取失败，请重试该资源。', retryable: true }],
  },
};

const host = document.querySelector<HTMLElement>('#entry');
if (!host) throw new Error('缺少首页挂载节点。');
const experience = createEntryExperience(host, {
  onStart() {
    const toast = document.querySelector<HTMLElement>('.entry-toast');
    if (!toast) return;
    toast.textContent = '资源已就绪，已触发立即开局回调；不会再次进入加载页。';
    toast.hidden = false;
  },
  onEnter() {
    experience.setPhase('home');
    const toast = document.querySelector<HTMLElement>('.entry-toast');
    if (!toast) return;
    toast.textContent = '资源已就绪，已进入首页。现在可以立即开局。';
    toast.hidden = false;
  },
  async onRetry(id) {
    experience.update({
      stage: 'download', completedResources: 6, totalResources: 14,
      detail: `正在重新准备 ${id}；等待下一次真实状态更新。`,
    });
  },
  onSettingChange() { /* Visual-only preference preview. */ },
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-demo]')) {
  button.addEventListener('click', () => {
    const state = button.dataset.demo;
    if (state === 'home') {
      experience.update(samples.ready);
      experience.setPhase('home');
    } else if (state === 'loading' || state === 'ready' || state === 'error') {
      experience.setPhase('loading');
      experience.update(samples[state]);
    }
  });
}

const query = new URLSearchParams(location.search);
const initial = query.get('ui');
if (initial === 'home') {
  experience.update(samples.ready);
  experience.setPhase('home');
} else {
  const state = initial === 'ready' || initial === 'error' ? initial : 'loading';
  experience.setPhase('loading');
  experience.update(samples[state]);
}
if (query.get('chrome') === '0') document.querySelector<HTMLElement>('.demo-toolbar')!.hidden = true;

Object.defineProperty(window, '__ENTRY_PREVIEW__', {
  value: {
    getDiagnostics: () => experience.getDiagnostics(),
    setPhase: (phase: 'home' | 'loading') => experience.setPhase(phase),
    update: (progress: LoadingProgress) => experience.update(progress),
  },
});
