"use client";

import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export default function DesktopTitlebar() {
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const active = isTauri();
    setDesktop(active);
    document.documentElement.classList.toggle("tauri-desktop", active);
    return () => document.documentElement.classList.remove("tauri-desktop");
  }, []);

  if (!desktop) return null;

  return (
    <div className="desktop-titlebar" data-tauri-drag-region aria-label="SevenMediaStudio 窗口工具栏">
      <span data-tauri-drag-region>SevenMediaStudio</span>
    </div>
  );
}
