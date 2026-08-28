# TASK-002：逐段 seed 覆盖与重掷（验证-重掷-锁定闭环基础）

- 状态：已实现（集成验证同 TASK-001 待模型环境）
- 优先级：P1
- 依据：技术侦察 `.agents/project/reconnaissance/2026-08-28-long-video-generation.md`；
  对标 ComfyUI_MiniMax_H3_Extender 的 clip「生成→预览→重掷→验收锁定」工作流
- 决策记录：`.agents/notes/DR-2026-08-28-auto-continue-plan-layer.md`（同路线：不引入运行时编排，复用缓存与选择运行）

## 目标

为每个片段提供**独立 seed 覆盖**与**一键重掷**，使「逐段验收-重掷-锁定」闭环成立：

- 卡片未设 seed → 沿用节点级 seed（现状不变）。
- 卡片设置/重掷 seed → 仅该段一采缓存失效重新生成，其余段（指纹不变）继续命中缓存。
- 「锁定」= seed 值本身：验收满意的段保留其 seed，重跑整条时间轴时这些段从缓存复现，
  未满意的段掷新 seed 即重采。配合既有「选择运行」可只重跑勾选段。

## 范围

1. **后端**（`director/plan.py`、`director/executor_core.py`、`director/segment_cache.py`）：
   - `SegmentPlan.seed_override: int | None`；从 `segments[i].seedOverride` 解析（gen 与 video 两条 builder 路径）。
   - 采样 seed 取 `seg.seed_override ?? plan.sample_seed`（executor `_run_one_segment`）。
   - `first_pass_cache_fingerprint` 的 `seed` 字段改用段级有效 seed（改 seed 的段失效、其他段命中）。
   - `inspect_first_pass_cache` 的 current_seed 比较同步使用段级有效 seed。
   - 运行报告在 per-seg 行显示已锁定的段级 seed。
2. **前端**（`web/js/minimax_image_batch.js`、`web/js/minimax_i18n.js`）：
   - t2v/i2v/r2v 视频卡片增加 seed 输入 + 骰子重掷按钮；空 = 跟随节点 seed。
   - 写回 `seg.seedOverride`；payload batch 分支透传该字段（sanitizer 的 `...rest` 已天然保留）。

## 非目标

- 不做「自动队列下一段」的编排自动化（需要 app.queuePrompt 编排与执行事件联动，另行评估）。
- 不做 fl2v / v2v 卡片的 seed 控件（后端解析对它们同样生效，UI 后续按需补）。
- 自动续拍合成段不支持 per-seg seed（提示词列表无 seed 语义；如需要随 TASK-003 后评估）。

## 验收标准

1. 段 A 设 seed=123、其余不设：全部段重跑时 A 的指纹含 123，其余段用节点 seed；再次重跑全部命中缓存。
2. 段 A 重掷为 456：仅 A 一采缓存失效重采，其余段命中；成片仅 A 变化。
3. 不设任何 seedOverride 时：行为与改造前逐字节一致（指纹字符串相同）。
4. 卡片 seed 输入/重掷立即写回 `timeline.segments[i].seedOverride` 并持久化到 timeline_data。
5. per-seg 行 report 显示 `seed=...`（仅当该段设置了覆盖时）。

## 验证方式

- 计划层脚本（stub 环境）：指纹随 seedOverride 变化 / 无覆盖时与旧指纹一致；plan 解析正确。
- `node --check` 前端语法。
- 集成（待模型环境）：重掷单段观察仅该段重采。
