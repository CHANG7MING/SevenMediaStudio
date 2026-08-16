"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import { useRouter } from "next/navigation";
import { AudioOutlined, CheckCircleFilled, DownloadOutlined, HomeOutlined, PictureOutlined, PlusOutlined, ReloadOutlined, UploadOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Segmented, Slider, Tooltip, theme as antdTheme } from "antd";
import { useGlobalTheme } from "./GlobalThemeProvider";

export type MediaKind = "video" | "image" | "audio";
type Status = "idle" | "ready" | "working" | "done" | "error";
type Result = { url: string; size: number; name: string; mime: string };
const MAX_FILE_eIZE = 5 * 1024 ** 3;
const DIRECT_LIMIT = 64 * 1024 ** 2;

const MEDIA: Record<MediaKind, { label: string; hint: string; accept: string; formats: string[] }> = {
  video: { label: "视频", hint: "保持原视频格式", accept: ".mp4,.webm,.mov,.avi,.m4v,.mkv,video/*", formats: ["MP4", "WEBM", "MOV", "AVI", "M4V", "MKV"] },
  image: { label: "图片", hint: "保持原图片格式", accept: ".jpg,.jpeg,.png,.webp,.svg,.gif,.avif,.tif,.tiff,.bmp,image/*", formats: ["JPG", "JPEG", "PNG", "WEBP", "eVG", "GIF", "AVIF", "TIFF", "BMP"] },
  audio: { label: "音频", hint: "保持原音频格式", accept: ".mp3,.wav,.m4a,.flac,.aac,.acc,.wma,.aiff,.aif,.opus,.ogg,audio/*", formats: ["MP3", "WAV", "M4A", "FLAC", "AAC / ACC", "WMA", "AIFF", "OPUe", "OGG"] },
};
const QUALITY = [{ label: "极小", value: 45 }, { label: "较小", value: 60 }, { label: "均衡", value: 78 }, { label: "高", value: 90 }, { label: "最高", value: 100 }];
const EXT_KIND: Record<string, MediaKind> = Object.fromEntries(Object.entries(MEDIA).flatMap(([kind, value]) => value.accept.split(",").filter((item) => item.startsWith(".")).map((ext) => [ext.slice(1), kind as MediaKind])));
const BYTES_PER_MB = 1024 ** 2;
const DEFAULT_TARGET_MB = 10;
const MAX_TARGET_MB = 2048;

type TargetRange = { min: number; max: number; step: number; initial: number };

