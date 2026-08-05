/** Multi prompt-group UI for t2i / i2i / r2i / t2v / i2v / r2v (prompt batch mode). */

import { api } from "../../scripts/api.js";
import {
    DEFAULT_ASPECT_RATIO,
    DEFAULT_MEGAPIXELS,
    defaultDurationSec,
    defaultFrameCount,
    durationToMiniMaxFrames,
    framesToDurationSec,
    imageBatchVariant,
    isVideoBatchTask,
    MAX_GEN_FRAMES,
    MAX_REFERENCE_AUDIOS,
    MAX_REFERENCE_IMAGES,
    MAX_REFERENCE_VIDEOS,
    maxDurationSec,
    MINIMAX_CANVAS_MULTIPLE,
    minDurationSec,
    minFrameCount,
    newBatchSegment,
    preferredDurationSecFromFrames,
    refAudioLabel,
    refImageLabel,
    refVideoLabel,
    resolveTaskKey,
} from "./minimax_gen_timeline.js";
import { wirePromptImageMentions } from "./minimax_prompt_mentions.js";
import { t } from "./minimax_i18n.js";

const _players = new WeakMap();

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

/** User-facing seconds: keep free-form durationSec; only derive from frames for legacy rows. */
function resolveSegmentDurationSec(seg, defFc) {
    const fc = parseInt(seg._videoFrameCount ?? seg.frameCount ?? seg.length ?? defFc, 10) || defFc;
    if (seg.durationSec != null && Number.isFinite(Number(seg.durationSec))) {
        const sec = Number(seg.durationSec);
        // Heal values that were frames/fps round-trips (124f → 5.17) back to a nice input (5).
        const rawInverse = framesToDurationSec(fc, 24);
        if (Math.abs(sec - rawInverse) < 0.001) {
            return preferredDurationSecFromFrames(fc, 24);
        }
        return Math.round(sec * 100) / 100;
    }
    return preferredDurationSecFromFrames(fc, 24);
}

