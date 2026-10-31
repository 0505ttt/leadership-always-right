# 主集成对接说明

## 文件归属与当前状态

本会话只负责 `design/entry-experience/**` 的首页、加载、菜单视觉与独立验证。主集成会话负责 `src/main.ts`、`src/ui/**`、`src/loading/screen.ts`、`src/loading/styles.css`、`src/loading/visual/**`、主场景、游戏状态、计时、追逐、资源清单及手机触控样式。

`src/loading/field.ts`、`canvas-view.ts`、`types.ts`、`symbols.ts` 是量化线场与加载契约的共享只读输入；本会话只复用，不修改。正式移交前，本会话不写入上述主工程共享文件，也不另建一套真实资源加载、游戏计时或音频系统。

**当前没有接入主游戏，主游戏仍使用上一版“离岗通行单”。** 本目录的 `src/main.ts` 只是独立预览装配，生产集成时不要把它当作真实加载器。主场景、真实资源加载、音频、游戏计时、输入与主状态由主集成会话维护。

## 固定流程

正式流程必须保持：

**启动 → 预加载资源 → ready 后进入首页 → 开始上班立即开局。**

首页不得再次进入资源加载页。公司标识、教程结束等首页导航也不能绕过未完成的加载门槛。

## 页面与组件

- `index.html` 提供完整语义结构、真实文字、按钮和对话框，默认显示加载页。
- `src/styles.css` 是独立主题，不修改主项目共享样式。
- `src/app.ts` 导出 `createEntryExperience(host, callbacks)`。
- `src/contracts.ts` 导出回调、阶段与诊断类型，并复用项目现有 `LoadingProgress`。
- `assets/entry-scene.webp` 是运行主视觉；`src/render-assets.ts` 只用于离线复现，不需进入主游戏运行包。

组件要求 `host` 内使用 `index.html` 中 `#entry` 及其后续对话框结构。主集成 可将这份结构迁入正式视图，再用自己的回调装配；无需复制固定样例。

## API

```ts
import { createEntryExperience } from './design/entry-experience/src/app';

const entry = createEntryExperience(host, {
  onStart() {
    // 首页点击“开始上班”：资源已 ready，直接开始一局，不再加载。
    beginGameImmediately();
  },
  onEnter() {
    // 加载完成点击“进入首页”：仍在按钮点击的同步调用链内。
    // 可在这里执行真实音频解锁，并显示首页。
    void audio.resume();
    entry.setPhase('home');
  },
  async onRetry(id) {
    // 只重试对应真实资源 ID，不把重试直接视为 ready。
    await retryRealResource(id);
  },
  onSettingChange(key, value) {
    // 可映射到现有 reducedMotion / textScale 设置。
  },
});

// 启动时先预加载，不先展示首页。
entry.setPhase('loading');
entry.update(realLoadingProgress);

// ready 后由真实用户点击进入首页；之后 onStart 直接开局。
entry.setVisible(false); // 隐藏并暂停装饰线场
entry.setVisible(true);
const diagnostics = entry.getDiagnostics();
entry.destroy();
```

`onEnter` 只在真实 `stage === 'ready'` 且 `failedItems` 为空时触发。`onStart` 也检查同一就绪条件。组件内部门槛与主状态仍应保持一致，不能只靠按钮 disabled 代替程序校验。

## 真实加载数据

继续使用项目现有类型：

```ts
interface LoadingProgress {
  stage: 'download' | 'parse' | 'textures' | 'audio' | 'scene' | 'shaders' | 'ready' | 'error';
  completedResources: number;
  totalResources: number;
  bytes?: { completed: number; total: number };
  failedItems?: readonly { id: string; label: string; message: string; retryable?: boolean }[];
  detail?: string;
}
```

阶段在界面中分为五组：

| 展示组 | 真实 stage |
| --- | --- |
| 下载资源 | `download` |
| 解析与纹理 | `parse`、`textures` |
| 音频准备 | `audio` |
| 场景初始化 | `scene`、`shaders` |
| 进入首页 | `ready` |
| 错误 | `error`，失败项单独列出 |

- 件数始终使用真实 `completedResources / totalResources`。
- 只有提供可靠 `bytes` 时才显示字节数。
- 总数未知时显示真实阶段，不显示百分比；不会出现假 99% 或定时完成。
- `failedItems[].id` 原样交给 `onRetry(id)`；`retryable: false` 不显示重试按钮。
- 暂停动效只调用线场的 `setMotion`，不拦截 `update()`。

## 音频与用户手势

组件不创建另一套音频系统，也不自动启用声音。`onEnter` 在“进入首页”的按钮点击同步调用链内触发，主集成 可在这里调用现有 `audio.resume()`。首页 `onStart` 只负责立即开局，不应再次调用资源加载流程。

## 资源与线场所有权

- 本交付只读复用 `src/loading/canvas-view.ts`、`field.ts`、`types.ts` 与 `symbols.ts`；不要为接入再复制一份算法。
- 加载页到首页应保留同一个组件实例，避免重新采样。
- 组件 `setVisible(false)`、弹窗、后台与 reduced-motion 都会停止装饰循环，但不改变真实加载状态。
- 离开整个界面时调用 `destroy()`；不要在每次加载状态更新时重建组件。

## 仍需主集成联调验收

1. 启动时先完成真实预加载，再进入首页，确认首页开始可立即开局。
2. 真实下载、解析、纹理、音频、场景、着色器与 ready 更新。
3. 失败 → 单件重试 → 真实 ready → 进入首页 → 立即开局。
4. 真实音频解锁、输入焦点与后续场景切换。
5. 主项目构建、目标手机浏览器、完整游玩、性能与公开发布。
6. 安卓与 iOS 真机验证；本独立预览只完成浏览器触控与视口模拟，未宣称真机通过。

独立预览的 78 项检查不代替上述集成验收。