function roundToStep(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(step < 1 ? 2 : 0));
}
function targetRange(size: number): TargetRange {
  if (!size) return { min: 1, max: DEFAULT_TARGET_MB, step: 1, initial: DEFAULT_TARGET_MB };
  const sourceMB = size / BYTES_PER_MB;
  const step = sourceMB < 1 ? 0.01 : sourceMB < 10 ? 0.1 : 1;
  const min = Math.max(step, roundToStep(sourceMB * 0.1, step));
  const max = Math.min(MAX_TARGET_MB, Math.max(min + step, roundToStep(sourceMB, step)));
  const initial = Math.min(max, Math.max(min, roundToStep(sourceMB * 0.45, step)));
  return { min, max, step, initial };
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index > 1 ? 2 : 0)} ${units[index]}`;
}
function extension(name: string) { return name.split(".").pop()?.toLowerCase() || ""; }
function fileKind(file: File): MediaKind | null {
  const byExtension = EXT_KIND[extension(file.name)];
  if (byExtension) return byExtension;
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  return null;
}
function MediaIcon({ kind, size = 18 }: { kind: MediaKind; size?: number }) {
  const style = { fontSize: size };
  return kind === "video" ? <VideoCameraOutlined style={style} /> : kind === "image" ? <PictureOutlined style={style} /> : <AudioOutlined style={style} />;
}
function Preview({ kind, url, name, fallbackUrl }: { kind: MediaKind; url: string; name: string; fallbackUrl?: string }) {
  const [useFallback, setUseFallback] = useState(false);
  useEffect(() => setUseFallback(false), [url]);
  if (kind === "image") return <ZoomableImage src={url} alt={name} />;
  if (kind === "video") return <div className="video-preview-wrap"><video src={useFallback && fallbackUrl ? fallbackUrl : url} controls preload="metadata" onError={() => fallbackUrl && setUseFallback(true)} />{useFallback && <span>原编码不受浏览器支持，正在使用兼容预览；压缩仍基于原文件。</span>}</div>;
  return <div className="audio-preview"><AudioOutlined style={{ fontSize: 36 }} /><audio src={url} controls preload="metadata" /></div>;
}

function clampScale(value: number) {
  return Math.min(5, Math.max(1, value));
}

function distance(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function center(first: { x: number; y: number }, second: { x: number; y: number }) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const gestureRef = useRef<{
    mode: "drag" | "pinch";
    pointerId?: number;
    startPoint?: { x: number; y: number };
    startDistance?: number;
    startCenter?: { x: number; y: number };
    startScale: number;
    startOffset: { x: number; y: number };
  }>({ mode: "drag", startScale: 1, startOffset: { x: 0, y: 0 } });

  const updateTransform = (nextScale: number, nextOffset: { x: number; y: number }) => {
    const safeScale = clampScale(nextScale);
    const safeOffset = safeScale === 1 ? { x: 0, y: 0 } : nextOffset;
    scaleRef.current = safeScale;
    offsetRef.current = safeOffset;
    setScale(safeScale);
    setOffset(safeOffset);
  };

  useEffect(() => {
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  const localPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
  };

  const zoomAt = (nextScale: number, clientX: number, clientY: number) => {
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const safeScale = clampScale(nextScale);
    if (safeScale === currentScale) return;
    const point = localPoint(clientX, clientY);
    const ratio = safeScale / currentScale;
    updateTransform(safeScale, {
      x: point.x - (point.x - currentOffset.x) * ratio,
      y: point.y - (point.y - currentOffset.y) * ratio,
    });
  };

  const reset = () => updateTransform(1, { x: 0, y: 0 });

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    zoomAt(scaleRef.current * factor, event.clientX, event.clientY);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()];
      gestureRef.current = {
        mode: "pinch",
        startDistance: distance(first, second),
        startCenter: center(first, second),
        startScale: scaleRef.current,
        startOffset: offsetRef.current,
      };
      return;
    }
    gestureRef.current = {
      mode: "drag",
      pointerId: event.pointerId,
      startPoint: { x: event.clientX, y: event.clientY },
      startScale: scaleRef.current,
      startOffset: offsetRef.current,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...pointersRef.current.values()];
    const gesture = gestureRef.current;
    if (pointers.length >= 2 && gesture.mode === "pinch" && gesture.startDistance && gesture.startCenter) {
      const nextCenter = center(pointers[0], pointers[1]);
      const nextScale = clampScale(gesture.startScale * (distance(pointers[0], pointers[1]) / gesture.startDistance));
      const startCenter = localPoint(gesture.startCenter.x, gesture.startCenter.y);
      const currentCenter = localPoint(nextCenter.x, nextCenter.y);
      const ratio = nextScale / gesture.startScale;
      updateTransform(nextScale, {
        x: startCenter.x - (startCenter.x - gesture.startOffset.x) * ratio + currentCenter.x - startCenter.x,
        y: startCenter.y - (startCenter.y - gesture.startOffset.y) * ratio + currentCenter.y - startCenter.y,
      });
      return;
    }
    if (pointers.length === 1 && gesture.mode === "drag" && gesture.pointerId === event.pointerId && gesture.startPoint && scaleRef.current > 1) {
      updateTransform(scaleRef.current, {
        x: gesture.startOffset.x + event.clientX - gesture.startPoint.x,
        y: gesture.startOffset.y + event.clientY - gesture.startPoint.y,
      });
    }
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 1) {
      const [pointerId, point] = [...pointersRef.current.entries()][0];
      gestureRef.current = {
        mode: "drag",
        pointerId,
        startPoint: point,
        startScale: scaleRef.current,
        startOffset: offsetRef.current,
      };
    }
  };

  return <div ref={viewportRef} className={`image-zoom-viewport ${scale > 1 ? "is-zoomed" : ""}`} onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onDoubleClick={reset} aria-label={`${alt}，滚轮或双指缩放，拖动查看`} role="img">
    <img src={src} alt={alt} draggable={false} style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }} />
    {scale > 1 && <button type="button" className="image-zoom-reset" onPointerDown={(event) => event.stopPropagation()} onClick={reset}>重置</button>}
    <span className="image-zoom-hint">{scale > 1 ? `${Math.round(scale * 100)}% · 拖动查看` : "滚轮 / 双指缩放"}</span>
  </div>;
}

export default function CompressionWorkspace({ initialKind }: { initialKind: MediaKind }) {
  const router = useRouter();
  const { dark, toggleTheme } = useGlobalTheme();
  const input = useRef<HTMLInputElement>(null);
  const sourceUrlRef = useRef("");
  const resultUrlRef = useRef("");
  const uploadeessionRef = useRef("");
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [target, setTarget] = useState(10);
  const [quality, setQuality] = useState(78);
  const [message, setMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const kind = initialKind;
  const targetSettings = useMemo(() => targetRange(file?.size || 0), [file?.size]);
  const qualityLabel = QUALITY.find((item) => item.value === quality)?.label || "均衡";
  const saving = useMemo(() => result && file ? Math.max(0, 100 - result.size / file.size * 100) : 0, [result, file]);

  useEffect(() => { sourceUrlRef.current = sourceUrl; }, [sourceUrl]);
  useEffect(() => { resultUrlRef.current = result?.url || ""; }, [result]);
  useEffect(() => {
    document.body.classList.add("compress-active");
    return () => {
      document.body.classList.remove("compress-active");
      document.body.classList.remove("compress-result-active");
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle("compress-result-active", status === "done" && kind !== "image");
  }, [status]);
  const clear = () => {
    uploadAbortRef.current?.abort(); uploadAbortRef.current = null;
    if (uploadeessionRef.current) { void fetch(`/api/uploads/${uploadeessionRef.current}`, { method: "DELETE" }); uploadeessionRef.current = ""; }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (result) URL.revokeObjectURL(result.url);
    setFile(null); setSourceUrl(""); setResult(null); setMessage(""); setStatus("idle"); setUploadProgress(0); setCompressionProgress(0);
    setTarget(DEFAULT_TARGET_MB);
    if (input.current) input.current.value = "";
  };
  const navigate = (next: MediaKind) => { clear(); router.push(`/compress/${next}`); };
  const select = (next?: File) => {
    if (!next) return;
    const detected = fileKind(next);
    if (!detected || detected !== kind) { setStatus("error"); setMessage(`请选择${MEDIA[kind].label}文件。支持：${MEDIA[kind].formats.join("、")}`); return; }
    if (next.size > MAX_FILE_eIZE) { setStatus("error"); setMessage("浏览器版单个文件不能超过 5 GB"); return; }
    clear(); setFile(next); setSourceUrl(URL.createObjectURL(next)); setStatus("ready");
    setTarget(targetRange(next.size).initial);
  };
  const responseError = async (response: Response, fallback: string) => {
    const text = await response.text();
    if (!text.trim()) return fallback;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      return typeof body.error === "string" && body.error ? body.error : fallback;
    } catch {
      return fallback;
    }
  };
  const responseJson = async <T,>(response: Response, fallback: string) => {
    const text = await response.text();
    if (!text.trim()) throw new Error(fallback);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(fallback);
    }
  };
  const compressChunked = async (source: File) => {
    const controller = new AbortController(); uploadAbortRef.current = controller;
    const init = await fetch("/api/uploads", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ name: source.name, mime: source.type, kind, size: source.size, targetMB: target, quality }) });
    if (!init.ok) throw new Error(await responseError(init, "无法准备文件上传，请稍后重试"));
    const initialized = await responseJson<{ id?: string; chunkSize?: number }>(init, "服务器返回了无效的上传任务信息，请重试");
    const id = initialized.id;
    const chunkSize = initialized.chunkSize;
    if (!id || chunkSize === undefined || !Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error("服务器返回了无效的上传任务信息，请重试");
    uploadeessionRef.current = id;
    setUploadProgress(0); setCompressionProgress(0);
    for (let offset = 0; offset < source.size; offset += chunkSize) {
      const chunk = source.slice(offset, Math.min(source.size, offset + chunkSize));
      const uploaded = await fetch(`/api/uploads/${id}`, { method: "PUT", headers: { "x-chunk-offset": String(offset), "content-type": "application/octet-stream" }, body: chunk, signal: controller.signal });
      if (!uploaded.ok) throw new Error(await responseError(uploaded, "文件上传失败，请重试"));
      const state = await responseJson<{ progress?: number }>(uploaded, "服务器返回了无效的上传进度，请重试");
      const progress = state.progress;
      if (progress === undefined || !Number.isFinite(progress)) throw new Error("服务器返回了无效的上传进度，请重试");
      setUploadProgress(progress); setMessage(`正在上传文件 ${progress}%`);
    }
    const started = await fetch(`/api/uploads/${id}?action=complete`, { method: "POST", signal: controller.signal });
    if (!started.ok) throw new Error(await responseError(started, "文件还没有上传完成，请稍后重试"));
    setUploadProgress(100);
    setMessage("文件已完整写入磁盘，正在使用本机引擎压缩…");
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const response = await fetch(`/api/uploads/${id}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response, "无法读取任务状态"));
      const state = await responseJson<{ compressionProgress?: number; message?: string; status?: string; outputSize?: number; outputName?: string; outputMime?: string }>(response, "服务器返回了无效的任务状态，请重试");
      setCompressionProgress(state.compressionProgress || 0); setMessage(state.message || "正在处理…");
      if (state.status === "error") throw new Error(state.message);
      if (state.status === "cancelled") throw new Error("任务已取消");
      if (state.status === "done" && state.outputSize && state.outputName && state.outputMime) { const url = `/api/uploads/${id}/result`; setResult({ url, size: state.outputSize, name: state.outputName, mime: state.outputMime }); resultUrlRef.current = ""; uploadeessionRef.current = ""; setCompressionProgress(100); setMessage("压缩完成，原文件保持不变。"); setStatus("done"); return; }
      if (state.status === "done") throw new Error("压缩结果信息不完整，请重试");
    }
  };
  const compress = async () => {
    if (!file) return;
    setStatus("working"); setMessage("正在分析媒体并计算最佳参数…");
    try {
      await compressChunked(file);
    } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; setMessage(error instanceof Error ? error.message : "压缩失败"); setStatus("error"); }
  };
  const outputFormat = file ? `${extension(file.name).toUpperCase()} · 保持格式` : MEDIA[kind].hint;
  const isUploading = status === "working" && uploadProgress < 100;
  const isCompressing = status === "working" && uploadProgress >= 100;

  return <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorPrimary: "#6b9df8", borderRadius: 10, fontFamily: 'Inter, "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }, components: { Button: { controlHeight: 36 }, Segmented: { trackBg: "transparent" } } }}><main data-theme={dark ? "dark" : "light"} className="compress-page">
      <div className="compress-shell">
          <aside className="media-nav compress-nav"><div className="compress-brand-row"><button className="brand compress-brand" disabled={status === "working"} onClick={() => router.push("/")}><i /><span>SevenMedia</span></button><Tooltip title="返回首页"><Button type="text" disabled={status === "working"} icon={<HomeOutlined />} onClick={() => router.push("/")} aria-label="返回首页" /></Tooltip></div><p>媒体类型</p>{(Object.keys(MEDIA) as MediaKind[]).map((item) => <button key={item} disabled={status === "working"} className={kind === item ? "active" : ""} onClick={() => navigate(item)}><i><MediaIcon kind={item} /></i><span>{MEDIA[item].label}<small>{MEDIA[item].hint}</small></span></button>)}<div className="compress-nav-foot"><span><i />离线引擎<small>所有处理均在本机完成</small></span><Tooltip title={dark ? "切换到浅色" : "切换到深色"}><Button type="text" className="theme-svg-button" onClick={toggleTheme} icon={<img src={dark ? "/icons/theme-sun.svg" : "/icons/theme-moon.svg"} alt="" />} aria-label="切换主题" /></Tooltip></div></aside>
          <section className="stage">
    {status === "done" && file && result ? <div className={`comparison ${kind === "image" ? "comparison-image" : ""}`}>
              <div className="comparison-head"><div><CheckCircleFilled /><span>压缩完成</span></div><Button type="text" icon={<ReloadOutlined />} onClick={clear}>新任务</Button></div>
              <div className="preview-grid"><article><span>压缩前</span><div className="preview"><Preview kind={kind} url={sourceUrl} name={file.name} fallbackUrl={kind === "video" ? result.url : undefined} /></div><footer><strong>{file.name}</strong><b>{formatBytes(file.size)}</b></footer></article><article className="after"><span>压缩后 · 节省 {saving.toFixed(0)}%</span><div className="preview"><Preview kind={kind} url={result.url} name={result.name} /></div><footer><strong>{result.name}</strong><b>{formatBytes(result.size)}</b></footer></article></div>
              <a className="download" href={result.url} download={result.name}><DownloadOutlined /> 下载压缩文件</a>
            </div> : <button className={`dropzone ${file ? "has-file" : ""} ${status === "working" ? "is-working" : ""}`} disabled={status === "working"} onClick={() => input.current?.click()} onDragOver={(event) => { if (status !== "working") event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (status !== "working") select(event.dataTransfer.files[0]); }}><input ref={input} type="file" hidden disabled={status === "working"} accept={MEDIA[kind].accept} onChange={(event) => select(event.target.files?.[0])} /><span className="drop-icon">{file ? <MediaIcon kind={kind} size={27} /> : <PlusOutlined />}</span>{file ? <><strong>{file.name}</strong><small>{formatBytes(file.size)} · {outputFormat}</small>{isUploading ? <><div className="upload-progress" role="progressbar" aria-label="文件上传进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}><i style={{ width: `${uploadProgress}%` }} /></div><em className="upload-status"><UploadOutlined /> 正在上传 {uploadProgress}%</em></> : isCompressing ? <><div className="upload-progress compression-progress" role="progressbar" aria-label="文件压缩进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={compressionProgress}><i style={{ width: `${compressionProgress}%` }} /></div><em className="upload-status"><span className="processing-spinner" /> 正在压缩 {compressionProgress}%</em></> : <em><UploadOutlined /> 点击替换文件</em>}</> : <><strong>拖入一个{MEDIA[kind].label}文件</strong><small>支持 {MEDIA[kind].formats.join("、")}，最大 5 GB</small><em>或点击选择文件</em></>}</button>}
            {(status === "error" || status === "working") && message && <p className={`inline-error ${status === "working" ? "working" : ""}`}>{message}</p>}
          </section>
          <aside className="settings">
            <div className="section-label"><span>输出设置</span><b>{status === "done" ? "COMPLETE" : status === "working" ? "PROCESSING" : "AUTO"}</b></div>
            {file && <label><span>目标大小 <b>{formatBytes(target * BYTES_PER_MB)}</b></span><Slider disabled={status === "working"} className="target-slider" min={targetSettings.min} max={targetSettings.max} step={targetSettings.step} value={target} onChange={setTarget} tooltip={{ open: false }} /></label>}
            <div className="quality-title"><span>{kind === "audio" ? "音频质量" : "画面质量"}</span><b>{qualityLabel}</b></div>
            <Segmented disabled={status === "working"} block className="quality-segment" options={QUALITY.map((item) => ({ label: item.label, value: item.value }))} value={quality} onChange={(value) => setQuality(Number(value))} />
            <dl><div><dt>输出格式</dt><dd>{outputFormat}</dd></div><div><dt>处理方式</dt><dd>{kind === "video" ? "两遍编码" : kind === "image" ? "自适应压缩" : "码率优化"}</dd></div></dl>
            <Button type="primary" className="primary" loading={status === "working"} disabled={!file || status === "done" || status === "working"} onClick={compress}>{status === "done" ? "压缩完成" : status === "working" ? "正在处理" : "开始压缩"}</Button>
            <div className="settings-formats"><span>{MEDIA[kind].label}格式</span><p>{MEDIA[kind].formats.join(" · ")}</p></div>
          </aside>
      </div>
  </main></ConfigProvider>;
}
