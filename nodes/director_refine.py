"""Graph packer: Refine / upscale config for MiniMax H3 Director.refine."""

from __future__ import annotations

from ..director.refine_pack import (
    ASPECT_RATIO_CHOICES,
    DEFAULT_UPSCALE_MEGAPIXELS,
    FOLLOW_DIRECTOR_ASPECT,
    MMX_DIR_REFINE,
    REFINE_MODES,
    SEED_MODES,
    UPSCALE_METHODS,
    infer_upscale_target,
    pack_refine,
)

_CATEGORY = "MiniMaxH3"


class MiniMaxH3DirectorRefine:
    """Pack refine/upscale settings. Connect ``refine`` to Director.refine.

    ``refine``: same-resolution second sample (no upscale model).
    ``upscale``: enlarge to target canvas then second-sample. Optional UPSCALE_MODEL
    (RealESRGAN etc.); if omitted, frames are interpolated.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (
                    list(REFINE_MODES),
                    {
                        "default": "refine",
                        "tooltip": (
                            "refine = 同分辨率二采（精修）。"
                            "upscale = 先放大到目标画布再二采。"
                        ),
                    },
                ),
                "upscale_method": (
                    list(UPSCALE_METHODS),
                    {
                        "default": "lanczos",
                        "tooltip": (
                            "仅 mode=upscale。"
                            "lanczos = 插值；若接了放大模型则先跑模型再收到目标尺寸。"
                            "nvidia_rtx_vsr = NVIDIA RTX Video Super Resolution，按目标宽高出图"
                            "（需 nvidia-vfx + NVIDIA GPU，与 KJNodes Resize 同类）。"
                        ),
                    },
                ),
                "denoise": (
                    "FLOAT",
                    {
                        "default": 0.25,
                        "min": 0.05,
                        "max": 0.85,
                        "step": 0.01,
                        "tooltip": "二采 denoise。默认 0.25；越大改动越大。",
                    },
                ),
                "steps": (
                    "INT",
                    {
                        "default": 10,
                        "min": 0,
                        "max": 200,
                        "tooltip": "二采步数。0 = 自动（约导演台 steps 的 40%，最少 8）。",
                    },
                ),
            },
            "optional": {
                "seed_mode": (
                    list(SEED_MODES),
                    {
                        "default": "inherit",
                        "tooltip": "inherit = 用导演台 seed；offset = seed+1。",
                    },
                ),
                "aspect_ratio": (
                    list(ASPECT_RATIO_CHOICES),
                    {
                        "default": FOLLOW_DIRECTOR_ASPECT,
                        "tooltip": (
                            "放大目标画布，算法同导演台「输出分辨率」。"
                            "跟随导演台：按导演台画布比例推 720P 档。"
                            "比例预设：配合百万像素。"
                            "自定义：直接填宽高（对齐 ×32）。"
                        ),
                    },
                ),
                "megapixels": (
                    "FLOAT",
                    {
                        "default": DEFAULT_UPSCALE_MEGAPIXELS,
                        "min": 0.0,
                        "max": 16.0,
                        "step": 0.1,
                        "tooltip": (
                            "百万像素，同导演台 ResolutionSelector。"
                            "1.0 MP 在 16:9 约为 1376×768（对齐 32）。仅比例预设时生效。"
                        ),
                    },
                ),
                "width": (
                    "INT",
                    {
                        "default": 1280,
                        "min": 0,
                        "max": 8192,
                        "step": 32,
                        "tooltip": "自定义宽度（×32）。仅「自定义」时生效。",
                    },
                ),
                "height": (
                    "INT",
                    {
                        "default": 720,
                        "min": 0,
                        "max": 8192,
                        "step": 32,
                        "tooltip": "自定义高度（×32）。仅「自定义」时生效。",
                    },
                ),
                "skip_fl2v": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "tooltip": (
                            "跳过首尾帧（fl2v）镜头的二采/放大。"
                            "二采会改画面，容易把钉死的首尾帧画飘；默认跳过以保护关键帧。"
                            "关掉则 fl2v 也走精修。"
                        ),
                    },
                ),
                "upscale_model": (
                    "UPSCALE_MODEL",
                    {
                        "tooltip": (
                            "可选。用「加载放大模型」接入，例如 RealESRGAN_x2plus。"
                            "仅 mode=upscale 且 upscale_method=lanczos 时使用。"
                            "选 nvidia_rtx_vsr 时忽略此口。"
                        ),
                    },
                ),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **_kwargs):
        # Skip combo/min checks so old workflows (target_width=0 → aspect_ratio) can load.
        return True

    RETURN_TYPES = (MMX_DIR_REFINE, "INT", "INT")
    RETURN_NAMES = ("refine", "width", "height")
    FUNCTION = "pack"
    CATEGORY = _CATEGORY
    DESCRIPTION = (
        "MiniMax H3 Director Refine: connect to Director.refine. "
        "Director.images is the refined / upscaled result; "
        "Director.images_pre_refine is the first-pass video (before second sample). "
        "Upscale canvas uses the same aspect + megapixels / custom W×H as Director. "
        "width / height are the resolved target canvas (×32). "
        "Does not sample by itself — no IMAGE output."
    )

    def pack(
        self,
        mode="refine",
        denoise=0.25,
        steps=10,
        seed_mode="inherit",
        aspect_ratio=FOLLOW_DIRECTOR_ASPECT,
        megapixels=DEFAULT_UPSCALE_MEGAPIXELS,
        width=1280,
        height=720,
        skip_fl2v=True,
        upscale_method="lanczos",
        upscale_model=None,
        target_width=0,
        target_height=0,
        **kwargs,
    ):
        del kwargs
        try:
            mp = float(megapixels)
        except (TypeError, ValueError):
            mp = DEFAULT_UPSCALE_MEGAPIXELS
        if mp < 0.1:
            mp = DEFAULT_UPSCALE_MEGAPIXELS
        try:
            w = int(width or 0)
        except (TypeError, ValueError):
            w = 1280
        try:
            h = int(height or 0)
        except (TypeError, ValueError):
            h = 720
        if w < 32:
            w = 1280
        if h < 32:
            h = 720
        pack = pack_refine(
            mode=mode,
            denoise=denoise,
            steps=steps,
            seed_mode=seed_mode,
            aspect_ratio=aspect_ratio,
            megapixels=mp,
            width=w,
            height=h,
            target_width=target_width,
            target_height=target_height,
            skip_fl2v=skip_fl2v,
            upscale_method=upscale_method,
            upscale_model=upscale_model,
        )
        out_w = int(pack.get("target_width") or 0)
        out_h = int(pack.get("target_height") or 0)
        if out_w <= 0 or out_h <= 0:
            out_w, out_h = infer_upscale_target(0, 0)
        return (pack, int(out_w), int(out_h))