function formatPreviewFps(value) {
    const fps = Math.round(Number(value) * 100) / 100;
    if (Number.isInteger(fps)) return String(fps);
    return fps.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function stopPlayer(el) {
    const st = _players.get(el);
    if (!st) return;
    st.playing = false;
    if (st.timer) {
        clearInterval(st.timer);
        st.timer = null;
    }
}

function stopAllPlayers(root) {
    root?.querySelectorAll(".bd-batch-vpreview")?.forEach((wrap) => stopPlayer(wrap));
}

export const IMAGE_BATCH_STYLES = `
.bd-btn.bd-disabled,.bd-btn:disabled{opacity:.38;cursor:not-allowed;pointer-events:none}
.bd-mode button.bd-disabled,.bd-mode button:disabled{opacity:.38;cursor:not-allowed;pointer-events:none}
.bd-batch{width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:8px}
.bd-batch-i2v-notice{display:none;color:#ffb74d;background:#3a2a12;border:1px solid #a67c00;border-radius:6px;padding:8px 10px;font-size:11px;line-height:1.5}
.bd-batch-i2v-notice.visible{display:block}
.bd-batch-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bd-batch-run-select.active{background:#1a3a2a;color:#4fff8f;border-color:#4fff8f}
.bd-batch-run-all{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#aaa;cursor:pointer;user-select:none}
.bd-batch-run-all.hidden{display:none!important}
.bd-batch-run-all input{width:14px;height:14px;margin:0;cursor:pointer;accent-color:#4fff8f}
.bd-batch-list{display:flex;flex-direction:column;gap:8px;width:100%;max-height:640px;overflow-y:auto;padding-right:2px}
.bd-batch-card{background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:8px;display:grid;grid-template-columns:auto minmax(0,1fr) minmax(120px,30%);gap:8px;align-items:stretch}
/* r2v 2×2: 参考图(2行) | 视频+音频 / 提示词 | 预览 */
.bd-batch-card.bd-batch-r2v{grid-template-columns:minmax(0,1.15fr) minmax(220px,.85fr);grid-template-rows:auto auto minmax(110px,1fr);gap:8px;align-items:stretch}
.bd-batch-card.running{border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.25)}
.bd-batch-card.done{border-color:#3a5080}
.bd-batch-card.run-skipped{opacity:.42}
/* selected / run-on must win over .done so timeline ↔ card selection stays visible */
.bd-batch-card.selected,.bd-batch-card.selected.done{border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.35)}
.bd-batch-card.run-on:not(.run-skipped){border-color:#3a7a55}
.bd-batch-card.selected.run-on,.bd-batch-card.selected.run-on.done{border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.4)}
.bd-batch-head{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.bd-batch-head b{color:#ccc;font-size:11px}
.bd-batch-run-check{width:14px;height:14px;margin:0;cursor:pointer;accent-color:#4fff8f;flex-shrink:0}
.bd-batch-head-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bd-batch-fc{display:flex;align-items:center;gap:4px;color:#888;font-size:10px}
.bd-batch-fc input{width:52px;background:#181818;border:1px solid #444;border-radius:4px;color:#eee;padding:3px 5px;font-size:11px}
.bd-batch-del{background:transparent;border:1px solid #553;color:#f88;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer}
.bd-batch-del:hover{background:#3a1515}
.bd-batch-media{display:flex;flex-direction:column;gap:4px;min-width:88px;max-width:120px}
.bd-batch-r2v-imgs{grid-column:1;grid-row:2;min-width:0;display:flex;flex-direction:column;gap:3px;align-self:start}
.bd-batch-r2v-av{grid-column:2;grid-row:2;min-width:0;display:flex;flex-direction:column;gap:6px;align-self:stretch;justify-content:space-between}
.bd-batch-src{width:88px;height:88px;border:1px dashed #555;border-radius:4px;background:#111;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;color:#666;font-size:9px;text-align:center;padding:4px;box-sizing:border-box}
.bd-batch-src.has-img{border-style:solid;border-color:#444}
.bd-batch-src img{width:100%;height:100%;object-fit:contain;background:#000}
.bd-batch-refs{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;width:108px}
/* 9 张参考图：5+4 两行，压缩纵向占用 */
.bd-batch-r2v .bd-batch-refs{grid-template-columns:repeat(5,minmax(0,1fr));width:100%;max-width:none;gap:4px}
.bd-batch-ref{position:relative;aspect-ratio:1;border:1px dashed #555;border-radius:3px;background:#111;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;font-size:8px;color:#666}
.bd-batch-r2v .bd-batch-ref{aspect-ratio:4/3;background:#0a0a0a;min-height:0}
.bd-batch-ref.has-img{border-style:solid}
.bd-batch-ref img{width:100%;height:100%;object-fit:cover}
/* r2v：完整展示，不裁切 */
.bd-batch-r2v .bd-batch-ref img{width:100%;height:100%;object-fit:contain;object-position:center;background:#000}
.bd-batch-ref .x{position:absolute;top:0;right:2px;color:#f88;font-size:10px;display:none;line-height:1}
.bd-batch-ref:hover .x{display:block}
.bd-batch-media-block{display:flex;flex-direction:column;gap:4px;min-width:0}
.bd-batch-media-block .bd-label{color:#888;font-size:10px}
.bd-batch-r2v-av .bd-batch-media-block{flex:1 1 0;min-height:0}
.bd-batch-audios,.bd-batch-videos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;width:100%;max-width:420px}
.bd-batch-r2v .bd-batch-audios,.bd-batch-r2v .bd-batch-videos{max-width:none;gap:4px;flex:1 1 auto}
.bd-batch-audio,.bd-batch-video{position:relative;min-height:44px;border:1px dashed #555;border-radius:4px;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;padding:6px 4px;box-sizing:border-box;font-size:9px;color:#666;text-align:center;line-height:1.25}
.bd-batch-r2v .bd-batch-audio,.bd-batch-r2v .bd-batch-video{min-height:0;height:100%;flex:1 1 auto}
.bd-batch-audio.has-audio,.bd-batch-video.has-video{border-style:solid;border-color:#4a6a4a;color:#cfe;background:#152015}
.bd-batch-audio:hover,.bd-batch-video:hover{border-color:#7a9cff}
.bd-batch-audio .name,.bd-batch-video .name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9ad;font-size:9px;padding:0 2px}
.bd-batch-audio .x,.bd-batch-video .x{position:absolute;top:1px;right:3px;color:#f88;font-size:12px;display:none;line-height:1}
.bd-batch-audio:hover .x,.bd-batch-video:hover .x{display:block}
.bd-batch-prompts{display:flex;flex-direction:column;gap:4px;min-width:0}
.bd-batch-prompts .bd-label{color:#888;font-size:10px}
.bd-batch-prompts textarea{width:100%;min-height:88px;background:#181818;border:1px solid #333;border-radius:4px;color:#eee;padding:6px;resize:vertical;font-size:11px;box-sizing:border-box;font-family:inherit;line-height:1.35}
.bd-batch-r2v .bd-batch-prompts{grid-column:1;grid-row:3;min-height:0}
.bd-batch-r2v .bd-batch-prompts textarea{min-height:120px;height:100%;resize:vertical}
.bd-batch-preview{background:#0d0d0d;border:1px solid #333;border-radius:4px;min-height:100px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;color:#555;font-size:10px;text-align:center;padding:4px;box-sizing:border-box}
.bd-batch-r2v .bd-batch-preview{grid-column:2;grid-row:3;min-height:120px;height:100%}
.bd-batch-preview img{max-width:100%;max-height:160px;object-fit:contain;display:block}
.bd-batch-r2v .bd-batch-preview img{max-height:100%}
.bd-batch-vpreview{width:100%;height:100%;display:flex;flex-direction:column;align-items:stretch;gap:4px;min-height:0}
.bd-batch-vpreview canvas{width:100%;flex:1 1 auto;min-height:80px;max-height:100%;background:#000;border-radius:3px;display:block}
.bd-batch-vpreview-ctrl{display:flex;align-items:center;justify-content:center;gap:6px}
.bd-batch-vpreview-ctrl button{font-size:10px;padding:2px 8px}
.bd-batch-vpreview-meta{color:#666;font-size:9px;text-align:center}
@media(max-width:860px){
.bd-batch-card.bd-batch-r2v{grid-template-columns:1fr;grid-template-rows:auto}
.bd-batch-r2v-imgs,.bd-batch-r2v-av,.bd-batch-r2v .bd-batch-prompts,.bd-batch-r2v .bd-batch-preview{grid-column:1;grid-row:auto}
.bd-batch-r2v .bd-batch-preview{min-height:100px}
}
@media(max-width:720px){
.bd-batch-card{grid-template-columns:1fr}
.bd-batch-preview{min-height:80px}
}
`;

const BATCH_CHUNK_SIZE = 8 * 1024 * 1024;
const BATCH_UPLOAD_SOFT_LIMIT = 95 * 1024 * 1024;

async function uploadImage(file) {
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("overwrite", "true");
    const resp = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!resp.ok) throw new Error(await resp.text() || `Upload failed (${resp.status})`);
    return resp.json();
}

async function uploadChunked(file) {
    const uploadId = crypto.randomUUID();
    const totalChunks = Math.ceil(file.size / BATCH_CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
        const start = i * BATCH_CHUNK_SIZE;
        const end = Math.min(start + BATCH_CHUNK_SIZE, file.size);
        const body = new FormData();
        body.append("upload_id", uploadId);
        body.append("chunk_index", String(i));
        body.append("total_chunks", String(totalChunks));
        body.append("filename", file.name);
        body.append("chunk", file.slice(start, end), `${file.name}.part`);
        const resp = await api.fetchApi("/minimax/director/upload_chunk", { method: "POST", body });
        if (!resp.ok) throw new Error(await resp.text() || `分块上传失败 (${resp.status})`);
        const data = await resp.json();
        if (data.name) return data;
    }
    throw new Error("分块上传未完成");
}

async function uploadMedia(file) {
    if (file.size <= BATCH_UPLOAD_SOFT_LIMIT) {
        try {
            return await uploadImage(file);
        } catch (err) {
            const msg = String(err?.message || err || "");
            if (!/too large|size|413/i.test(msg)) throw err;
        }
    }
    return uploadChunked(file);
}

function relPath(upload) {
    const name = upload.name || upload.filename;
    const sub = (upload.subfolder || "").replace(/\\/g, "/").replace(/\/$/, "");
    return sub ? `${sub}/${name}` : name;
}

