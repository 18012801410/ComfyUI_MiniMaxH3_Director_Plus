# example_workflows_plus — 当前节点版本示例工作流

本目录是 `example_workflows/` 的**刷新版**：全部 10 个工作流的导演台 `timeline_data`
已升级到当前节点（version 5）写入的完整字段——补齐 `audioMode` / `refImageSize` /
`toneContinuity` / `runSelect*`，上下文帧数对齐到 5/22/39/56 网格（推荐 22），
并在说明节点标注了 Plus 版新增能力（自动续拍 / 段级 seed 重掷 / 色调延续 / 接缝 declick）。

| 工作流 | task_type | UNET | 说明 |
|--------|-----------|------|------|
| `minimax_h3_director_t2v.json` | t2v | fl2va | 文生音视频 |
| `minimax_h3_director_fl2v.json` | fl2v | fl2va | 首尾帧 |
| `minimax_h3_director_r2v.json` | r2v | **ref2va** | 参考主体素材组 |
| `minimax_h3_director_v2v.json` | v2v | **ref2va** | 源视频时间轴编辑 |
| `minimax_h3_director_rv2v.json` | rv2v | **ref2va** | 源视频 + 参考图/音频 |
| `minimax_h3_director_external_groups_i2v.json` | fl2v | fl2va | 外部 Group×2 → `i2v_groups` |
| `minimax_h3_director_external_groups_r2v.json` | r2v | **ref2va** | 外部 Group×N → `r2v_groups` |
| `minimax_h3_director_二采_加速.json` | r2v | **ref2va** | Refine 二采（SIGMAS + H3 latent） |
| `minimax_h3_director_加速版.json` | r2v | **ref2va** | 加速采样 |
| `minimax_h3_director_自动续拍.json` | t2v | fl2va | **自动续拍 30s**（行级 seed 锁定演示） |

模型与完整说明见仓库根 `README.md`。原版工作流保留在 `example_workflows/`，两者接线一致。
