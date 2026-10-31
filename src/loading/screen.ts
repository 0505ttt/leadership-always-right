import './styles.css';
import { createFieldCard, type FieldCard } from './canvas-view';
import { GAME_SYMBOLS } from './symbols';
import { mountDepartureScene } from './visual/departure-scene';
import type { FieldSymbol, LoadingCallbacks, LoadingDiagnostics, LoadingProgress, LoadingScreen } from './types';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const stageLabels: Record<LoadingProgress['stage'], string> = {
  download: '领取办公物资',
  parse: '核对模型与材质',
  textures: '准备纹理',
  audio: '检查广播与声音',
  scene: '装配办公室与通行路线',
  shaders: '初始化场景着色器',
  ready: '离岗校准完成',
  error: '有物资尚未准备好',
};

/** The same field renderer powers the production cover and the offline reference. */
export function mountFieldStudy(host: HTMLElement, symbols: readonly FieldSymbol[], title: string, intro: string) {
  const root = element('section', 'office-loader');
  root.setAttribute('aria-label', title);
  const inner = element('div', 'office-loader__inner');
  const top = element('header', 'office-loader__top');
  const company = element('p', 'office-loader__company', '甩锅有限公司 / 离岗准备');
  const topNote = element('p', 'office-loader__top-note', 'FORM 18:00 · RESOURCE CHECK');
  const toggle = element('button', 'office-loader__motion', '播放动效');
  toggle.type = 'button';
  top.append(company, topNote, toggle);

  const hero = element('div', 'office-loader__hero');
  const heading = element('h1', 'office-loader__title', title);
  const introWrap = element('div', 'office-loader__intro-wrap');
  const introNode = element('p', 'office-loader__intro', intro);
  introWrap.append(introNode);
  hero.append(heading, introWrap);
  const grid = element('div', 'office-loader__cards');
  inner.append(top, hero, grid);

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

  symbols.forEach((symbol, index) => {
    const slot = element('div', 'office-loader__slot');
    const card = element('article', 'office-loader__card');
    card.style.setProperty('--card', symbol.background);
    card.style.setProperty('--ink', symbol.ink);
    card.tabIndex = 0;
    card.dataset.fieldId = symbol.id;
    card.setAttribute('aria-label', `${symbol.title}。聚焦或触摸可查看数值线场。`);
    const canvas = element('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const cardTitle = element('h2', 'office-loader__card-title', symbol.title);
    const cardIndex = element('span', 'office-loader__card-index', `0${index + 1} / 03`);
    cardIndex.setAttribute('aria-hidden', 'true');
    const foot = element('div', 'office-loader__card-foot');
    const slogan = element('p', 'office-loader__slogan', symbol.slogan);
    const source = element('button', 'office-loader__source', '查看图形路径 ↗');
    source.type = 'button';
    source.setAttribute('aria-label', `查看${symbol.title}的完整图形路径`);
    const fieldStatus = element('p', 'office-loader__field-status', '触摸或聚焦，查看线场');
    foot.append(slogan, source, fieldStatus);
    card.append(canvas, cardTitle, cardIndex, foot);
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

export function createLoadingScreen(host: HTMLElement, callbacks: LoadingCallbacks): LoadingScreen {
  const study = mountDepartureScene(host, GAME_SYMBOLS, '18:00 离岗校准', '领导的话正在改变办公室。准备好后，亲自找路下班。');

  const footer = element('footer', 'office-loader__footer');
  const status = element('div', 'office-loader__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const stageLine = element('div', 'office-loader__stage-line');
  const heading = element('p', 'office-loader__stage');
  const counts = element('p', 'office-loader__counts');
  stageLine.append(heading, counts);
  const detail = element('p', 'office-loader__detail');
  const progressTrack = element('div', 'office-loader__progress');
  progressTrack.setAttribute('role', 'progressbar');
  progressTrack.setAttribute('aria-label', '真实资源加载进度');
  progressTrack.setAttribute('aria-valuemin', '0');
  const progressFill = element('div', 'office-loader__progress-fill');
  progressFill.setAttribute('aria-hidden', 'true');
  progressTrack.append(progressFill);
  status.append(stageLine, detail, progressTrack);

  const actions = element('div', 'office-loader__actions');
  const enter = element('button', 'office-loader__enter', '等待资源就绪');
  enter.type = 'button';
  enter.disabled = true;
  actions.append(enter);
  if (callbacks.onTutorial) {
    const tutorial = element('button', 'office-loader__tutorial', '操作说明');
    tutorial.type = 'button';
    tutorial.addEventListener('click', callbacks.onTutorial);
    actions.append(tutorial);
  }

  const errors = element('ul', 'office-loader__errors');
  errors.setAttribute('aria-label', '需要重试的资源');
  errors.setAttribute('aria-live', 'polite');
  const note = element('p', 'office-loader__note', '暂停只影响装饰动效，不中断真实资源加载。');
  footer.append(status, actions, errors, note);
  study.footerHost.append(footer);

  let ready = false;
  let entered = false;
  let destroyed = false;
  let failureKey = '';
  const setText = (node: HTMLElement, value: string) => {
    if (node.textContent !== value) node.textContent = value;
  };

  const update = (progress: LoadingProgress) => {
    if (destroyed) return;
    const failed = progress.failedItems ?? [];
    ready = progress.stage === 'ready' && failed.length === 0;
    if (!ready) entered = false;
    enter.disabled = !ready || entered;
    study.root.dataset.stage = progress.stage;
    study.root.dataset.ready = String(ready);
    study.root.dataset.failures = String(failed.length);
    setText(heading, stageLabels[progress.stage]);
    setText(detail, progress.detail ?? (ready
      ? '本局所需资源与场景已就绪。点击进入后启用声音。'
      : failed.length
        ? '请处理下列失败项；全部资源就绪后才能进入办公室。'
        : '按真实资源状态准备，进度不会因动效暂停而停止。'));
    setText(enter, entered ? '正在进入…' : ready ? '进入办公室' : failed.length ? '处理失败后进入' : '等待资源就绪');

    const completed = Number.isFinite(progress.completedResources) ? Math.max(0, Math.floor(progress.completedResources)) : 0;
    const total = Number.isFinite(progress.totalResources) ? Math.max(0, Math.floor(progress.totalResources)) : 0;
    const shownCompleted = total > 0 ? Math.min(completed, total) : completed;
    const bytes = progress.bytes;
    const byteText = bytes && Number.isFinite(bytes.total) && Number.isFinite(bytes.completed) && bytes.total > 0 && bytes.completed >= 0 && bytes.completed <= bytes.total
      ? ` · ${(bytes.completed / 1048576).toFixed(1)} / ${(bytes.total / 1048576).toFixed(1)} MiB`
      : '';
    const countText = total > 0
      ? `${shownCompleted} / ${total} 件资源${byteText}`
      : ready
        ? '资源与场景已就绪'
        : `等待资源清单${completed > 0 ? ` · 已处理 ${completed} 件` : ''}`;
    setText(counts, countText);

    const fraction = total > 0 ? shownCompleted / total : 0;
    progressFill.style.transform = `scaleX(${fraction})`;
    progressTrack.dataset.indeterminate = String(total === 0 && !ready);
    if (total > 0) {
      progressTrack.setAttribute('aria-valuemax', String(total));
      progressTrack.setAttribute('aria-valuenow', String(shownCompleted));
      progressTrack.setAttribute('aria-valuetext', countText);
    } else {
      progressTrack.removeAttribute('aria-valuemax');
      progressTrack.removeAttribute('aria-valuenow');
      progressTrack.removeAttribute('aria-valuetext');
    }

    const key = JSON.stringify(failed);
    if (key !== failureKey) {
      failureKey = key;
      errors.replaceChildren();
      for (const item of failed) {
        const row = element('li');
        const copy = element('div', 'office-loader__error-copy');
        copy.append(element('strong', '', item.label), element('span', '', item.message));
        row.append(copy);
        if (item.retryable !== false) {
          const retry = element('button', 'office-loader__retry', '重试此项');
          retry.type = 'button';
          retry.setAttribute('aria-label', `重试${item.label}`);
          retry.addEventListener('click', () => {
            retry.disabled = true;
            setText(retry, '正在重试…');
            try {
              const result = callbacks.onRetry(item.id);
              Promise.resolve(result)
                .catch(() => setText(detail, '重试未能完成，请稍后再试。'))
                .finally(() => {
                  if (!destroyed && retry.isConnected) {
                    retry.disabled = false;
                    setText(retry, '重试此项');
                  }
                });
            } catch {
              retry.disabled = false;
              setText(retry, '重试此项');
              setText(detail, '重试未能完成，请稍后再试。');
            }
          });
          row.append(retry);
        }
        errors.append(row);
      }
    }
  };

  enter.addEventListener('click', () => {
    if (!ready || entered || destroyed) return;
    entered = true;
    enter.disabled = true;
    setText(enter, '正在进入…');
    try {
      callbacks.onEnter();
    } catch {
      entered = false;
      enter.disabled = false;
      setText(enter, '进入办公室');
      setText(detail, '进入办公室未完成，请重试。');
    }
  });

  update({ stage: 'download', completedResources: 0, totalResources: 0 });
  return {
    update,
    setVisible(value) {
      if (value && !study.visible) {
        entered = false;
        enter.disabled = !ready;
      }
      study.setVisible(value);
    },
    getDiagnostics: () => study.getDiagnostics(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      study.destroy();
    },
  };
}