function viewUrl(imageFile) {
    const norm = String(imageFile || "").replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    const filename = slash >= 0 ? norm.slice(slash + 1) : norm;
    const subfolder = slash >= 0 ? norm.slice(0, slash) : "";
    const params = new URLSearchParams({ filename, type: "input" });
    if (subfolder) params.set("subfolder", subfolder);
    return api.apiURL(`/view?${params.toString()}`);
}

export function mountImageBatchPanel(root) {
    const panel = document.createElement("div");
    panel.className = "bd-batch hidden";
    panel.dataset.r = "batch-panel";
    panel.innerHTML = `
        <div class="bd-batch-toolbar">
            <button type="button" class="bd-btn bd-btn-primary" data-a="batch-add" data-i18n="batch.addPromptGroup">+ 添加提示词组</button>
            <button type="button" class="bd-btn bd-batch-run-select hidden" data-a="batch-run-select" data-i18n="toolbar.runSelect" data-i18n-title="tooltip.batchRunSelect">选择运行</button>
            <label class="bd-batch-run-all hidden" data-r="batch-run-all-wrap" data-i18n-title="tooltip.runSelectAll">
                <input type="checkbox" data-r="batch-run-all-cb">
                <span data-i18n="toolbar.selectAll">全选</span>
            </label>
            <span class="bd-meta" data-r="batch-hint" data-i18n="batch.hint.defaultImage">每组生成 1 张图片</span>
        </div>
        <div class="bd-batch-i2v-notice" data-r="batch-i2v-notice"></div>
        <div class="bd-batch-list" data-r="batch-list"></div>`;
    root.appendChild(panel);
    return {
        panel,
        list: panel.querySelector('[data-r="batch-list"]'),
        hint: panel.querySelector('[data-r="batch-hint"]'),
        i2vNotice: panel.querySelector('[data-r="batch-i2v-notice"]'),
        addBtn: panel.querySelector('[data-a="batch-add"]'),
        runSelectBtn: panel.querySelector('[data-a="batch-run-select"]'),
        runSelectAllWrap: panel.querySelector('[data-r="batch-run-all-wrap"]'),
        runSelectAllCb: panel.querySelector('[data-r="batch-run-all-cb"]'),
    };
}

export function wireBatchRunSelectControls(editor, batchUi) {
    editor.batchRunSelectBtn = batchUi.runSelectBtn;
    editor.batchRunSelectAllWrap = batchUi.runSelectAllWrap;
    editor.batchRunSelectAllCb = batchUi.runSelectAllCb;
    batchUi.runSelectBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        editor.toggleRunSelectMode?.();
    });
    batchUi.runSelectAllCb?.addEventListener("change", (e) => {
        e.stopPropagation();
        if (!editor.isRunSelectEnabled?.()) return;
        editor.setRunSelectionAll?.(batchUi.runSelectAllCb.checked);
    });
}

function cloneRefs(refs) {
    if (!Array.isArray(refs) || !refs.length) return [];
    try {
        return JSON.parse(JSON.stringify(refs));
    } catch {
        return refs.map((r) => ({ ...r }));
    }
}

/** Copy global.refs into batch segments that have no refs (r2i / r2v). */
export function migrateGlobalRefsIntoBatchSegments(editor, taskKey) {
    const key = resolveTaskKey(taskKey || editor.getTaskKey?.() || "");
    if (key !== "r2i" && key !== "r2v") return false;
    const globalRefs = editor.timeline?.global?.refs;
    if (!Array.isArray(globalRefs) || !globalRefs.length) return false;
    let moved = false;
    for (const seg of editor.timeline.segments || []) {
        if ((seg.refs || []).length) continue;
        seg.refs = cloneRefs(globalRefs);
        moved = true;
    }
    return moved;
}

export function ensureImageBatchTimeline(editor) {
    editor.timeline.editMode = "segment";
    editor.timeline.output = editor.timeline.output || {};
    const taskKey = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    editor.timeline.output.mode = "fixed";
    if (!editor.timeline.output.aspectRatio) editor.timeline.output.aspectRatio = DEFAULT_ASPECT_RATIO;
    if (editor.timeline.output.megapixels == null) editor.timeline.output.megapixels = DEFAULT_MEGAPIXELS;
    if (editor.timeline.output.multiple == null) editor.timeline.output.multiple = MINIMAX_CANVAS_MULTIPLE;
    if (!isVideoBatchTask(taskKey)) {
        editor.timeline.output.exportMode = "all";
    }
    const defFc = defaultFrameCount(taskKey);
    if (taskKey === "i2v") {
        editor.timeline.video = {
            fileName: "",
            videoFile: "",
            subfolder: "",
            type: "input",
            frames: [],
            frameMap: [],
        };
        editor.timeline.videoClips = [];
    }
    if (!editor.timeline.segments?.length) {
        editor.timeline.segments = [newBatchSegment({ durationSec: defaultDurationSec(taskKey) })];
    }
    // r2i/r2v need per-group refs. If the user came from rv2v (global refs) or left
    // refs only on global, copy them into empty batch groups so generation actually
    // receives reference_image_* — otherwise it silently behaves like t2v/t2i.
    migrateGlobalRefsIntoBatchSegments(editor, taskKey);
    for (const seg of editor.timeline.segments) {
        if (isVideoBatchTask(taskKey)) {
            const sec = resolveSegmentDurationSec(seg, defFc);
            const fc = durationToMiniMaxFrames(sec, 24);
            seg.durationSec = sec;
            seg.frameCount = fc;
            seg.length = fc;
            seg._videoFrameCount = fc;
        } else {
            const prevFc = parseInt(seg.frameCount ?? seg.length, 10) || 0;
            if (prevFc > 1) seg._videoFrameCount = prevFc;
            seg.frameCount = 1;
            seg.length = 1;
        }
        seg.negativePrompt = seg.negativePrompt ?? "";
        seg.genImage = seg.genImage || { imageFile: seg.imageFile || "" };
        // Do NOT clear refs for i2v — backend ignores them, but wiping here breaks
        // r2v → i2v → r2v (user loses uploaded reference images).
        seg.refs = seg.refs || [];
        seg.refAudios = seg.refAudios || seg.ref_audios || [];
        seg.refVideos = seg.refVideos || seg.ref_videos || [];
        seg.previewB64 = seg.previewB64 || "";
        seg.previewFrames = seg.previewFrames || [];
        seg.previewFps = seg.previewFps || parseFloat(editor.frameRateWidget?.value || 24);
        if (!seg.id) seg.id = newBatchSegment().id;
    }
    normalizeImageBatchSegments(editor);
}

