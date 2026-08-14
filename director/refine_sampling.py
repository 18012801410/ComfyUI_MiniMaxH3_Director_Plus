"""Second-sample (refine) and optional pixel upscale for Director segments."""

from __future__ import annotations

import logging
from typing import Any, Callable

import torch

from ..lib.image_prep import ensure_minimax_canvas
from .core_sampling import sample_single_stage
from .refine_pack import refine_seed_for, refine_steps_for

log = logging.getLogger("ComfyUI-MiniMaxH3-Director.director.refine")

PhaseCallback = Callable[[str, float], None]
StepPreviewCallback = Callable[[int, int, Any], None]


def _unpack(out):
    if hasattr(out, "args"):
        args = out.args
        if args:
            return args
    if isinstance(out, (tuple, list)):
        return out
    return (out,)


def _latent_without_mask(latent: dict) -> dict:
    out = dict(latent)
    out.pop("noise_mask", None)
    return out


def _split_av(samples: dict):
    from comfy_extras.nodes_lt import LTXVSeparateAVLatent

    sep = LTXVSeparateAVLatent.execute(samples)
    video_latent, audio_latent = _unpack(sep)[:2]
    return video_latent, audio_latent


def _decode_video(vae, video_latent):
    from nodes import VAEDecode

    images, = VAEDecode().decode(vae, video_latent)
    return images


def _encode_video(vae, images) -> dict:
    from nodes import VAEEncode

    encoded = VAEEncode().encode(vae, images)
    latent = _unpack(encoded)[0]
    if not isinstance(latent, dict):
        latent = {"samples": latent}
    return latent


def _join_av(video_latent: dict, audio_latent, template: dict) -> dict:
    v = video_latent.get("samples") if isinstance(video_latent, dict) else video_latent
    a = audio_latent.get("samples") if isinstance(audio_latent, dict) else audio_latent
    out = dict(template)
    out.pop("noise_mask", None)
    try:
        from comfy_extras.nodes_lt import LTXVConcatAVLatent

        joined = LTXVConcatAVLatent.execute(video_latent, audio_latent)
        packed = _unpack(joined)[0]
        if isinstance(packed, dict) and "samples" in packed:
            return packed
        out["samples"] = packed
        return out
    except Exception:
        pass
    try:
        import comfy.nested_tensor

        if a is not None:
            out["samples"] = comfy.nested_tensor.NestedTensor((v, a))
        else:
            out["samples"] = v
        return out
    except Exception:
        if a is not None:
            out["samples"] = (v, a)
        else:
            out["samples"] = v
        return out


def _scale_images(images: torch.Tensor, width: int, height: int) -> torch.Tensor:
    from comfy.utils import common_upscale

    rgb = images[..., :3]
    return common_upscale(
        rgb.movedim(-1, 1), int(width), int(height), "lanczos", "disabled"
    ).movedim(1, -1)


def _upscale_with_rtx_vsr(images: torch.Tensor, width: int, height: int) -> torch.Tensor:
    """NVIDIA RTX Video Super Resolution to an explicit canvas (same idea as KJNodes)."""
    try:
        import nvvfx
    except ImportError as exc:
        raise ImportError(
            "nvidia_rtx_vsr 需要 nvidia-vfx，并使用兼容的 NVIDIA GPU。"
            "可 pip install nvidia-vfx，或把 upscale_method 改回 lanczos。"
        ) from exc

    quality = getattr(getattr(nvvfx, "effects", None), "QualityLevel", None)
    level = getattr(quality, "ULTRA", None) if quality is not None else None
    ctx = nvvfx.VideoSuperRes(level) if level is not None else nvvfx.VideoSuperRes()
    nvvfx_sr = ctx.__enter__()
    try:
        nvvfx_sr.output_width = max(8, round(int(width) / 8) * 8)
        nvvfx_sr.output_height = max(8, round(int(height) / 8) * 8)
        if hasattr(nvvfx_sr, "load"):
            nvvfx_sr.load()
        frames_chw = images[..., :3].movedim(-1, 1).contiguous()
        if frames_chw.device.type != "cuda":
            frames_chw = frames_chw.cuda()
        upscaled = []
        for i in range(int(frames_chw.shape[0])):
            dlpack_out = nvvfx_sr.run(frames_chw[i]).image
            upscaled.append(torch.from_dlpack(dlpack_out).clone())
        return torch.stack(upscaled, dim=0).movedim(1, -1)
    finally:
        try:
            ctx.__exit__(None, None, None)
        except Exception:
            pass


def _upscale_with_model(upscale_model, images: torch.Tensor, chunk: int = 4) -> torch.Tensor:
    from comfy_extras.nodes_upscale_model import ImageUpscaleWithModel

    n = int(images.shape[0])
    parts = []
    node = ImageUpscaleWithModel()
    for i in range(0, n, max(1, chunk)):
        batch = images[i : i + chunk]
        out = node.upscale(upscale_model, batch)
        frame = _unpack(out)[0]
        parts.append(frame)
    return torch.cat(parts, dim=0)


def upscale_image_batch(
    images: torch.Tensor,
    *,
    width: int,
    height: int,
    upscale_model=None,
    upscale_method: str = "lanczos",
) -> torch.Tensor:
    width, height = ensure_minimax_canvas(width, height)
    method = str(upscale_method or "lanczos").strip().lower()
    work = images
    if method == "nvidia_rtx_vsr":
        try:
            work = _upscale_with_rtx_vsr(images, width, height)
        except Exception as exc:
            log.warning("nvidia_rtx_vsr failed (%s); falling back to interpolate.", exc)
            work = images
    elif upscale_model is not None:
        try:
            work = _upscale_with_model(upscale_model, images)
        except Exception as exc:
            log.warning("Upscale model failed (%s); falling back to interpolate.", exc)
            work = images
    h, w = int(work.shape[1]), int(work.shape[2])
    if w != width or h != height:
        work = _scale_images(work, width, height)
    return work


