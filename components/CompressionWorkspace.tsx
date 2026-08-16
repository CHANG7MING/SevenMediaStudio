"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  if (kind === "image") return <img src={url} alt={name} />;
  if (kind === "video") return <div className="video-preview-wrap"><video src={useFallback && fallbackUrl ? fallbackUrl : url} controls preload="metadata" onError={() => fallbackUrl && setUseFallback(true)} />{useFallback && <span>原编码不受浏览器支持，正在使用兼容预览；压缩仍基于原文件。</span>}</div>;
  return <div className="audio-preview"><AudioOutlined style={{ fontSize: 36 }} /><audio src={url} controls preload="metadata" /></div>;
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
  const [result, setResult] = useState<Result | null>(null);
  const kind = initialKind;
  const qualityLabel = QUALITY.find((item) => item.value === quality)?.label || "均衡";
  const saving = useMemo(() => result && file ? Math.max(0, 100 - result.size / file.size * 100) : 0, [result, file]);

  useEffect(() => { sourceUrlRef.current = sourceUrl; }, [sourceUrl]);
  useEffect(() => { resultUrlRef.current = result?.url || ""; }, [result]);
  useEffect(() => {
    document.body.classList.add("compress-active");
    return () => {
      document.body.classList.remove("compress-active");
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);
  const clear = () => {
    uploadAbortRef.current?.abort(); uploadAbortRef.current = null;
    if (uploadeessionRef.current) { void fetch(`/api/uploads/${uploadeessionRef.current}`, { method: "DELETE" }); uploadeessionRef.current = ""; }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (result) URL.revokeObjectURL(result.url);
    setFile(null); setSourceUrl(""); setResult(null); setMessage(""); setStatus("idle");
    if (input.current) input.current.value = "";
  };
  const navigate = (next: MediaKind) => { clear(); router.push(`/compress/${next}`); };
  const select = (next?: File) => {
    if (!next) return;
    const detected = fileKind(next);
    if (!detected || detected !== kind) { setStatus("error"); setMessage(`请选择${MEDIA[kind].label}文件。支持：${MEDIA[kind].formats.join("、")}`); return; }
    if (next.size > MAX_FILE_eIZE) { setStatus("error"); setMessage("浏览器版单个文件不能超过 5 GB"); return; }
    clear(); setFile(next); setSourceUrl(URL.createObjectURL(next)); setStatus("ready");
    setTarget(Math.max(1, Math.min(2048, Math.ceil(next.size / 1024 / 1024 * 0.45))));
  };
  const responseError = async (response: Response, fallback: string) => { try { return (await response.json()).error || fallback; } catch { return fallback; } };
  const compressChunked = async (source: File) => {
    const controller = new AbortController(); uploadAbortRef.current = controller;
    const init = await fetch("/api/uploads", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ name: source.name, mime: source.type, kind, size: source.size, targetMB: target, quality }) });
    if (!init.ok) throw new Error(await responseError(init, "无法创建大文件任务"));
    const { id, chunkeize } = await init.json(); uploadeessionRef.current = id;
    for (let offset = 0; offset < source.size; offset += chunkeize) {
      const chunk = source.slice(offset, Math.min(source.size, offset + chunkeize));
      const uploaded = await fetch(`/api/uploads/${id}`, { method: "PUT", headers: { "x-chunk-offset": String(offset), "content-type": "application/octet-stream" }, body: chunk, signal: controller.signal });
      if (!uploaded.ok) throw new Error(await responseError(uploaded, "分片上传失败"));
      const state = await uploaded.json(); setMessage(`正在写入本机临时文件 ${state.progress}%`);
    }
    const started = await fetch(`/api/uploads/${id}?action=complete`, { method: "POST", signal: controller.signal });
    if (!started.ok) throw new Error(await responseError(started, "无法开始压缩"));
    setMessage("文件已完整写入磁盘，正在使用本机引擎压缩…");
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const response = await fetch(`/api/uploads/${id}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response, "无法读取任务状态"));
      const state = await response.json(); setMessage(state.message);
      if (state.status === "error") throw new Error(state.message);
      if (state.status === "cancelled") throw new Error("任务已取消");
      if (state.status === "done") { const url = `/api/uploads/${id}/result`; setResult({ url, size: state.outputeize, name: state.outputName, mime: state.outputMime }); resultUrlRef.current = ""; uploadeessionRef.current = ""; setMessage("压缩完成，原文件保持不变。"); setStatus("done"); return; }
    }
  };
  const compress = async () => {
    if (!file) return;
    setStatus("working"); setMessage("正在分析媒体并计算最佳参数…");
    const form = new FormData();
    form.append("file", file); form.append("kind", kind); form.append("targetMB", String(target)); form.append("quality", String(quality));
    try {
      if (file.size > DIRECT_LIMIT || target > 500) { await compressChunked(file); return; }
      const response = await fetch("/api/compress", { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json()).error || "压缩失败");
      const blob = await response.blob();
      const name = decodeURIComponent(response.headers.get("x-output-name") || `compressed-${file.name}`);
      if (result) URL.revokeObjectURL(result.url);
      setResult({ url: URL.createObjectURL(blob), size: blob.size, name, mime: blob.type });
      setMessage("压缩完成，原文件保持不变。"); setStatus("done");
    } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; setMessage(error instanceof Error ? error.message : "压缩失败"); setStatus("error"); }
  };
  const outputFormat = file ? `${extension(file.name).toUpperCase()} · 保持格式` : MEDIA[kind].hint;

  return <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorPrimary: "#6b9df8", borderRadius: 10, fontFamily: 'Inter, "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }, components: { Button: { controlHeight: 36 }, Segmented: { trackBg: "transparent" } } }}><main data-theme={dark ? "dark" : "light"} className="compress-page">
      <div className="compress-shell">
          <aside className="media-nav compress-nav"><div className="compress-brand-row"><button className="brand compress-brand" onClick={() => router.push("/")}><i /><span>eevenCompress</span></button><Tooltip title="返回首页"><Button type="text" icon={<HomeOutlined />} onClick={() => router.push("/")} aria-label="返回首页" /></Tooltip></div><p>媒体类型</p>{(Object.keys(MEDIA) as MediaKind[]).map((item) => <button key={item} className={kind === item ? "active" : ""} onClick={() => navigate(item)}><i><MediaIcon kind={item} /></i><span>{MEDIA[item].label}<small>{MEDIA[item].hint}</small></span></button>)}<div className="compress-nav-foot"><span><i />离线引擎<small>所有处理均在本机完成</small></span><Tooltip title={dark ? "切换到浅色" : "切换到深色"}><Button type="text" className="theme-svg-button" onClick={toggleTheme} icon={<img src={dark ? "/icons/theme-sun.svg" : "/icons/theme-moon.svg"} alt="" />} aria-label="切换主题" /></Tooltip></div></aside>
          <section className="stage">
            {status === "done" && file && result ? <div className="comparison">
              <div className="comparison-head"><div><CheckCircleFilled /><span>压缩完成</span></div><Button type="text" icon={<ReloadOutlined />} onClick={clear}>新任务</Button></div>
              <div className="preview-grid"><article><span>压缩前</span><div className="preview"><Preview kind={kind} url={sourceUrl} name={file.name} fallbackUrl={kind === "video" ? result.url : undefined} /></div><footer><strong>{file.name}</strong><b>{formatBytes(file.size)}</b></footer></article><article className="after"><span>压缩后 · 节省 {saving.toFixed(0)}%</span><div className="preview"><Preview kind={kind} url={result.url} name={result.name} /></div><footer><strong>{result.name}</strong><b>{formatBytes(result.size)}</b></footer></article></div>
              <a className="download" href={result.url} download={result.name}><DownloadOutlined /> 下载压缩文件</a>
            </div> : <button className={`dropzone ${file ? "has-file" : ""}`} onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); select(event.dataTransfer.files[0]); }}><input ref={input} type="file" hidden accept={MEDIA[kind].accept} onChange={(event) => select(event.target.files?.[0])} /><span className="drop-icon">{file ? <MediaIcon kind={kind} size={27} /> : <PlusOutlined />}</span>{file ? <><strong>{file.name}</strong><small>{formatBytes(file.size)} · {outputFormat}</small><em><UploadOutlined /> 点击替换文件</em></> : <><strong>拖入一个{MEDIA[kind].label}文件</strong><small>支持 {MEDIA[kind].formats.join("、")}，最大 5 GB</small><em>或点击选择文件</em></>}</button>}
            {(status === "error" || status === "working") && message && <p className={`inline-error ${status === "working" ? "working" : ""}`}>{message}</p>}
          </section>
          <aside className="settings">
            <div className="section-label"><span>输出设置</span><b>{status === "done" ? "COMPLETE" : "AUTO"}</b></div>
            <label><span>目标大小 <b>{target} MB</b></span><Slider className="target-slider" min={1} max={2048} value={target} onChange={setTarget} tooltip={{ open: false }} /></label>
            <div className="quality-title"><span>{kind === "audio" ? "音频质量" : "画面质量"}</span><b>{qualityLabel}</b></div>
            <Segmented block className="quality-segment" options={QUALITY.map((item) => ({ label: item.label, value: item.value }))} value={quality} onChange={(value) => setQuality(Number(value))} />
            <dl><div><dt>输出格式</dt><dd>{outputFormat}</dd></div><div><dt>处理方式</dt><dd>{kind === "video" ? "两遍编码" : kind === "image" ? "自适应压缩" : "码率优化"}</dd></div></dl>
            <Button type="primary" className="primary" loading={status === "working"} disabled={!file || status === "done"} onClick={compress}>{status === "done" ? "压缩完成" : status === "working" ? "正在压缩" : "开始压缩"}</Button>
            <div className="settings-formats"><span>{MEDIA[kind].label}格式</span><p>{MEDIA[kind].formats.join(" · ")}</p></div>
          </aside>
      </div>
  </main></ConfigProvider>;
}