export function normalizeImageBatchSegments(editor) {
    const taskKey = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    const isVideo = isVideoBatchTask(taskKey);
    const defFc = defaultFrameCount(taskKey);
    const defSec = defaultDurationSec(taskKey);
    let start = 0;
    const fixed = [];
    for (const seg of editor.timeline.segments) {
        let fc = 1;
        let durationSec;
        if (isVideo) {
            const sec = resolveSegmentDurationSec(seg, defFc);
            const clampedSec = clamp(sec || defSec, minDurationSec(), maxDurationSec());
            fc = durationToMiniMaxFrames(clampedSec, 24);
            durationSec = clampedSec;
        }
        fixed.push({
            ...seg,
            start,
            length: fc,
            frameCount: fc,
            ...(isVideo ? { durationSec } : {}),
            negativePrompt: seg.negativePrompt ?? "",
            genImage: seg.genImage || { imageFile: "" },
            refs: seg.refs || [],
            refAudios: seg.refAudios || [],
            refVideos: seg.refVideos || [],
            _videoFrameCount: seg._videoFrameCount,
            previewB64: seg.previewB64 || "",
            previewFrames: seg.previewFrames || [],
            previewFps: seg.previewFps || parseFloat(editor.frameRateWidget?.value || 24),
        });
        start += fc;
    }
    if (!fixed.length) fixed.push(newBatchSegment({ durationSec: defSec }));
    editor.timeline.segments = fixed;
    editor.timeline.totalFrames = start || fixed[0].frameCount;
}

export function addImageBatchGroup(editor) {
    const taskKey = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    editor.timeline.segments.push(newBatchSegment({
        durationSec: defaultDurationSec(taskKey),
        negativePrompt: "",
    }));
    normalizeImageBatchSegments(editor);
    editor.selectedIndex = Math.max(0, editor.timeline.segments.length - 1);
    editor.renderImageBatchGroups();
    editor.commit();
    editor.updateVideoNameLabel?.();
    editor.updateDomWidgetHeight?.();
}

export function deleteImageBatchGroup(editor, index) {
    if (editor.timeline.segments.length <= 1) return;
    editor.timeline.segments.splice(index, 1);
    normalizeImageBatchSegments(editor);
    editor.selectedIndex = clamp(
        editor.selectedIndex > index ? editor.selectedIndex - 1 : editor.selectedIndex,
        0,
        editor.timeline.segments.length - 1,
    );
    editor.renderImageBatchGroups();
    editor.commit();
    editor.updateVideoNameLabel?.();
    editor.updateDomWidgetHeight?.();
}

function pickFile(accept, onFile) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
        const file = input.files?.[0];
        if (file) onFile(file);
    };
    input.click();
}

async function uploadSegSource(editor, index) {
    pickFile("image/*", async (file) => {
        try {
            const uploaded = await uploadImage(file);
            const seg = editor.timeline.segments[index];
            if (!seg) return;
            const imageFile = relPath(uploaded);
            const dims = await readImageDimensions(file);
            seg.genImage = { imageFile, width: dims.width, height: dims.height };
            seg.imageFile = imageFile;
            editor.renderImageBatchGroups();
            editor.updateOutputPreview?.();
            editor.commit();
        } catch (err) {
            console.error("[MiniMax H3Director] batch source upload failed:", err);
        }
    });
}

function readImageDimensions(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to read image dimensions"));
        };
        img.src = url;
    });
}

async function assignSegRefFromFile(editor, index, slot, file) {
    if (!file?.type?.startsWith("image/")) return;
    try {
        const uploaded = await uploadImage(file);
        const seg = editor.timeline.segments[index];
        if (!seg) return;
        seg.refs = (seg.refs || []).filter((r) => Number(r.index ?? r.slot) !== slot);
        seg.refs.push({ index: slot, imageFile: relPath(uploaded), imageB64: "" });
        editor.renderImageBatchGroups();
        editor.commit();
    } catch (err) {
        console.error("[MiniMax H3Director] batch ref upload failed:", err);
    }
}

async function uploadSegRef(editor, index, slot) {
    pickFile("image/*", (file) => assignSegRefFromFile(editor, index, slot, file));
}

function moveBatchRefSlot(editor, segIndex, fromSlot, toSlot) {
    if (fromSlot === toSlot) return;
    const seg = editor.timeline.segments[segIndex];
    if (!seg) return;
    const refs = [...(seg.refs || [])];
    const fromRef = refs.find((r) => Number(r.index ?? r.slot) === fromSlot);
    if (!fromRef) return;
    const toRef = refs.find((r) => Number(r.index ?? r.slot) === toSlot);
    seg.refs = refs.filter((r) => {
        const idx = Number(r.index ?? r.slot);
        return idx !== fromSlot && idx !== toSlot;
    });
    seg.refs.push({ ...fromRef, index: toSlot, slot: undefined });
    if (toRef) {
        seg.refs.push({ ...toRef, index: fromSlot, slot: undefined });
    }
    editor.renderImageBatchGroups();
    editor.commit();
}

function bindBatchRefDrop(slot, editor, index, slotIndex) {
    const hasImg = slot.classList.contains("has-img");
    slot.draggable = hasImg;
    slot.addEventListener("dragstart", (e) => {
        if (!hasImg) {
            e.preventDefault();
            return;
        }
        editor._batchRefDragMoved = false;
        const payload = JSON.stringify({ segIndex: index, from: slotIndex });
        e.dataTransfer.setData("application/x-minimax-ref-slot", payload);
        e.dataTransfer.setData("text/plain", payload);
        e.dataTransfer.effectAllowed = "move";
    });
    slot.addEventListener("dragend", () => {
        setTimeout(() => { editor._batchRefDragMoved = false; }, 0);
    });
    slot.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const types = [...(e.dataTransfer?.types || [])];
        e.dataTransfer.dropEffect = types.includes("application/x-minimax-ref-slot")
            ? "move"
            : "copy";
    });
    slot.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const raw = e.dataTransfer.getData("application/x-minimax-ref-slot")
            || e.dataTransfer.getData("text/plain");
        if (raw) {
            try {
                const data = JSON.parse(raw);
                if (Number(data.segIndex) !== index) return;
                editor._batchRefDragMoved = true;
                moveBatchRefSlot(editor, index, Number(data.from), slotIndex);
                return;
            } catch (_) { /* fall through */ }
        }
        const f = e.dataTransfer.files?.[0];
        if (f) assignSegRefFromFile(editor, index, slotIndex, f);
    });
}

