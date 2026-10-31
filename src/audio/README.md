# 办公室声音引擎交接 · 2026-10-31

正式源文件已移交 `src/audio/types.ts`、`engine.ts`、`music.ts`、`synthesis.ts`，行为测试为 `tests/audio.test.ts`。本目录保留草稿和独立验证配置，不是另一套产品入口。没有修改 main、contracts、UI、Kimi 表现文件或现有模型，也没有外部生成、下载采样、付费和网络音频依赖。

## 接入

```ts
import { createOfficeAudio } from './audio/engine';
const audio = createOfficeAudio({ music: .4, effects: .75, voice: .85 });
// 在真实“开始/继续”点击内直接调用，不能先等待网络或资源再请求。
void audio.resume();
// 每帧读取唯一游戏状态，由独立 observer 生成真实事件。
audio.update({
  active: page === 'playing' && !document.hidden,
  listener: { x: player.x, y: player.y + 1.4, z: player.z, yaw },
  room: room.kind,
  mood: 'office', // 只由玩家可观察的巡查/搜捕/脱险状态选择，禁止用隐藏敌人距离。
}, events);
audio.setVolumes({ music: .2 });
audio.pause(); // 暂停、失焦等；清声音、语音和定时器。
audio.reset(); // 新局；另需在其开始按钮内 resume。保留音量，清事件ID/冷却/曲式位置。
await audio.dispose(); // 关闭AudioContext，释放所有源、节点、监听器。
```

`OfficeAudioEvent` 有 cue、speech、rule 三类，见 types.ts。`id` 必须是局内稳定唯一的“事件发生”标识，不要用帧号重复包装同一事件。reset 之前相同 ID 仅消费一次；暂停/后台期间的事件消费后丢弃，恢复不会补播旧声音。每局最多记住 12000 个ID，超额停止接收新事件而不把旧事件重新放行。声音源并发上限56，所有停止/自然结束都断开节点；SFX和乐音PCM缓存仅按有限音色/音高/变体键复用。

source.position 是真实事件世界坐标；source.occlusion 为0—1，通常由正式query的solid视线给出。HRTF声像、距离衰减与低通只呈现声音，不反馈给任何玩法状态。监听者yaw遵循游戏的+Z前方。接口不接受或改写GameState。

rule.warning只播提示和传入的正式规则文字；active/restore按七类规则各自映射机械、膨胀、金属、黏连、纸风等音色。实际动作cue必须由已经发生的运动/碰撞/交互生成，尤其脚步应累计真实位移，不根据按键或未成功动作捏造音效。desk-rise后键盘恢复等链条应由observer确认仍在工作的NPC状态，不由引擎假造动作。

## 已实现内容

- 一个原创48秒曲式，办公、巡查、明确搜捕、脱险、成功、电脑状态共享同一连续拍位；房间变化不重播。和声、电钢、低音、纸质打击分层，增益平滑切换，广播/语音压低音乐和底噪。
- 原创程序合成动作声：三种地面脚步，转向/停步，键鼠、纸、打印、杯水、坐椅/拖椅/滚轮/门槛/黏连，升桌/降顶/画饼/逆流/透明墙，锅的拿起、抛出、金属/木/身体命中、落地、滚动、返还，门、灯、打卡。变体改变时序、包络、材质共振和噪声，不只是改音调。
- 分房底噪与会议室短混响。音乐与环境音不会依敌人距离变奏。
- 本地中文speechSynthesis声线优先区分领导、同事、玩家；领导广播/近处/搜查使用不同语速与台词。单句串行，冷却、优先级抢占、过期回调隔离及超时退出。无本地中文声线就不播语音，不悄悄转云端；视觉规则提示仍由主UI保留。
- 音乐/音效/语音独立音量；缺失/非法存储值归默认并钳制0—1。语音调至0立刻取消当前句。其余语音音量调整以之后的句子为准。
- 用户手势解锁、失败诊断、暂停/后台/重开、异步resume竞态及dispose；相同增益目标不会每帧追加自动化事件。

## 接线与未完成边界

主游戏事件observer、main调用、设置界面及音量持久化由主代理统一接入，本交付不宣称这些已完成。电脑全屏、小游戏、聊天消息、公司小时提示已有类型化cue/mood入口，但对应玩法没有本交付的实现，也没有被伪造为正在触发。

浏览器TTS不能直接送进WebAudio做HRTF和低通；近处语音只有距离/遮挡音量衰减及角色语气，不能称为完整空间配音。系统本地声线的表现随设备变化，不等同于演员录制或固定专业配音。若之后要求一致演员声线，需要单独明确素材来源与授权，当前没有付款或生成费用。

音乐、音效、混音和语音尚未做实际浏览器听辨、耳机/手机扬声器验收，也未做带音频的整局性能验证。自动测试只证明程序行为，不能批准听觉美感或用户设备输出。

## 验证

2026-10-31 11:17：正式音频四模块与测试的独立严格 TypeScript 编译通过；`npx vitest run tests/audio.test.ts` 14/14通过。此前全项目 `npm run typecheck` 被同时进行的 UI 修改阻塞：`src/ui/views.ts:319–322` 的 `content` 使用前未赋值；该文件不属本交付所有权，已告知主代理，不将独立音频检查冒称全项目绿灯。 主代理随后修复了该 UI 问题，本代理再次运行全项目 `npm run typecheck` 已通过。测试包含手势失败不循环请求、事件幂等和reset、暂停不补播、pending resume时暂停、优先级/旧语音回调、voice冷却与静音、拒绝云端声线、位置与墙体低通、后台/监听器释放、无ended回调时的并发上限、曲式不因切房重置、音量保持及读回隔离、相同增益不积压、有限且非零的DSP样本。WebAudio和语音是可控mock，没有把它称为实际听音。

## 来源与许可

主题旋律、和声编排、音色DSP、动作噪声/共振、短房间冲激及台词在本工程原创；没有嵌入第三方音乐、声音录音或提取系统语音文件。遵循项目自身的代码/成品授权，不擅自把用户作品额外宣告为CC0。

语音使用用户浏览器暴露的已安装本地中文声线，仅在运行时调用平台能力；不保存或再发行声线模型/录音。引擎过滤掉localService=false的云端voice。

API依据：用户交互内解锁与Promise行为见 [AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume)；世界坐标、HRTF和距离衰减见 [PannerNode](https://developer.mozilla.org/en-US/docs/Web/API/PannerNode)；中止当前语音和队列见 [SpeechSynthesis.cancel](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/cancel)。
