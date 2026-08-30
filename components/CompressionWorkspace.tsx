"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import { useRouter } from "next/navigation";
import { AudioOutlined, CheckCircleFilled, DownloadOutlined, PictureOutlined, PlusOutlined, ReloadOutlined, UploadOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Modal, Segmented, Slider, Tooltip, theme as antdTheme } from "antd";
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
function timestampedName(name: string) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const suffix = dot > 0 ? name.slice(dot) : "";
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  return `${stem}-${timestamp}${suffix}`;
}
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
function Preview({ kind, url, name, fallbackUrl, onError }: { kind: MediaKind; url: string; name: string; fallbackUrl?: string; onError?: () => void }) {
  const [useFallback, setUseFallback] = useState(false);
  useEffect(() => setUseFallback(false), [url]);
  if (kind === "image") return <ZoomableImage src={url} alt={name} onError={onError} />;
  if (kind === "video") return <div className="video-preview-wrap"><video src={useFallback && fallbackUrl ? fallbackUrl : url} controls preload="metadata" onError={() => { if (fallbackUrl && !useFallback) setUseFallback(true); else onError?.(); }} />{useFallback && <span>原编码不受浏览器支持，正在使用兼容预览；压缩仍基于原文件。</span>}</div>;
  return <div className="audio-preview"><AudioOutlined style={{ fontSize: 36 }} /><audio src={url} controls preload="metadata" onError={onError} /></div>;
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

function ZoomableImage({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) {
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
    <img src={src} alt={alt} draggable={false} onError={onError} style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }} />
    {scale > 1 && <button type="button" className="image-zoom-reset" onPointerDown={(event) => event.stopPropagation()} onClick={reset}>重置</button>}
    <span className="image-zoom-hint">{scale > 1 ? `${Math.round(scale * 100)}% · 拖动查看` : "滚轮 / 双指缩放"}</span>
  </div>;
}

type BatchTask = { id: string; file: File; sourceUrl: string; status: "ready" | "working" | "done" | "error"; uploadProgress: number; compressionProgress: number; result?: Result; resultAvailable?: boolean; error?: string };
type MessageTone = "error" | "working" | "success";