function removeSegRef(editor, index, slot) {
    const seg = editor.timeline.segments[index];
    if (!seg) return;
    seg.refs = (seg.refs || []).filter((r) => Number(r.index ?? r.slot) !== slot);
    editor.renderImageBatchGroups();
    editor.commit();
}

async function uploadSegAudio(editor, index, slot) {
    pickFile("audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac", async (file) => {
        try {
            const uploaded = await uploadMedia(file);
            const seg = editor.timeline.segments[index];
            if (!seg) return;
            seg.refAudios = (seg.refAudios || []).filter((r) => Number(r.index ?? r.slot) !== slot);
            seg.refAudios.push({
                index: slot,
                audioFile: relPath(uploaded),
                fileName: uploaded?.name || file.name,
                type: "input",
                subfolder: uploaded?.subfolder || "",
            });
            editor.renderImageBatchGroups();
            editor.commit();
        } catch (err) {
            console.error("[MiniMax H3Director] batch audio upload failed:", err);
            alert(`参考音频上传失败：${err?.message || err}`);
        }
    });
}

function removeSegAudio(editor, index, slot) {
    const seg = editor.timeline.segments[index];
    if (!seg) return;
    seg.refAudios = (seg.refAudios || []).filter((r) => Number(r.index ?? r.slot) !== slot);
    editor.renderImageBatchGroups();
    editor.commit();
}

async function uploadSegVideo(editor, index, slot) {
    pickFile("video/*,.mp4,.mov,.webm,.mkv", async (file) => {
        try {
            const uploaded = await uploadMedia(file);
            const seg = editor.timeline.segments[index];
            if (!seg) return;
            const videoFile = relPath(uploaded);
            seg.refVideos = (seg.refVideos || []).filter((r) => Number(r.index ?? r.slot) !== slot);
            seg.refVideos.push({
                index: slot,
                videoFile,
                fileName: uploaded?.name || file.name,
                type: "input",
                subfolder: uploaded?.subfolder || "",
            });
            editor.renderImageBatchGroups();
            editor.commit();
        } catch (err) {
            console.error("[MiniMax H3Director] batch video upload failed:", err);
            alert(`参考视频上传失败：${err?.message || err}`);
        }
    });
}

function removeSegVideo(editor, index, slot) {
    const seg = editor.timeline.segments[index];
    if (!seg) return;
    seg.refVideos = (seg.refVideos || []).filter((r) => Number(r.index ?? r.slot) !== slot);
    editor.renderImageBatchGroups();
    editor.commit();
}

function renderAudioSlot(el, ref, slot, index, editor) {
    const label = refAudioLabel(slot);
    const file = ref?.audioFile || ref?.fileName || "";
    el.className = `bd-batch-audio${file ? " has-audio" : ""}`;
    el.title = file ? `${label}: ${file}` : `${label} — 点击上传`;
    el.innerHTML = "";
    if (file) {
        const tag = document.createElement("span");
        tag.textContent = label;
        el.appendChild(tag);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = file.split("/").pop() || file;
        el.appendChild(name);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (e) => { e.stopPropagation(); removeSegAudio(editor, index, slot); };
        el.appendChild(x);
    } else {
        el.textContent = `${label}\n上传`;
    }
}

function renderVideoSlot(el, ref, slot, index, editor) {
    const label = refVideoLabel(slot);
    const file = ref?.videoFile || ref?.fileName || "";
    el.className = `bd-batch-video${file ? " has-video" : ""}`;
    el.title = file ? `${label}: ${file}` : `${label} — 点击上传参考视频`;
    el.innerHTML = "";
    if (file) {
        const tag = document.createElement("span");
        tag.textContent = label;
        el.appendChild(tag);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = file.split("/").pop() || file;
        el.appendChild(name);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (e) => { e.stopPropagation(); removeSegVideo(editor, index, slot); };
        el.appendChild(x);
    } else {
        el.textContent = `${label}\n上传`;
    }
}

/** Build r2v top row: left=images, right=videos then audios. */
function appendR2vMediaSections(card, seg, index, editor) {
    const imgs = document.createElement("div");
    imgs.className = "bd-batch-r2v-imgs";
    const imgBlock = document.createElement("div");
    imgBlock.className = "bd-batch-media-block";
    imgBlock.innerHTML = `<span class="bd-label">参考图 (图片1–9)</span>`;
    const refs = document.createElement("div");
    refs.className = "bd-batch-refs";
    for (let i = 0; i < MAX_REFERENCE_IMAGES; i++) {
        const ref = (seg.refs || []).find((r) => Number(r.index ?? r.slot) === i);
        const slot = document.createElement("div");
        slot.className = "bd-batch-ref";
        renderRefSlot(slot, ref, i, index, editor);
        slot.onclick = () => {
            if (editor._batchRefDragMoved) {
                editor._batchRefDragMoved = false;
                return;
            }
            uploadSegRef(editor, index, i);
        };
        bindBatchRefDrop(slot, editor, index, i);
        refs.appendChild(slot);
    }
    imgBlock.appendChild(refs);
    imgs.appendChild(imgBlock);
    card.appendChild(imgs);

    const av = document.createElement("div");
    av.className = "bd-batch-r2v-av";

    const videoBlock = document.createElement("div");
    videoBlock.className = "bd-batch-media-block";
    videoBlock.innerHTML = `<span class="bd-label">参考视频 (视频1–3)</span>`;
    const videos = document.createElement("div");
    videos.className = "bd-batch-videos";
    for (let i = 0; i < MAX_REFERENCE_VIDEOS; i++) {
        const ref = (seg.refVideos || []).find((r) => Number(r.index ?? r.slot) === i);
        const slot = document.createElement("div");
        renderVideoSlot(slot, ref, i, index, editor);
        slot.onclick = () => uploadSegVideo(editor, index, i);
        videos.appendChild(slot);
    }
    videoBlock.appendChild(videos);
    av.appendChild(videoBlock);

    const audioBlock = document.createElement("div");
    audioBlock.className = "bd-batch-media-block";
    audioBlock.innerHTML = `<span class="bd-label">参考音频 (音频1–3)</span>`;
    const audios = document.createElement("div");
    audios.className = "bd-batch-audios";
    for (let i = 0; i < MAX_REFERENCE_AUDIOS; i++) {
        const ref = (seg.refAudios || []).find((r) => Number(r.index ?? r.slot) === i);
        const slot = document.createElement("div");
        renderAudioSlot(slot, ref, i, index, editor);
        slot.onclick = () => uploadSegAudio(editor, index, i);
        audios.appendChild(slot);
    }
    audioBlock.appendChild(audios);
    av.appendChild(audioBlock);

    card.appendChild(av);
}

