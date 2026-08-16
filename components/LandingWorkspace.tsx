"use client";

import { AudioOutlined, PictureOutlined, PlusOutlined, SafetyCertificateOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Tooltip, theme as antdTheme } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MediaKind } from "./CompressionWorkspace";
import MediaComparisonShowcase from "./MediaComparisonShowcase";
import { useGlobalTheme } from "./GlobalThemeProvider";

const items: { kind: MediaKind; label: string; hint: string }[] = [
  { kind: "video", label: "视频", hint: "保持原视频格式" },
  { kind: "image", label: "图片", hint: "保持原图片格式" },
  { kind: "audio", label: "音频", hint: "保持原音频格式" },
];

function Icon({ kind }: { kind: MediaKind }) {
  return kind === "video" ? <VideoCameraOutlined /> : kind === "image" ? <PictureOutlined /> : <AudioOutlined />;
}

export default function LandingWorkspace() {
  const router = useRouter();
  const { dark, toggleTheme, startRouteTransition } = useGlobalTheme();
  const [loadingTarget, setLoadingTarget] = useState<MediaKind | null>(null);

  useEffect(() => {
    items.forEach(({ kind }) => router.prefetch(`/compress/${kind}`));
  }, [router]);

  const open = (kind: MediaKind) => {
    if (loadingTarget) return;
    setLoadingTarget(kind);
    startRouteTransition(`/compress/${kind}`, `${items.find((item) => item.kind === kind)?.label}压缩工作台`);
  };
  return <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorPrimary: "#6b9df8", borderRadius: 10, fontFamily: 'Inter, "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}><main data-theme={dark ? "dark" : "light"} className="landing-page">
    <nav className="toolbar"><button className="brand" onClick={() => router.push("/")}><i /><span>SevenMedia</span><small>STUDIO</small></button><div className="toolbar-meta"><span><SafetyCertificateOutlined /> 本地处理</span><span className="secure"><i />文件不上传云端</span><Tooltip title={dark ? "切换到浅色" : "切换到深色"}><Button type="text" className="theme-svg-button" onClick={toggleTheme} icon={<img src={dark ? "/icons/theme-sun.svg" : "/icons/theme-moon.svg"} alt="" />} aria-label="切换主题" /></Tooltip></div></nav>
    <section className="workspace landing-workspace">
      <header><p>SEVENMEDIA STUDIO</p><h1><span>更小的文件</span><span>保留重要的部分</span></h1><span>选择一种媒体类型进入独立工作台。首页不读取文件，也不会开始任何处理。</span></header>
      <div className="window landing-window">
        <div className="window-bar"><div><i /><i /><i /></div><span>选择压缩工具</span><b>OFFLINE READY</b></div>
        <div className="window-body">
          <aside className="media-nav"><p>媒体类型</p>{items.map((item) => <button key={item.kind} onClick={() => open(item.kind)}><i><Icon kind={item.kind} /></i><span>{item.label}<small>{item.hint}</small></span></button>)}<div><i />离线引擎<small>所有处理均在本机完成</small></div></aside>
          <button className="dropzone landing-drop" onClick={() => open("video")}><span className="drop-icon"><PlusOutlined /></span><strong>选择一个压缩工具</strong><small>视频、图片或音频，进入工作台后再选择文件</small><em>进入视频压缩</em></button>
          <aside className="settings landing-settings"><div className="section-label"><span>工作方式</span><b>LOCAL</b></div><div className="landing-copy"><strong>三种独立工作台</strong><p>每类媒体拥有自己的文件校验、压缩策略与前后对比。</p></div><dl><div><dt>文件处理</dt><dd>仅在对应路由</dd></div><div><dt>源文件</dt><dd>永不覆盖</dd></div><div><dt>输出格式</dt><dd>默认保持一致</dd></div></dl><Button type="primary" className="primary" icon={<VideoCameraOutlined />} onClick={() => open("video")}>进入视频压缩</Button></aside>
        </div>
      </div>
      <div className="capabilities"><span>01 视频</span><span>02 图片</span><span>03 音频</span><p>FFmpeg + Sharp · 面向桌面端的本地架构</p></div>
      <MediaComparisonShowcase />
    </section>
  </main></ConfigProvider>;
}
