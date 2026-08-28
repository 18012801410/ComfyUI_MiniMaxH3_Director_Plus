# TASK-003：音频接缝 declick + 链式色调延续补偿（opt-in）

- 状态：已实现（集成验证待模型环境）
- 优先级：P2
- 依据：技术侦察 `.agents/project/reconnaissance/2026-08-28-long-video-generation.md`；
  对标 Herrgott Suite 的 15ms declick 与 rkfg ToneCompensate（只借鉴机制）
- 约束：本仓库 `segment_continuity.py` 已有明确教训——乘法 gain / 长 RGB blend 会造成花屏、
  接缝亮度泵（00010/00035），现仅存加法 luma 处理。故色调补偿只用**加法 bias**。

## 目标

1. **音频 declick**：多段音频合并为整条时，接缝处硬切 `torch.cat` 会产生爆音。
   在每个分段边界加 15ms 线性 fade（段首 fade-in / 段尾 fade-out，首尾段外侧不处理），默认生效。
2. **色调延续**：H3 链式分段存在累积色调漂移（社区 ToneCompensate 的动因）。开启后，
   在 `concat_continuous_chunks` 每个接缝用 prev 尾部与 next 头部各 12 帧的逐通道均值差
   计算加法 bias（每通道钳位 ±0.08），整体加到 next chunk 并 clamp 到 [0,1]。
   **默认关闭**（timeline `output.toneContinuity`），因为提示词刻意改变亮度/色调时不应被纠正。

## 范围

- `director/audio_export.py`：`_declick_part` + 合并循环应用。
- `director/segment_continuity.py`：`tone_continuity_enabled` / `_apply_tone_continuity`，
  挂入 `concat_continuous_chunks` 接缝循环（在现有 seam 处理之前，处理对象与 seam 一致）。
- `director/plan.py`：`plan_summary` 增加 Tone continuity 状态行。
- `web/js/minimax_timeline.js` + `minimax_i18n.js`：段间引导控件旁加「色调延续」checkbox，
  写 `output.toneContinuity`（payload 经 `normalizeOutputContinuity` 的展开自然透传）。

## 非目标

- 不做乘法 gain / LUT / 白平衡（仓库教训 + GPL 项目机制仅借鉴）。
- 不动 `completed_audios` 的段间音频 context（latent tail 路径不受导出合并影响）。
- 不做逐段 tone 元数据持久化/缓存指纹变化（bias 在拼接时计算，属导出阶段处理；
  不改 `segment_cache_fingerprint`，避免无谓的缓存失效）。

## 验收标准

1. 多段合并音频每个接缝 ±15ms 渐变；单段/零段行为不变。
2. `toneContinuity` 关闭（默认）时 `concat_continuous_chunks` 输出与改造前一致。
3. 开启时：next chunk 各通道加上的 bias = clamp(prev 尾均值 − next 头均值, ±0.08)；
   偏差 < 0.004 时不处理；结果 clamp [0,1]。
4. report 显示 `Tone continuity: ON`。
5. 全部已有 `CONTINUITY_*` seam 行为保持不变（declick/tone 只叠加，不替换）。

## 验证方式

- 本机无 torch：py_compile + 代码审查；数值行为待模型环境集成验证（如实标注）。
- 前端 `node --check`。