export default function CompressionWorkspace({ initialKind }: { initialKind: MediaKind }) {
  const router = useRouter();
  const { dark, toggleTheme } = useGlobalTheme();
  const input = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<Set<AbortController>>(new Set());
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [target, setTarget] = useState(DEFAULT_TARGET_MB);
  const [quality, setQuality] = useState(78);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("error");
  const [batchBusy, setBatchBusy] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadPath, setDownloadPath] = useState("");
  const kind = initialKind;
  const selectedTasks = tasks.filter((task) => task.status === "done" && task.result && task.resultAvailable !== false);
  const unavailableTasks = tasks.filter((task) => task.status === "done" && task.result && task.resultAvailable === false);
  const readyTasks = tasks.filter((task) => task.status === "ready" || task.status === "error");
  const targetSettings = useMemo(() => targetRange(tasks[0]?.file.size || 0), [tasks]);
  const qualityLabel = QUALITY.find((item) => item.value === quality)?.label || "均衡";
  const previewTask = tasks.find((task) => task.id === previewId);

  useEffect(() => {
    document.body.classList.add("compress-active");
    return () => {
      document.body.classList.remove("compress-active");
      document.body.classList.remove("compress-result-active");
      tasks.forEach((task) => URL.revokeObjectURL(task.sourceUrl));
    };
  }, []);

  const updateTask = (id: string, patch: Partial<BatchTask>) => setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
  const clear = () => {
    uploadAbortRef.current.forEach((controller) => controller.abort());
    tasks.forEach((task) => URL.revokeObjectURL(task.sourceUrl));
    setTasks([]); setMessage(""); setMessageTone("error"); setDownloadProgress(null); setDownloadPath("");
    setTarget(DEFAULT_TARGET_MB);
    if (input.current) input.current.value = "";
  };
  const navigate = (next: MediaKind) => { clear(); router.push(`/compress/${next}`); };
  const selectMany = (list?: FileList | File[]) => {
    if (!list || batchBusy) return;
    const accepted: BatchTask[] = [];
    let skipped = 0;
    Array.from(list).forEach((file) => {
      if (file.size > MAX_FILE_eIZE || fileKind(file) !== kind) { skipped += 1; return; }
      accepted.push({ id: crypto.randomUUID(), file, sourceUrl: URL.createObjectURL(file), status: "ready", uploadProgress: 0, compressionProgress: 0 });
    });
    if (accepted.length) {
      setTasks((current) => [...current, ...accepted]);
      if (!tasks.length) setTarget(targetRange(accepted[0].file.size).initial);
    }
    setMessageTone("error");
    setMessage(skipped ? `${skipped} 个文件类型不匹配或超过 5 GB，已跳过。当前工作台只接受${MEDIA[kind].label}。` : "");
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
  const compressTask = async (task: BatchTask) => {
    const controller = new AbortController();
    uploadAbortRef.current.add(controller);
    try {
      updateTask(task.id, { status: "working", uploadProgress: 0, compressionProgress: 0, resultAvailable: undefined, error: undefined });
      const init = await fetch("/api/uploads", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ name: task.file.name, mime: task.file.type, kind, size: task.file.size, targetMB: target, quality }) });
      if (!init.ok) throw new Error(await responseError(init, "无法准备文件上传，请稍后重试"));
      const initialized = await responseJson<{ id?: string; chunkSize?: number }>(init, "服务器返回了无效的上传任务信息，请重试");
      const id = initialized.id;
      const chunkSize = initialized.chunkSize;
      if (!id || chunkSize === undefined || !Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error("服务器返回了无效的上传任务信息，请重试");
      for (let offset = 0; offset < task.file.size; offset += chunkSize) {
        const chunk = task.file.slice(offset, Math.min(task.file.size, offset + chunkSize));
        const uploaded = await fetch(`/api/uploads/${id}`, { method: "PUT", headers: { "x-chunk-offset": String(offset), "content-type": "application/octet-stream" }, body: chunk, signal: controller.signal });
        if (!uploaded.ok) throw new Error(await responseError(uploaded, "文件上传失败，请重试"));
        const state = await responseJson<{ progress?: number }>(uploaded, "服务器返回了无效的上传进度，请重试");
        const progress = state.progress;
        if (progress === undefined || !Number.isFinite(progress)) throw new Error("服务器返回了无效的上传进度，请重试");
        updateTask(task.id, { uploadProgress: progress }); setMessageTone("working"); setMessage(`正在上传 ${task.file.name} ${progress}%`);
      }
      const started = await fetch(`/api/uploads/${id}?action=complete`, { method: "POST", signal: controller.signal });
      if (!started.ok) throw new Error(await responseError(started, "文件还没有上传完成，请稍后重试"));
      updateTask(task.id, { uploadProgress: 100 }); setMessageTone("working"); setMessage(`正在压缩 ${task.file.name}…`);
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const response = await fetch(`/api/uploads/${id}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(await responseError(response, "无法读取任务状态"));
        const state = await responseJson<{ compressionProgress?: number; message?: string; status?: string; outputSize?: number; outputName?: string; outputMime?: string }>(response, "服务器返回了无效的任务状态，请重试");
        updateTask(task.id, { compressionProgress: state.compressionProgress || 0 }); setMessageTone("working"); setMessage(state.message || "正在处理…");
        if (state.status === "error") throw new Error(state.message);
        if (state.status === "cancelled") throw new Error("任务已取消");
        if (state.status === "done" && state.outputSize && state.outputName && state.outputMime) { const url = `/api/uploads/${id}/result`; updateTask(task.id, { status: "done", compressionProgress: 100, resultAvailable: true, result: { url, size: state.outputSize, name: state.outputName, mime: state.outputMime } }); return; }
        if (state.status === "done") throw new Error("压缩结果信息不完整，请重试");
      }
    } finally {
      uploadAbortRef.current.delete(controller);
    }
  };
  const compress = async () => {
    if (!readyTasks.length || batchBusy) return;
    setBatchBusy(true);
    setMessageTone("working");
    let failed = false;
    let nextIndex = 0;
    const concurrency = kind === "image" ? 4 : 1;
    const worker = async () => {
      for (;;) {
        const task = readyTasks[nextIndex++];
        if (!task) return;
        try { await compressTask(task); }
        catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          failed = true;
          updateTask(task.id, { status: "error", error: error instanceof Error ? error.message : "压缩失败" });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, readyTasks.length) }, () => worker()));
    setBatchBusy(false);
    setMessageTone(failed ? "error" : "success");
    setMessage(failed ? "部分任务处理失败，请重试失败项目。" : "批量任务处理完成。");
  };
  const download = async () => {
    if (!selectedTasks.length || downloadProgress !== null) return;
    const ids = selectedTasks.map((task) => task.result!.url.split("/")[3]).filter(Boolean);
    const url = ids.length === 1 ? `${selectedTasks[0].result!.url}?download=1` : `/api/uploads/batch-result?${ids.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`;
    const fileName = timestampedName(ids.length === 1 ? selectedTasks[0].result!.name : "seven-media-compressed.zip");
    const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!isDesktop) { const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); return; }
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { open } = await import("@tauri-apps/plugin-fs");
      const selectedPath = await save({ defaultPath: fileName, title: "保存压缩文件" });
      if (!selectedPath) return;
      const response = await fetch(url);
      if (!response.ok) throw new Error(await responseError(response, ids.length > 1 ? "无法创建批量压缩包" : "无法读取压缩结果"));
      const total = Number(response.headers.get("content-length")) || selectedTasks.reduce((sum, task) => sum + (task.result?.size || 0), 0);
      const handle = await open(selectedPath, { write: true, create: true, truncate: true });
      let written = 0; setDownloadProgress(0);
      try {
        if (response.body) {
          const reader = response.body.getReader();
          for (;;) { const { done, value } = await reader.read(); if (done) break; await handle.write(value); written += value.byteLength; setDownloadProgress(Math.min(100, Math.round(written / total * 100))); }
        } else {
          const value = new Uint8Array(await response.arrayBuffer());
          await handle.write(value);
          setDownloadProgress(100);
        }
      } finally { await handle.close(); }
      setDownloadProgress(null); setDownloadPath(selectedPath); setMessageTone("success"); setMessage(`下载完成，已保存到：${selectedPath}`);
    } catch (error) {
      setDownloadProgress(null);
      const errorMessage = error instanceof Error ? error.message : "下载失败，请重试";
      if (ids.length === 1 && (errorMessage.includes("无法读取压缩结果") || errorMessage.includes("下载失败"))) {
        setTasks((current) => current.map((task) => task.id === selectedTasks[0]?.id ? { ...task, resultAvailable: false } : task));
        setMessage("无法读取压缩结果，无法下载，请重新压缩。");
      } else {
        setMessage(ids.length > 1 ? `批量压缩包导出失败：${errorMessage}` : errorMessage);
      }
      setMessageTone("error");
    }
  };
  const outputFormat = tasks[0] ? `${extension(tasks[0].file.name).toUpperCase()} · 保持格式` : MEDIA[kind].hint;

  return <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorPrimary: "#6b9df8", borderRadius: 10, fontFamily: 'Inter, "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }, components: { Button: { controlHeight: 36 }, Segmented: { trackBg: "transparent" } } }}><main data-theme={dark ? "dark" : "light"} className="compress-page">
      <div className="compress-shell">
          <aside className="media-nav compress-nav"><div className="compress-brand-row"><button className="brand compress-brand" disabled={batchBusy} onClick={() => router.push("/")}><i /><span>SevenMedia</span></button></div><p>媒体类型</p>{(Object.keys(MEDIA) as MediaKind[]).map((item) => <button key={item} disabled={batchBusy} className={kind === item ? "active" : ""} onClick={() => navigate(item)}><i><MediaIcon kind={item} /></i><span>{MEDIA[item].label}<small>{MEDIA[item].hint}</small></span></button>)}<div className="compress-nav-foot"><span><i />离线引擎<small>所有处理均在本机完成</small></span><Tooltip title={dark ? "切换到浅色" : "切换到深色"}><Button type="text" className="theme-svg-button" onClick={toggleTheme} icon={<img src={dark ? "/icons/theme-sun.svg" : "/icons/theme-moon.svg"} alt="" />} aria-label="切换主题" /></Tooltip></div></aside>
          <section className="stage">
            <div className="batch-content">
            <div className="batch-head"><div><span className="section-kicker">批量压缩</span><h1>{MEDIA[kind].label}工作台</h1><p>{tasks.length ? `${tasks.length} 个文件 · ${selectedTasks.length} 个已完成` : `一次选择多个${MEDIA[kind].label}文件`}</p></div><div className="batch-actions"><Button icon={<PlusOutlined />} disabled={batchBusy} onClick={() => input.current?.click()}>添加文件</Button><Button type="primary" icon={<UploadOutlined />} disabled={!readyTasks.length || batchBusy} loading={batchBusy} onClick={compress}>开始压缩</Button></div></div>
            <input ref={input} type="file" hidden multiple disabled={batchBusy} accept={MEDIA[kind].accept} onChange={(event) => { selectMany(event.target.files || undefined); event.target.value = ""; }} />
            {!tasks.length ? <button className="dropzone batch-dropzone" onClick={() => input.current?.click()} onDragOver={(event) => { if (!batchBusy) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); selectMany(event.dataTransfer.files); }}><span className="drop-icon"><PlusOutlined /></span><strong>拖入多个{MEDIA[kind].label}文件</strong><small>只接受{MEDIA[kind].label}格式，最大 5 GB / 个</small><em>或点击选择文件</em></button> :
              <div className="task-list">{tasks.map((task) => { const progress = task.uploadProgress < 100 ? task.uploadProgress : task.compressionProgress; const saving = task.result ? Math.max(0, 100 - task.result.size / task.file.size * 100) : 0; const unavailable = task.status === "done" && task.resultAvailable === false; return <article className={`task-row ${task.status} ${unavailable ? "unavailable" : ""}`} key={task.id} onClick={() => task.status === "done" && !unavailable && setPreviewId(task.id)}><div className="task-icon"><MediaIcon kind={kind} /></div><div className="task-main"><strong>{task.file.name}</strong><small>{formatBytes(task.file.size)} · {task.status === "ready" ? "等待处理" : task.status === "working" ? `${task.uploadProgress < 100 ? "上传" : "压缩"} ${progress}%` : unavailable ? "无法读取压缩结果 · 无法下载" : task.status === "done" ? `已完成 · 节省 ${saving.toFixed(0)}%` : task.error || "处理失败"}</small>{task.status === "working" && <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>}</div><span className="task-state">{unavailable ? "不可用" : task.status === "done" ? <CheckCircleFilled /> : task.status === "working" ? `${progress}%` : task.status === "error" ? "失败" : "待处理"}</span></article>; })}</div>}
            {message && <p className={`inline-error ${messageTone}`}>{message}</p>}
            {downloadPath && <p className="download-location">已保存到 <span>{downloadPath}</span></p>}
            </div>
          </section>
          <aside className="settings">
            <div className="section-label"><span>输出设置</span><b>{batchBusy ? "PROCESSING" : selectedTasks.length ? "COMPLETE" : "AUTO"}</b></div>
            {tasks.length > 0 && <label><span>目标大小 <b>{formatBytes(target * BYTES_PER_MB)}</b></span><Slider disabled={batchBusy} className="target-slider" min={targetSettings.min} max={targetSettings.max} step={targetSettings.step} value={target} onChange={setTarget} tooltip={{ open: false }} /></label>}
            <div className="quality-title"><span>{kind === "audio" ? "音频质量" : "画面质量"}</span><b>{qualityLabel}</b></div>
            <Segmented disabled={batchBusy} block className="quality-segment" options={QUALITY.map((item) => ({ label: item.label, value: item.value }))} value={quality} onChange={(value) => setQuality(Number(value))} />
            <dl><div><dt>输出格式</dt><dd>{outputFormat}</dd></div><div><dt>处理方式</dt><dd>{kind === "video" ? "两遍编码" : kind === "image" ? "自适应压缩" : "码率优化"}</dd></div></dl>
            <Button type="primary" className="primary" icon={<DownloadOutlined />} loading={downloadProgress !== null} disabled={!selectedTasks.length || batchBusy || downloadProgress !== null} onClick={download}>{downloadProgress === null ? (selectedTasks.length ? `下载${selectedTasks.length > 1 ? "全部 ZIP" : "结果"}` : unavailableTasks.length ? "结果不可下载" : "暂无可下载结果") : `正在下载 ${downloadProgress}%`}</Button>
            {unavailableTasks.length > 0 && <p className="download-location unavailable-note">有 {unavailableTasks.length} 个结果不可读取，无法下载，请重新压缩。</p>}
            {tasks.length > 0 && <Button className="secondary-action" icon={<ReloadOutlined />} disabled={batchBusy} onClick={clear}>新任务</Button>}
            <div className="settings-formats"><span>{MEDIA[kind].label}格式</span><p>{MEDIA[kind].formats.join(" · ")}</p></div>
          </aside>
      </div>
  <Modal open={Boolean(previewTask)} footer={null} width={980} onCancel={() => setPreviewId(null)} title={previewTask?.result?.name || "压缩结果"}>{previewTask?.result && <div className="preview-grid modal-preview"><article><span>压缩前</span><div className="preview"><Preview kind={kind} url={previewTask.sourceUrl} name={previewTask.file.name} /></div><footer><strong>{previewTask.file.name}</strong><b>{formatBytes(previewTask.file.size)}</b></footer></article><article className="after"><span>压缩后</span><div className="preview"><Preview kind={kind} url={previewTask.result.url} name={previewTask.result.name} onError={() => { updateTask(previewTask.id, { resultAvailable: false }); setPreviewId(null); setMessageTone("error"); setMessage("无法读取压缩结果，无法下载，请重新压缩。"); }} /></div><footer><strong>{previewTask.result.name}</strong><b>{formatBytes(previewTask.result.size)}</b></footer></article></div>}</Modal>
  </main></ConfigProvider>;
}
