# DR-2026-08-28：长视频生成走「计划层自动续拍」而非单次长采样

## 背景

基于 MiniMax H3 Director + 改造长视频生成能力（TASK-001）。GitHub 调研（见
`.agents/project/reconnaissance/2026-08-28-long-video-generation.md`）显示社区有分段链式
（Extender / Herrgott Suite）与单次长采样（LongMedia / Sampler Unlimited）两条路线。

## 决策

采用**计划层预先展开**实现「自动续拍」：

- 用户给定目标时长 + 提示词列表（或复用全局提示词），`build_gen_director_plan` 在构建计划时
  按 17k+5 帧网格合成 N 个 `SegmentPlan`（末段向上对齐），复用既有段间引导
  （motion context pin）与分段缓存，执行器零改动。
- 明确排除：单次长采样路线（VRAM 风险高、与分段架构冲突）；运行时交互式续拍闭环
  （归 TASK-002）；v2v/rv2v/fl2v 的自动续拍（源区间/首尾帧钉死语义冲突）。

## 理由

1. 最小变更：仅 `director/gen_timeline.py`（合成段）、`director/plan.py`（计数/报告）、
   `web/js`（控件）三处；continuity 数据流与缓存指纹天然支持动态段，断点续跑免费获得。
2. 无效配置（时长 ≤0、列表为空、段间引导未开）在计划构建/计数最早位置抛 `ValueError`。
3. 许可约束：Herrgott Suite 为 GPL-3.0，只借鉴机制（latent context、declick）不搬代码。

## 影响

- 长视频输出总时长为目标时长向上对齐到网格，可能超出至多一个网格步（报告注明）。
- 自动续拍开启时现有片段卡片不参与执行（UI 提示已注明）；功能关闭时行为与改造前一致。
