import type { UICommand, UIModel } from '../contracts/game';
import { createBaseUI, type UIInstance } from './views';

const base: UIModel = {
  page: 'home',
  seed: 618,
  version: 'visual-preview',
  tutorialPage: 0,
  settings: { quality: 'medium', sensitivity: 1, invertY: false, reducedMotion: false, textScale: 1 },
  loadingStage: '',
  error: '',
  remaining: 486,
  clock: '18:01',
  clocked: false,
  objective: '找到任意一台打卡机 · 按住 E 打卡',
  room: '开放办公区',
  dark: false,
  pose: 'standing',
  sticky: false,
  stamina: 3.2,
  pot: true,
  holding: '',
  protection: 0,
  bossStatus: '领导巡查中',
  bossEvidenceRemaining: 0,
  warning: null,
  rules: [],
  interaction: null,
  message: '',
  bubble: '',
  aiming: false,
  aimTarget: '',
  phone: false,
  history: [],
  ending: null,
  elapsed: 114,
  catches: 0,
  preview: true,
};

const cases: { id: string; label: string; model: UIModel }[] = [
  { id: 'home', label: '首页', model: { ...base } },
  { id: 'tutorial', label: '离岗手册', model: { ...base, page: 'tutorial', tutorialPage: 1 } },
  { id: 'settings', label: '设置', model: { ...base, page: 'settings' } },
  { id: 'loading', label: '加载', model: { ...base, page: 'loading', loadingStage: '准备角色、物件、灯光和规则效果' } },
  { id: 'ready', label: '准备', model: { ...base, page: 'ready', loadingStage: '本局资源与场景已准备完成' } },
  { id: 'hud', label: 'HUD', model: { ...base, page: 'playing', sticky: true, pose: 'rolling', interaction: { label: '打开出口', progress: .62 }, rules: [{ quote: '大家要有主人翁意识。', effect: '工位升高 · 注意头顶', remaining: 31 }], message: '工牌已记录。现在找一个能离开的门。' } },
  { id: 'warning', label: '领导宣告', model: { ...base, page: 'playing', clocked: true, objective: '找到出口 · 按住 E 开门后离场', bossStatus: '你被注意到了', warning: { quote: '这个项目的优先级，给我提到最高。', effect: '附近工位即将升高 · 及时离开低顶区域', remaining: 2.4 }, rules: [{ quote: '这个锅，你来背一下。', effect: '实体锅已附着 · 移动速度降低', remaining: 43 }], message: '领导正在靠近，先离开他的视线。', aiming: true, aimTarget: '同事 · 李工' } },
  { id: 'phone', label: '工作记录', model: { ...base, page: 'playing', phone: true, history: ['年轻人，要把公司当成自己的家。', '这个锅，你来背一下。', '这个项目的优先级，给我提到最高。'] } },
  { id: 'paused', label: '暂停', model: { ...base, page: 'paused' } },
  { id: 'escaped', label: '准点离场', model: { ...base, page: 'result', ending: 'escaped', elapsed: 327, catches: 1, clocked: true } },
  { id: 'overtime', label: '被迫加班', model: { ...base, page: 'result', ending: 'overtime', elapsed: 600, remaining: 0, catches: 2 } },
  { id: 'fired', label: '提前毕业', model: { ...base, page: 'result', ending: 'fired', elapsed: 168, catches: 0 } },
  { id: 'error', label: '异常', model: { ...base, page: 'error', error: '无法准备 3D 场景。请使用支持 WebGL2 的桌面浏览器，并启用硬件加速。' } },
];

/** Fixed examples only. No rules, random generation, clock or alternate UI components. */
export function mountPreview(root: HTMLElement, onCommand: (command: UICommand) => void): UIInstance {
  const toolbar = document.createElement('nav');
  toolbar.className = 'preview-toolbar';
  toolbar.setAttribute('aria-label', '视觉独立预览');
  toolbar.innerHTML = `<span class="preview-toolbar__label">视觉样例 / 固定数据</span>${cases.map((entry, index) => `<button type="button" data-preview="${entry.id}" class="${index === 0 ? 'is-active' : ''}">${entry.label}</button>`).join('')}`;
  const mount = document.createElement('div');
  mount.className = 'preview-mount';
  root.append(mount, toolbar);
  let current = cases[0]!;
  const previewCommand = (command: UICommand) => {
    if (command.type === 'setting') {
      current = { ...current, model: { ...current.model, settings: { ...current.model.settings, [command.key]: command.value } } };
      ui.render(current.model);
    } else if (command.type === 'tutorial-page') {
      current = { ...current, model: { ...current.model, tutorialPage: command.page } };
      ui.render(current.model);
    }
    onCommand(command);
  };
  const ui = createBaseUI(mount, previewCommand);
  ui.render(current.model);

  const click = (event: MouseEvent) => {
    const control = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-preview]');
    if (!control) return;
    const next = cases.find(entry => entry.id === control.dataset.preview);
    if (!next) return;
    current = next;
    toolbar.querySelectorAll('button').forEach(item => item.classList.toggle('is-active', item === control));
    ui.render(current.model);
  };
  toolbar.addEventListener('click', click);

  return {
    render() { ui.render(current.model); },
    destroy() {
      toolbar.removeEventListener('click', click);
      ui.destroy();
      toolbar.remove();
      mount.remove();
    },
  };
}
