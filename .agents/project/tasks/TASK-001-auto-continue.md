# TASK-001：自动续拍模式（Auto Continue）

- 状态：已实现（计划层 + UI 完成，集成验证待有模型环境执行）
- 优先级：P1
- 依据：技术侦察 `.agents/project/reconnaissance/2026-08-28-long-video-generation.md`（2026-08-28）
- 决策记录：`.agents/notes/DR-2026-08-28-auto-continue-plan-layer.md`

## 目标

让导演台支持「自动续拍」：用户只给定**目标时长**与**续拍提示词列表**，插件按 MiniMax H3 帧对齐自动展开为 N 段 `SegmentPlan`（prompt 从列表循环填充，末段截到目标时长），逐段生成并通过既有段间引导（motion context）衔接，最终拼接为一条长视频。分段缓存与断点续跑自动生效，无需改动 `segment_cache.py`。

## 范围

1. **计划层展开**（`director/plan.py`）：
   - 从 `timeline_data` JSON 读取 `autoContinue` 块（`enabled` / `targetSeconds` / `prompts[]` / `promptMode`（循环列表 | 复用首段）），读法对齐 `runSelectEnabled` 的解析方式（`plan.py:493` `_parse_run_selection`）。
   - `build_director_plan()`（`plan.py:555`）中：enabled 时按 `minimax_align_frame_count` 生成 N 段，每段 `continuity_from_prev=True`（首段除外），末段帧数截断到目标帧数；总帧数 `total_frames` 同步展开。
2. **节点与 UI**：
   - `nodes/director.py` 无需新增 widget 口（沿用 `timeline_data` 通道，与段间引导一致）。
   - `web/js/minimax_timeline.js` 导演台 UI 增加「自动续拍」区：开关、目标时长（秒）、提示词列表（多行，一行一段）、prompt 模式下拉；写入 timeline JSON。
3. **执行器校验**：自动续拍段强制要求 `continuityEnabled` 开启；未开启时在最早位置明确报错（不静默回退），错误信息指向段间引导开关。
4. **运行报告**：`report` 输出标注自动续拍展开结果（目标时长 → 实际段数/帧数、末段截断情况）。

## 非目标

- 不实现运行时「生成一段再决定是否续」的交互式闭环（归 TASK-002 逐段验证-重掷-锁定）。
- 不实现色调补偿、音频 declick（TASK-003）。
- 不改动 motion context 注入逻辑本身（`h3_motion_context.py` / `segment_continuity.py` 行为保持不变）。
- 不支持 v2v / rv2v 的自动续拍（这两类段依赖源视频区间，与自动展开语义冲突；仅 t2v / i2v / fl2v / r2v 开放）。
- 不做剧本→分镜的 LLM 自动分镜（P3，另行立项）。

## 验收标准

1. 开启自动续拍、目标 30s、提示词列表 3 条时：计划展开为约 7 段（按 124 帧/段对齐，末段截断），每段 `continuity_from_prev=True`（首段除外），prompt 按列表循环；`report` 中可见展开摘要。
2. 中断后重新 Queue：已生成段命中 `segment_cache` 指纹（prompt/end 变化的段不命中），仅续跑剩余段，拼接结果与一次跑完一致。
3. `continuityEnabled` 关闭时开启自动续拍：Queue 以明确错误失败，提示打开段间引导。
4. 关闭自动续拍时，既有全部任务模式与工作流行为不变（回归：现有 `example_workflows/` 各 JSON 可正常加载执行计划）。
5. fl2v 模式下自动续拍：空组沿用「引用上段」语义，不破坏首尾帧钉死保护。

## 验证方式

- 计划层：新增单元级检查（可直接 python 脚本调用 `build_director_plan` 传构造 timeline JSON），断言段数/帧区间/prompt 分配/末段截断。
- 集成：在装有 MiniMax H3 模型的 ComfyUI 环境跑 30s 自动续拍工作流（t2v），人工核对拼接连续性与断点续跑（环境受限时如实标注未跑项）。
- 回归：不开自动续拍时 `build_director_plan` 输出与改动前一致（可用改动前后对同一 timeline JSON 的 plan 序列化对比）。

## 关键代码位置

| 挂点 | 位置 |
|---|---|
| timeline JSON 解析参照 | `director/plan.py:493` `_parse_run_selection` |
| 计划构建 | `director/plan.py:555` `build_director_plan`；fl2v 分支 `plan.py:592` |
| 帧对齐 | `director/plan.py` `minimax_align_frame_count` |
| 段间引导数据流（无需改动，验证用） | `director/executor_core.py:443-497` continuity gate；`h3_motion_context.apply_motion_context` |
| 缓存指纹（无需改动，验证用） | `director/segment_cache.py:92-134` |
| UI 写入 timeline | `web/js/minimax_timeline.js`（段间引导控件区，约 :2510 附近） |