function renderSourceSlot(el, imageFile) {
    el.classList.toggle("has-img", !!imageFile);
    if (imageFile) {
        el.innerHTML = `<img src="${viewUrl(imageFile)}" alt="">`;
    } else {
        el.textContent = "上传源图";
    }
}

function renderRefSlot(el, ref, slot, index, editor) {
    const label = refImageLabel(slot);
    el.classList.toggle("has-img", !!ref?.imageFile);
    el.innerHTML = "";
    el.title = `${label} — 点击上传；拖到其他格可移动`;
    if (ref?.imageFile) {
        const img = document.createElement("img");
        img.src = viewUrl(ref.imageFile);
        img.draggable = false;
        el.appendChild(img);
        const x = document.createElement("span");
        x.className = "x";
        x.textContent = "×";
        x.onclick = (e) => { e.stopPropagation(); removeSegRef(editor, index, slot); };
        el.appendChild(x);
    } else {
        el.textContent = label;
    }
}

function frameSrc(b64) {
    if (!b64) return "";
    return b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
}

function loadFrameImages(frames) {
    return Promise.all(frames.map((b64) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = frameSrc(b64);
    })));
}

function drawFrame(canvas, img) {
    const ctx = canvas.getContext("2d");
    if (!ctx || !img) return;
    const cw = canvas.clientWidth || 160;
    const ch = canvas.clientHeight || 90;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

function mountVideoPreview(el, seg, running, fps) {
    stopPlayer(el);
    el.innerHTML = "";
    if (running) {
        el.textContent = "生成中…";
        return;
    }
    const frames = (seg.previewFrames?.length ? seg.previewFrames : null)
        || (seg.previewB64 ? [seg.previewB64] : null);
    if (!frames?.length) {
        el.textContent = "运行后在此预览视频";
        return;
    }
    const wrap = document.createElement("div");
    wrap.className = "bd-batch-vpreview";
    const canvas = document.createElement("canvas");
    canvas.height = 90;
    const ctrl = document.createElement("div");
    ctrl.className = "bd-batch-vpreview-ctrl";
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "bd-btn";
    playBtn.textContent = "▶ 播放";
    const meta = document.createElement("div");
    meta.className = "bd-batch-vpreview-meta";
    meta.textContent = `${frames.length}帧 · ${formatPreviewFps(fps)}fps(预览)`;
    ctrl.appendChild(playBtn);
    wrap.appendChild(canvas);
    wrap.appendChild(ctrl);
    wrap.appendChild(meta);
    el.appendChild(wrap);

    const state = { playing: false, timer: null, idx: 0, images: null };
    _players.set(wrap, state);

    loadFrameImages(frames).then((images) => {
        state.images = images;
        drawFrame(canvas, images[0]);
    }).catch(() => {
        meta.textContent = "预览加载失败";
    });

    playBtn.onclick = (e) => {
        e.stopPropagation();
        if (!state.images?.length) return;
        if (state.playing) {
            state.playing = false;
            if (state.timer) clearInterval(state.timer);
            state.timer = null;
            playBtn.textContent = "▶ 播放";
            return;
        }
        state.playing = true;
        playBtn.textContent = "⏸ 暂停";
        const interval = Math.max(20, 1000 / Math.max(1, fps));
        state.timer = setInterval(() => {
            if (!state.images?.length) return;
            state.idx = (state.idx + 1) % state.images.length;
            drawFrame(canvas, state.images[state.idx]);
        }, interval);
    };
}

function renderImagePreview(el, seg, running) {
    stopPlayer(el);
    el.innerHTML = "";
    if (running) {
        el.textContent = "生成中…";
        return;
    }
    if (seg.previewB64) {
        const img = document.createElement("img");
        img.src = frameSrc(seg.previewB64);
        img.alt = "preview";
        el.appendChild(img);
        return;
    }
    el.textContent = "运行后在此预览";
}

function renderPreview(el, seg, running, isVideo, fps) {
    if (isVideo) mountVideoPreview(el, seg, running, fps);
    else renderImagePreview(el, seg, running);
}

export function renderImageBatchGroups(editor) {
    const list = editor.batchList;
    if (!list) return;
    stopAllPlayers(list);
    const key = resolveTaskKey(editor.getTaskKey?.() || editor.taskTypeWidget?.value);
    const variant = imageBatchVariant(key);
    const isVideo = isVideoBatchTask(key);
    const runningIdx = editor._runHighlightSeg;
    const fps = parseFloat(editor.frameRateWidget?.value || editor.timeline?.frameRate || 24);

    if (editor.batchHint) {
        const hintKey = `batch.hint.${key}`;
        editor.batchHint.textContent = t(hintKey) !== hintKey
            ? t(hintKey)
            : t(isVideo ? "batch.hint.defaultVideo" : "batch.hint.defaultImage");
    }
    if (editor.batchI2vNotice) {
        const needsRefs = key === "r2i" || key === "r2v";
        const hasAnyMedia = (editor.timeline.segments || []).some((s) => (
            (s.refs || []).length > 0
            || (s.refAudios || []).length > 0
            || (s.refVideos || []).length > 0
        ));
        if (needsRefs && !hasAnyMedia) {
            editor.batchI2vNotice.textContent = t(key === "r2v" ? "batch.notice.r2vNoRefs" : "batch.notice.r2iNoRefs");
            editor.batchI2vNotice.classList.add("visible");
        } else {
            editor.batchI2vNotice.classList.remove("visible");
            editor.batchI2vNotice.textContent = "";
        }
    }
    const addBtn = editor.batchPanel?.querySelector('[data-a="batch-add"]');
    if (addBtn) {
        addBtn.textContent = t(key === "r2v" ? "batch.addRefGroup" : "batch.addPromptGroup");
        addBtn.setAttribute("data-i18n", key === "r2v" ? "batch.addRefGroup" : "batch.addPromptGroup");
        // r2v: add from toolbar (left of task select), like fl2v.
        addBtn.classList.toggle("hidden", key === "r2v");
    }

    list.innerHTML = "";
    editor.timeline.segments.forEach((seg, index) => {
        const isR2v = key === "r2v";
        const card = document.createElement("div");
        card.className = `bd-batch-card${isR2v ? " bd-batch-r2v" : ""}`;
        const runSelectOn = !!(editor.isRunSelectEnabled?.() && editor.supportsRunSelect?.());
        const runEnabled = !runSelectOn || !!editor.isSegmentRunEnabled?.(index);
        if (index === editor.selectedIndex) card.classList.add("selected");
        if (index === runningIdx) card.classList.add("running");
        if (runSelectOn && runEnabled) card.classList.add("run-on");
        if (runSelectOn && !runEnabled) card.classList.add("run-skipped");
        if (isR2v) {
            card.onclick = (e) => {
                if (e.target.closest?.("button, input, textarea, select, .bd-batch-ref, .bd-batch-audio, .bd-batch-video, .bd-batch-src, .x")) {
                    return;
                }
                if (editor.selectedIndex === index) return;
                editor.selectedIndex = index;
                list.querySelectorAll(".bd-batch-card").forEach((el, i) => {
                    el.classList.toggle("selected", i === index);
                });
                editor.scheduleRender?.();
                editor.updateVideoNameLabel?.();
            };
        }
        const hasPreview = isVideo
            ? (seg.previewFrames?.length > 0 || seg.previewB64)
            : !!seg.previewB64;
        if (hasPreview && index !== runningIdx) card.classList.add("done");

        const head = document.createElement("div");
        head.className = "bd-batch-head";
        // Timeline + cards stay in sync for run-select (incl. r2v).
        if (runSelectOn) {
            const runCb = document.createElement("input");
            runCb.type = "checkbox";
            runCb.className = "bd-batch-run-check";
            runCb.checked = runEnabled;
            runCb.title = t("tooltip.batchRunCheck");
            runCb.onclick = (e) => {
                e.stopPropagation();
                editor.toggleSegmentRun(index);
            };
            head.appendChild(runCb);
        }
        const title = document.createElement("b");
        title.textContent = t(isR2v ? "batch.groupTitle.asset" : "batch.groupTitle.prompt", { n: index + 1 });
        head.appendChild(title);
        const meta = document.createElement("div");
        meta.className = "bd-batch-head-meta";
        if (isVideo) {
            const secRow = document.createElement("label");
            secRow.className = "bd-batch-fc";
            const curSec = resolveSegmentDurationSec(seg, defaultFrameCount(key));
            const frames = durationToMiniMaxFrames(curSec, 24);
            seg.durationSec = curSec;
            seg.frameCount = frames;
            seg.length = frames;
            secRow.innerHTML = `${t("batch.seconds")} <input type="number" min="${minDurationSec()}" max="${maxDurationSec()}" step="0.1" value="${seg.durationSec}" title="${t("batch.durationTooltip", { frames })}">`;
            const secInput = secRow.querySelector("input");
            const applySec = () => {
                const sec = clamp(
                    parseFloat(secInput.value) || defaultDurationSec(key),
                    minDurationSec(),
                    maxDurationSec(),
                );
                const rounded = Math.round(sec * 100) / 100;
                const fc = durationToMiniMaxFrames(rounded, 24);
                // Keep the user's seconds as-is; do NOT rewrite to frames/fps.
                secInput.value = String(rounded);
                secInput.title = t("batch.durationTooltip", { frames: fc });
                seg.durationSec = rounded;
                seg.frameCount = fc;
                seg.length = fc;
                normalizeImageBatchSegments(editor);
                editor.scheduleTimelineSync();
                editor.scheduleRender?.();
                editor.updateVideoNameLabel?.();
                editor.updateOutputPreview?.();
            };
            secInput.onchange = applySec;
            secInput.oninput = () => {
                clearTimeout(secInput._t);
                secInput._t = setTimeout(applySec, 280);
            };
            meta.appendChild(secRow);
        }
        const del = document.createElement("button");
        del.type = "button";
        del.className = "bd-batch-del";
        del.textContent = "删除";
        del.disabled = editor.timeline.segments.length <= 1;
        del.onclick = (e) => { e.stopPropagation(); deleteImageBatchGroup(editor, index); };
        meta.appendChild(del);
        head.appendChild(meta);
        card.appendChild(head);

        if (variant === "source") {
            const media = document.createElement("div");
            media.className = "bd-batch-media";
            const src = document.createElement("div");
            src.className = "bd-batch-src";
            renderSourceSlot(src, seg.genImage?.imageFile);
            src.onclick = () => uploadSegSource(editor, index);
            media.appendChild(src);
            card.appendChild(media);
        } else if (variant === "refs" && isR2v) {
            appendR2vMediaSections(card, seg, index, editor);
        } else if (variant === "refs") {
            const media = document.createElement("div");
            media.className = "bd-batch-media";
            const refs = document.createElement("div");
            refs.className = "bd-batch-refs";
            for (let i = 0; i < MAX_REFERENCE_IMAGES; i++) {
                const ref = (seg.refs || []).find((r) => Number(r.index ?? r.slot) === i);
                const slot = document.createElement("div");
                slot.className = "bd-batch-ref";
                renderRefSlot(slot, ref, i, index, editor);
                slot.onclick = () => {
                    if (editor._batchRefDragMoved) {
                        editor._batchRefDragMoved = false;
                        return;
                    }
                    uploadSegRef(editor, index, i);
                };
                bindBatchRefDrop(slot, editor, index, i);
                refs.appendChild(slot);
            }
            media.appendChild(refs);
            card.appendChild(media);
        }

        const prompts = document.createElement("div");
        prompts.className = "bd-batch-prompts";
        const ph = isR2v
            ? "描述画面与运动；可用 <Picture N> / <Video K> / <Audio J>，或输入 @ 引用已上传素材"
            : "描述要生成的内容（含画面、运镜、音频；MiniMax H3 无反向提示词）";
        prompts.innerHTML = `
            <span class="bd-label">提示词</span>
            <textarea data-f="prompt" placeholder="${ph}">${seg.prompt || ""}</textarea>`;
        const promptEl = prompts.querySelector('[data-f="prompt"]');
        promptEl.oninput = (e) => {
            seg.prompt = e.target.value;
            seg.negativePrompt = "";
            editor.scheduleTimelineSync();
        };
        if (isR2v) {
            wirePromptImageMentions(editor, promptEl, () => ({
                refs: seg.refs || [],
                audios: seg.refAudios || [],
                videos: seg.refVideos || [],
            }));
        }

        const preview = document.createElement("div");
        preview.className = "bd-batch-preview";
        renderPreview(preview, seg, index === runningIdx, isVideo, seg.previewFps || fps);

        card.appendChild(prompts);
        card.appendChild(preview);

        list.appendChild(card);
    });
}

export function setImageBatchPreview(editor, segmentIndex, imageB64, extra = {}) {
    const seg = editor.timeline.segments[segmentIndex];
    if (!seg) return;
    seg.previewB64 = imageB64 || "";
    if (Array.isArray(extra.frames) && extra.frames.length) {
        seg.previewFrames = extra.frames;
        seg.previewFps = extra.fps || seg.previewFps || 24;
    } else if (imageB64) {
        seg.previewFrames = [imageB64];
    }
    editor.renderImageBatchGroups();
}

export function bindImageBatchEvents(editor) {
    editor.batchAddBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        addImageBatchGroup(editor);
    });
}

