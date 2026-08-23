import type { MediaJob } from "../media/types";

export type DesktopAppInfo = {
  arch: string;
  os: string;
};

export type AddLocalJobInput = Pick<MediaJob, "type" | "inputPath" | "outputPath" | "settings">;

export function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getDesktopAppInfo() {
  if (!isDesktopRuntime()) {
    throw new Error("SevenMediaStudio desktop runtime is not available");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopAppInfo>("app_info");
}