def _repin_after_upscale(
    positive,
    latent: dict,
    *,
    vae,
    prefix_frames: torch.Tensor,
    trim_frames: int,
    task_key: str,
):
    """Rebuild motion-context keyframes at the new canvas. Does not touch first-pass."""
    from .h3_motion_context import apply_motion_context

    n = min(int(trim_frames), int(prefix_frames.shape[0]))
    if n < 1:
        return positive, False
    new_positive, _, _ = apply_motion_context(
        positive,
        latent,
        vae=vae,
        context_length=n,
        context_frames=prefix_frames[:n],
        continue_audio=False,
        keep_existing_keyframes=(task_key == "fl2v"),
    )
    return new_positive, True


def apply_segment_refine(
    plan,
    seg,
    *,
    samples: dict,
    model,
    vae,
    audio_vae=None,
    positive,
    negative,
    seed: int,
    cfg: float,
    first_steps: int,
    sampler_name: str,
    scheduler: str,
    shift_video: float,
    shift_audio: float,
    on_phase: PhaseCallback | None = None,
    on_step_preview: StepPreviewCallback | None = None,
    first_pass_images: torch.Tensor | None = None,
    trim_frames: int = 0,
) -> tuple[dict, str]:
    """Run optional refine/upscale second sample. Never raises — returns first-pass on failure.

    ``first_pass_images``: already-decoded first-pass frames (skips a second VAE
    decode in upscale mode). Includes motion-context prefix when continuity is on.
    ``trim_frames``: pinned prefix length from first pass (0 = no continuity).
    First-pass sampling is unchanged — this only runs after it.
    """
    pack = getattr(plan, "refine", None)
    if not isinstance(pack, dict) or not pack.get("enabled"):
        return samples, ""
    if pack.get("skip_fl2v", True) and getattr(seg, "task_key", "") == "fl2v":
        return samples, "refine skipped (fl2v)"

    mode = pack.get("mode") or "refine"
    denoise = float(pack.get("denoise") or 0.25)
    r_steps = refine_steps_for(pack, first_steps)
    r_seed = refine_seed_for(pack, seed)
    note_parts = [f"{mode} denoise={denoise:.2f} steps={r_steps}"]
    pin_frames = max(0, int(trim_frames or 0))
    task_key = str(getattr(seg, "task_key", "") or "")

    # Same-size refine keeps any first-pass mask so a continuity lock still holds.
    # No continuity → drop stray masks so refine can touch the whole clip.
    work = dict(samples) if pin_frames > 0 else _latent_without_mask(samples)
    refine_positive = positive
    try:
        if mode == "upscale":
            tw = int(pack.get("target_width") or 0)
            th = int(pack.get("target_height") or 0)
            if tw <= 0 or th <= 0:
                tw, th = ensure_minimax_canvas(
                    max(int(getattr(plan, "width", 1280) or 1280), 32),
                    max(int(getattr(plan, "height", 720) or 720), 32),
                )
            if on_phase:
                on_phase("upscale", 0)
            video_latent, audio_latent = _split_av(work)
            if first_pass_images is not None:
                frames = first_pass_images
            else:
                frames = _decode_video(vae, video_latent)
            frames = upscale_image_batch(
                frames,
                width=tw,
                height=th,
                upscale_model=pack.get("upscale_model"),
                upscale_method=pack.get("upscale_method") or "lanczos",
            )
            encoded = _encode_video(vae, frames)
            work = _join_av(encoded, audio_latent, work)
            if pin_frames > 0:
                try:
                    refine_positive, pinned = _repin_after_upscale(
                        refine_positive,
                        work,
                        vae=vae,
                        prefix_frames=frames,
                        trim_frames=pin_frames,
                        task_key=task_key,
                    )
                    if pinned:
                        note_parts.append(f"re-pin {pin_frames}f")
                except Exception as exc:
                    log.warning(
                        "Segment %s refine upscale re-pin failed (%s); "
                        "second sample continues without a new pin.",
                        int(getattr(seg, "index", 0)) + 1,
                        exc,
                    )
            note_parts.append(f"{tw}×{th}")
            method = pack.get("upscale_method") or "lanczos"
            if method == "nvidia_rtx_vsr":
                note_parts.append("nvidia_rtx_vsr")
            elif pack.get("has_upscale_model"):
                note_parts.append("upscale_model")
            else:
                note_parts.append("lanczos")
            if on_phase:
                on_phase("upscale", 1)

        if on_phase:
            on_phase("refine", 0)
        work = sample_single_stage(
            model=model,
            positive=refine_positive,
            negative=negative,
            latent=work,
            seed=r_seed,
            cfg=cfg,
            steps=r_steps,
            sampler_name=sampler_name,
            scheduler=scheduler,
            shift_video=shift_video,
            shift_audio=shift_audio,
            denoise=denoise,
            on_phase=None,
            on_step_preview=on_step_preview,
            preview_every=1,
            phase_name="refine",
        )
        if on_phase:
            on_phase("refine", 1)
        return work, "refine " + ", ".join(note_parts)
    except Exception as exc:
        log.warning(
            "Segment %s refine failed (%s); keeping first-pass latent.",
            int(getattr(seg, "index", 0)) + 1,
            exc,
        )
        return samples, f"refine FAILED ({exc}); used first pass"