export function getImageBatchUiHeight(editor) {
    const n = Math.max(1, editor?.timeline?.segments?.length || 1);
    const key = resolveTaskKey(editor?.getTaskKey?.() || editor?.taskTypeWidget?.value);
    // r2v: 2-row ref grid + side-by-side bottom row.
    const rowH = key === "r2v" ? 240 : (isVideoBatchTask(key) ? 155 : 130);
    return 200 + Math.min(n, 4) * rowH + 60;
}

export function setToolbarDisabledForBatch(editor, disabled) {
    const btns = [
        editor.btnVideo,
        editor.btnVideoAppend,
        editor.root?.querySelector('[data-a="split"]'),
        editor.root?.querySelector('[data-a="smart-split"]'),
        editor.root?.querySelector('[data-a="equal"]'),
        editor.root?.querySelector('[data-a="del"]'),
        editor.root?.querySelector('[data-a="mode-global"]'),
        editor.root?.querySelector('[data-a="mode-segment"]'),
    ];
    for (const btn of btns) {
        if (!btn) continue;
        // Batch / t2v / i2v: fully hide video-editing controls (not just disable).
        btn.classList.toggle("hidden", disabled);
        btn.disabled = disabled;
        btn.classList.toggle("bd-disabled", disabled);
    }
    if (editor.equalCountInput) {
        editor.equalCountInput.classList.toggle("hidden", disabled);
        editor.equalCountInput.disabled = disabled;
        editor.equalCountInput.classList.toggle("bd-disabled", disabled);
    }
    editor.root?.querySelector('[data-r="equal-n"]')?.classList.toggle("hidden", disabled);
    editor.root?.querySelector(".bd-mode")?.classList.toggle("hidden", disabled);
}

