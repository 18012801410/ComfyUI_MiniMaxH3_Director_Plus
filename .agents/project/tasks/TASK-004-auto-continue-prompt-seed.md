# TASK-004：自动续拍提示词行级 seed（打通 TASK-001 × TASK-002）

- 状态：已实现（集成验证待模型环境）
- 优先级：P2
- 前置：TASK-001（自动续拍）、TASK-002（段级 seed 覆盖）

## 目标

自动续拍合成段支持逐段 seed 锁定：续拍提示词列表每行可选携带 seed，
格式 **`提示词 | seed`**（`|` 后为非负整数时生效；无 `|` 或解析失败 = 该段跟随节点 seed）。
合成段自动获得 `seedOverride`，指纹随之按段区分——续拍链中验收满意的段锁 seed，
其余段掷新 seed 只重采自己，与手排卡片行为一致。

## 范围

- `director/gen_timeline.py`：`auto_continue_shape` 解析行级 seed（`_split_prompt_seed`）；
  `apply_auto_continue` 写 `seg["seedOverride"]`；`autoContinueApplied.seededCount` 进报告。
- `web/js/minimax_i18n.js`：续拍提示词面板 hint / tooltip 补充格式说明。
- 无 UI 结构改动（textarea 行格式即界面）。

## 非目标

- 不做「自动队列下一段」编排（另行评估）。
- 不做 fl2v/v2v 卡片 seed 控件。

## 验收标准

1. `"镜A | 111"` → 该段 prompt=`镜A`、seedOverride=111；`"镜B"` → seed 无覆盖；
   `"镜C | abc"` → 整行视为提示词、无覆盖；`"| 222"` → prompt 为空（回落全局提示词）、seed=222。
2. 合成段指纹的 seed 字段反映行级 seed；无 seed 行与节点 seed 一致。
3. 报告 Auto continue 行显示带 seed 的段数。
4. 无 `|` 用法时行为与 TASK-001 完全一致（回归）。
