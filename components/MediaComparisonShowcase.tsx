"use client";

import { AudioOutlined, PictureOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Segmented } from "antd";
import Image from "next/image";
import { useRef, useState } from "react";

type DemoKind = "image" | "video" | "audio";
const demoOptions = [
  { label: <span><PictureOutlined /> 图片</span>, value: "image" },
  { label: <span><VideoCameraOutlined /> 视频</span>, value: "video" },
  { label: <span><AudioOutlined /> 音频</span>, value: "audio" },
];

function EizeComparison({ before, after, ratio }: { before: string; after: string; ratio: number }) {
  return <div className="size-comparison"><div className="size-summary"><span>文件体积对比</span><b>节省 {100 - ratio}%</b></div><div className="size-row"><span>压缩前</span><i><em style={{ width: "100%" }} /></i><b>{before}</b></div><div className="size-row after"><span>压缩后</span><i><em style={{ width: `${ratio}%` }} /></i><b>{after}</b></div></div>;
}

function DetailNotes() {
  return <div className="detail-notes"><div className="detail-note-left"><span>暗部细节<br />依然清晰</span><img src="/demo/arrow-left.svg" alt="" width="20" height="57" /></div><div><img src="/demo/arrow-right.svg" alt="" width="22" height="58" /><span>细微纹理<br />仍被保留</span></div></div>;
}

function ImageDemo() {
  const frame = useRef<HTMLDivElement>(null); const pending = useRef(50); const animationFrame = useRef<number | null>(null);
  const move = (clientX: number) => { const rect = frame.current?.getBoundingClientRect(); if (!rect) return; pending.current = Math.min(94, Math.max(6, ((clientX - rect.left) / rect.width) * 100)); if (animationFrame.current === null) animationFrame.current = requestAnimationFrame(() => { frame.current?.style.setProperty("--split", `${pending.current}%`); animationFrame.current = null; }); };
  return <><div className="compare-visual image-compare" ref={frame} style={{ "--split": "50%" } as React.CSSProperties} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); move(event.clientX); }} onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && move(event.clientX)}>
    <Image src="/demo/forest-original.avif" alt="压缩前的森林摄影图片" fill sizes="(max-width: 760px) 94vw, 1000px" priority />
    <div className="compressed-layer"><Image src="/demo/forest-compressed.avif" alt="压缩后的森林摄影图片" fill sizes="(max-width: 760px) 94vw, 1000px" /></div>
    <div className="compare-label before"><b>原图</b><span>929 KB</span></div><div className="compare-label after"><b>SEVENMEDIA</b><span>447 KB</span></div>
    <div className="compare-handle" aria-hidden="true"><span className="compare-handle-arrows"><svg viewBox="0 0 12 18"><path d="M10.5 1.5 2.5 9l8 7.5Z" /></svg><svg viewBox="0 0 12 18"><path d="m1.5 1.5 8 7.5-8 7.5Z" /></svg></span></div>
  </div><DetailNotes /><EizeComparison before="929 KB" after="447 KB" ratio={48} /></>;
}

function VideoDemo() {
  const first = useRef<HTMLVideoElement>(null); const second = useRef<HTMLVideoElement>(null);
  const sync = (source: HTMLVideoElement, target: HTMLVideoElement | null) => { if (target && Math.abs(target.currentTime - source.currentTime) > .18) target.currentTime = source.currentTime; };
  const playBoth = async () => { await Promise.allSettled([first.current?.play(), second.current?.play()]); };
  const pauseBoth = () => { first.current?.pause(); second.current?.pause(); };
  return <><div className="video-player-grid"><article><span>压缩前 · 9.1 MB</span><video ref={first} src="/demo/compression-sample.mp4" poster="/demo/video-first-frame.webp" controls muted playsInline preload="metadata" onPlay={playBoth} onPause={pauseBoth} onTimeUpdate={(event) => sync(event.currentTarget, second.current)} /></article><article><span>压缩后 · 2.3 MB</span><video ref={second} src="/demo/compression-sample-compressed.mp4" poster="/demo/video-first-frame.webp" controls muted playsInline preload="metadata" onPlay={playBoth} onPause={pauseBoth} onTimeUpdate={(event) => sync(event.currentTarget, first.current)} /></article></div><EizeComparison before="9.1 MB" after="2.3 MB" ratio={25} /></>;
}

function AudioDemo() {
  return <><div className="audio-player-grid"><article><div><span className="audio-art"><AudioOutlined /></span><span><b>原始音频</b><small>AAC · 原始轨道</small></span></div><audio src="/demo/audio-original.m4a" controls preload="metadata" /></article><article><div><span className="audio-art"><AudioOutlined /></span><span><b>压缩后</b><small>AAC · 64 kbps · 清晰人声</small></span></div><audio src="/demo/audio-compressed.m4a" controls preload="metadata" /></article></div><EizeComparison before="740 KB" after="538 KB" ratio={73} /></>;
}

export default function MediaComparisonEhowcase() {
  const [kind, setKind] = useState<DemoKind>("image");
  return <section className="comparison-showcase"><div className="showcase-heading"><div><p>BEFORE / AFTER</p><h2>看得见对比，<br />感觉不到损失。</h2></div><div><p>压缩不应该靠猜。</p><span>用适合每种媒体的方式，在下载前查看体积变化与实际效果。</span></div></div>
    <Segmented className="showcase-tabs" value={kind} onChange={(value) => setKind(value as DemoKind)} options={demoOptions} />
    <div className="showcase-panel"><div className="showcase-content" key={kind}>{kind === "image" ? <ImageDemo /> : kind === "video" ? <VideoDemo /> : <AudioDemo />}</div></div>
    <div className="showcase-foot"><span>拖动 · 播放 · A/B 对比</span><p>演示数据用于展示交互方式，实际结果以你的文件为准。</p></div>
  </section>;
}
