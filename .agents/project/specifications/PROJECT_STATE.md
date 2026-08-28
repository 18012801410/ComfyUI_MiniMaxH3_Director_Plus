# PROJECT_STATE

更新日期：2026-08-28

## 当前阶段

长视频生成改造 —— TASK-001/002/003/004 已实现，待模型环境集成验证。

## 当前任务

- **TASK-001 自动续拍模式**：已实现。计划层按 17k+5 网格展开目标时长为多段，复用段间引导与分段缓存。
- **TASK-002 逐段 seed 覆盖与重掷**：已实现。卡片 seed 输入 + 🎲 重掷，锁定 = 保留 seed。
- **TASK-003 音频 declick + 色调延续**：已实现。接缝 15ms 渐变（默认）；色调延续 opt-in 加法 bias。
- **TASK-004 续拍提示词行级 seed**：已实现。提示词行「提示词 | seed」为合成段指定 seedOverride，
  打通自动续拍 × 段级 seed 锁定；报告显示 seeded 段数。
- 验证：stub/数值脚本全部通过（含 TASK-004 行解析边界 16 项、TASK-001/002/003 回归）；
  py_compile 与 node --check 通过；diff +536/-4 无换行符污染。

## 已完成

- 技术侦察：GitHub 上 MiniMax H3 长视频生态调研（Extender、Herrgott Suite、ToneCompensate 等），结论：在现有段间引导架构上做「自动续拍链」增量改造，不做单次长采样路线。记录：`.agents/project/reconnaissance/2026-08-28-long-video-generation.md`。

## 决策记录

- `.agents/notes/DR-2026-08-28-auto-continue-plan-layer.md`：长视频采用计划层自动续拍，排除单次长采样与运行时交互闭环。

## 待办队列（优先级序）

1. TASK-001~004 集成验证：有模型环境 Queue 30s t2v 自动续拍（含行级 seed 锁定）+ 单段重掷 +
   色调延续开关对比，核对出片/断点续跑/漂移/接缝听感
2. 候选：「自动队列下一段」编排（app.queuePrompt + 执行事件联动）；fl2v/v2v 卡片 seed 控件
3. P3 候选：剧本→分镜 LLM 自动分镜；latent context 注入档位

## 已知问题 / 风险

- **未运行**：真实模型环境集成验证（30s t2v 自动续拍实际出片、断点续跑命中缓存、拼接连续性）
  —— 本机无 ComfyUI/torch 环境，需用户在有模型的环境 Queue 验证。
- 分段长视频的身份/色调/运动漂移无银弹，需在集成验证中实测 ≥5 段漂移情况，为 TASK-003 提供证据。
- H3 frozen tail 现象对现有 motion context 路径的影响未实验确认（见侦察记录 §6）。
- 本插件尚未建立完整规格包（PROJECT_BRIEF 等）；当前以上游仓库 README 为事实来源，改造期间若架构实质变更需先补规格。

## 交接说明

- 段间引导 / 选择运行 / 缓存指纹等关键代码位置见 TASK-001 的「关键代码位置」表与侦察记录 §2。
- 前端主文件 `web/js/minimax_timeline.js` 约 1.2 万行，改动注意局部化。
