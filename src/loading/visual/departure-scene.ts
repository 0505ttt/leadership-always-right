import { createFieldCard, type FieldCard } from '../canvas-view';
import type { FieldSymbol, LoadingDiagnostics } from '../types';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Project-specific departure pass. The reference study keeps its own layout;
 * this scene uses the same numerical fields inside one continuous composition.
 */
export function mountDepartureScene(host: HTMLElement, symbols: readonly FieldSymbol[], title: string, intro: string) {
  const root = element('section', 'office-loader office-loader--permit');
  root.setAttribute('aria-label', title);
  root.dataset.layout = 'departure';
  const inner = element('div', 'office-loader__inner');

  const top = element('header', 'office-loader__top');
  const company = element('p', 'office-loader__company', '甩锅有限公司 / 离岗通行单');
  const topNote = element('p', 'office-loader__top-note', 'DEPARTURE PASS · LIVE RESOURCE CHECK');
  const toggle = element('button', 'office-loader__motion', '播放动效');
  toggle.type = 'button';
  top.append(company, topNote, toggle);

  const permit = element('section', 'office-loader__permit');
  permit.setAttribute('aria-label', '18:00 离岗通行单');
  const hero = element('header', 'office-loader__hero');
  const titleWrap = element('div', 'office-loader__title-wrap');
  const kicker = element('p', 'office-loader__hero-kicker', '《领导说的都是真的》 / 领导的话 → 空间规则');
  const heading = element('h1', 'office-loader__title', title);
  titleWrap.append(kicker, heading);
  const introWrap = element('div', 'office-loader__intro-wrap');
  const introNode = element('p', 'office-loader__intro', intro);
  const formNote = element('p', 'office-loader__form-note', 'FORM 18:00 / 单人离岗准备');
  introWrap.append(formNote, introNode);
  hero.append(titleWrap, introWrap);

  const scene = element('div', 'office-loader__scene');
  const grid = element('div', 'office-loader__cards');
  const routeLabel = element('p', 'office-loader__route-label', '离岗方向 / EXIT 18:00');
  routeLabel.setAttribute('aria-hidden', 'true');
  scene.append(grid, routeLabel);
  permit.append(hero, scene);
  inner.append(top, permit);

  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let motion = !reduced?.matches;
  let visible = true;
  let destroyed = false;
  const views: FieldCard[] = [];
  const failures: LoadingDiagnostics['cards'] = [];
  const events = new AbortController();
  const options = { signal: events.signal };

  const dialog = element('dialog', 'office-loader__dialog');
  dialog.setAttribute('aria-labelledby', 'office-loader-path-title');
  const dialogTitle = element('h2', '', '图形来源');
  dialogTitle.id = 'office-loader-path-title';
  const explanation = element('p', '', '此处展示图形的完整 Path2D。检测框来自当前线场的亮度计算，是视觉交互，不是 AI 识别结果。');
  const pathText = element('pre');
  pathText.tabIndex = 0;
  pathText.setAttribute('aria-label', '完整 Path2D 路径');
  const dialogActions = element('div', 'office-loader__dialog-actions');
  const close = element('button', '', '关闭');
  close.type = 'button';
  dialogActions.append(close);
  dialog.append(dialogTitle, explanation, pathText, dialogActions);
  let origin: HTMLElement | null = null;
  const modal = (value: boolean) => views.forEach(view => view.setModal(value));
  const closed = () => {
    modal(false);
    origin?.focus();
    origin = null;
  };
  const closeDialog = () => {
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      closed();
    }
  };
  close.addEventListener('click', closeDialog, options);
  dialog.addEventListener('close', closed, options);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape' && typeof dialog.close !== 'function') {
      event.preventDefault();
      closeDialog();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      close.focus();
    }
  }, options);
  root.append(inner, dialog);
  host.append(root);

  symbols.forEach(symbol => {
    const slot = element('div', `office-loader__slot office-loader__slot--${symbol.id}`);
    const card = element('article', 'office-loader__card');
    card.style.setProperty('--card', symbol.background);
    card.style.setProperty('--ink', symbol.ink);
    card.tabIndex = 0;
    card.dataset.fieldId = symbol.id;
    card.setAttribute('aria-label', `${symbol.title}。聚焦或触摸可查看数值线场。`);
    const canvas = element('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const cardTitle = element('h2', 'office-loader__card-title', symbol.title);
    const foot = element('div', 'office-loader__card-foot');
    const slogan = element('p', 'office-loader__slogan', symbol.slogan);
    const source = element('button', 'office-loader__source', '原始路径 ↗');
    source.type = 'button';
    source.setAttribute('aria-label', `查看${symbol.title}的完整图形路径`);
    const fieldStatus = element('p', 'office-loader__field-status', '触摸或聚焦，查看线场');
    foot.append(slogan, source, fieldStatus);
    card.append(canvas, cardTitle, foot);
    slot.append(card);
    grid.append(slot);

    source.addEventListener('click', () => {
      origin = source;
      dialogTitle.textContent = `${symbol.title} / 24 × 24 Path2D`;
      pathText.textContent = symbol.path;
      modal(true);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        dialog.setAttribute('open', '');
        dialog.setAttribute('aria-modal', 'true');
      }
      close.focus();
    }, options);
    try {
      views.push(createFieldCard(card, canvas, symbol, motion));
    } catch (error) {
      canvas.remove();
      card.append(element('p', 'office-loader__fallback', error instanceof Error ? error.message : '线场暂不可用，资源准备仍可继续。'));
      failures.push({ id: symbol.id, samples: 0, width: 0, height: 0, cssWidth: 0, cssHeight: 0, dpr: 0, scheduled: false, scans: 0, targets: 0 });
    }
  });

  const syncMotion = () => {
    toggle.textContent = motion ? '暂停动效' : '播放动效';
    toggle.setAttribute('aria-pressed', String(motion));
    toggle.setAttribute('aria-label', motion ? '暂停封面装饰动效，真实资源加载继续' : '播放封面装饰动效');
    root.dataset.motion = motion ? 'playing' : 'paused';
    views.forEach(view => view.setMotion(motion));
  };
  toggle.addEventListener('click', () => {
    motion = !motion;
    syncMotion();
  }, options);
  const reduceChanged = () => {
    motion = !reduced?.matches;
    syncMotion();
  };
  reduced?.addEventListener('change', reduceChanged);
  syncMotion();

  return {
    root,
    inner,
    grid,
    footerHost: permit,
    get visible() { return visible; },
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value;
      root.hidden = !value;
      if (!value && dialog.open) closeDialog();
      views.forEach(view => view.setVisible(value));
    },
    getDiagnostics(): LoadingDiagnostics {
      const cards = [...views.map(view => view.diagnostics()), ...failures];
      return { sampleCount: cards.reduce((sum, card) => sum + card.samples, 0), cards };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      events.abort();
      reduced?.removeEventListener('change', reduceChanged);
      views.forEach(view => view.destroy());
      root.remove();
    },
  };
}