/** r2v: fl2v-like toolbar — timeline visible; add group sits left of task select. */
export function setR2vToolbar(editor, enabled) {
    const hide = [
        editor.btnVideo,
        editor.btnVideoAppend,
        editor.root?.querySelector('[data-a="split"]'),
        editor.root?.querySelector('[data-a="smart-split"]'),
        editor.root?.querySelector('[data-a="equal"]'),
        editor.root?.querySelector('[data-a="mode-global"]'),
        editor.root?.querySelector('[data-a="mode-segment"]'),
    ];
    for (const btn of hide) {
        if (!btn) continue;
        btn.classList.toggle("hidden", enabled);
        btn.disabled = enabled;
        btn.classList.toggle("bd-disabled", enabled);
    }
    if (editor.equalCountInput) {
        editor.equalCountInput.classList.toggle("hidden", enabled);
        editor.equalCountInput.disabled = enabled;
        editor.equalCountInput.classList.toggle("bd-disabled", enabled);
    }
    editor.root?.querySelector('[data-r="equal-n"]')?.classList.toggle("hidden", enabled);
    editor.root?.querySelector(".bd-mode")?.classList.toggle("hidden", enabled);

    const del = editor.root?.querySelector('[data-a="del"]');
    if (del) {
        del.disabled = false;
        del.classList.remove("bd-disabled", "hidden");
        del.textContent = enabled ? t("toolbar.deleteSelectedGroup") : t("toolbar.deleteSegment");
        del.setAttribute("data-i18n", enabled ? "toolbar.deleteSelectedGroup" : "toolbar.deleteSegment");
        del.setAttribute("data-i18n-title", enabled ? "tooltip.deleteSelectedFl2vGroup" : "tooltip.deleteSegment");
        del.title = enabled
            ? t("tooltip.deleteSelectedFl2vGroup")
            : t("tooltip.deleteSegment");
    }
    const addBtn = editor.root?.querySelector('[data-a="r2v-add-group"]');
    if (addBtn) {
        addBtn.classList.toggle("hidden", !enabled);
        addBtn.disabled = !enabled;
    }
    const batchAdd = editor.batchPanel?.querySelector('[data-a="batch-add"]');
    if (batchAdd) batchAdd.classList.toggle("hidden", enabled);
    updateR2vToolbarBtns(editor);
}

export function updateR2vToolbarBtns(editor) {
    const addBtn = editor?.root?.querySelector?.('[data-a="r2v-add-group"]');
    if (!addBtn) return;
    const show = !!editor?.isR2vBatch?.();
    addBtn.classList.toggle("hidden", !show);
    addBtn.disabled = !show;
}
