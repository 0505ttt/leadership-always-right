# 《领导说的都是真的》首页与加载体验

**状态：独立视觉与交互预览已完成；尚未接入主游戏。**

**流程：打开游戏 → 预加载资源 → 进入首页 → 开始上班立即开局。** 首页不会再次触发资源加载。

本目录是完整独立交付，不修改 主集成 正在维护的 `src/loading`、`src/main.ts`、主场景或共享 UI 样式，也不修改其他 Kimi 会话的角色与道具资产。

## 查看

在本目录运行：

```sh
npm run dev
```

打开终端给出的地址。生产构建与独立验证：

```sh
npm run typecheck
npm run build
node scripts/verify.mjs
```

预览状态：

- `/`：默认先显示资源加载页。
- `/?ui=home`：资源已就绪的首页，开始上班立即开局。
- `/?ui=loading`：资源准备中。
- `/?ui=ready`：准备完成，可进入首页。
- `/?ui=error`：失败与单件重试。
- 追加 `&chrome=0`：隐藏固定样例工具条。

未隐藏工具条时，可手动切换首页、加载中、可进入和失败。所有加载数字均为**固定预览样例**，不是实际资源服务结果；重试后等待下一次状态注入，不用定时器伪造完成。

## 交付内容

| 内容 | 文件 |
| --- | --- |
| 页面结构、真实文字与按钮 | `index.html` |
| 视觉主题、桌面与手机布局 | `src/styles.css` |
| 展示组件与状态门槛 | `src/app.ts` |
| 对接类型 | `src/contracts.ts` |
| 量化线场只读复用入口 | `src/line-field.ts` |
| 固定样例与独立预览装配 | `src/main.ts` |
| 真实角色主视觉 | `assets/entry-scene.webp`，40,540 bytes |
| 主视觉可复现渲染 | `src/render-assets.ts`、`scripts/render-assets.mjs` |
| 视觉规范与现状诊断 | `DESIGN.md` |
| 主集成 对接接口 | `INTEGRATION.md` |
| 浏览器检查与截图 | `output/report.json`、`output/*.png` |

## 实看截图

以下 14 张截图均来自本次独立预览的真实浏览器运行，并已逐张查看：

- `output/desktop-home-1440x900.png`
- `output/desktop-loading-1440x900.png`
- `output/desktop-ready-1440x900.png`
- `output/desktop-error-1440x900.png`
- `output/mobile-home-390x844.png`
- `output/mobile-ready-390x844.png`
- `output/mobile-error-390x844.png`
- `output/mobile-landscape-home-844x390.png`
- `output/mobile-landscape-ready-844x390.png`
- `output/mobile-home-360x740.png`
- `output/mobile-tutorial-360x740.png`
- `output/mobile-ready-360x740.png`
- `output/mobile-landscape-home-740x360.png`
- `output/mobile-landscape-ready-740x360.png`

手机截图的设备像素比为 2；文件名使用 CSS 视口尺寸。

## 已验证

最终独立浏览器回归共 **78 项检查通过，`errors` 为空**：

- 默认预加载 → ready → 进入首页 → 开始上班立即开局，不再二次加载。
- 公司标识与教程不能绕过未完成的加载。
- error → 精确资源 ID 重试；ready 但仍有失败项时继续禁止进入。
- 下载、解析/纹理、音频、场景/着色器、进入首页五组状态。
- 暂停装饰动效后，真实状态更新仍可到达 ready。
- 单次采样、resize 不重新采样、键盘聚焦与触控扫描。
- 来源弹窗暂停装饰帧，Escape 关闭并恢复焦点。
- 设置、三页教程、系统 reduced-motion，以及教程中的真实键鼠和触控操作。
- 桌面与手机无横向溢出；可见按钮目标不小于 44px；主要动作位于首屏且不被遮挡。
- 360×740 竖屏、740×360 横屏与手机长教程操作可达。
- 类型检查与生产构建通过。

验证脚本启动的临时服务已关闭；报告记录 `ownedServerStopped: true`、`portReleased: true`。

## 边界与未测项

- 本交付不是主游戏接入完成证明，也不代表真实资源链路、音频解锁、完整游玩、性能或公开发布已验收。
- 手机结果来自浏览器视口与触控模拟；**未进行安卓或 iOS 真机验证，不能写成真机通过。**
- 主场景中的触控 CSS 与游戏规则不在本会话修改范围；这里的遮挡结论只针对独立首页、加载与菜单预览。
- 首页不在运行时下载整套 GLB；主视觉由现有正式资产离线渲染为轻量透明 WebP。Canvas 线场仍按规范实时计算，没有用图片替代线场。
- 主集成负责真实资源加载、音频、游戏计时、输入、主状态与最终集成验收。
