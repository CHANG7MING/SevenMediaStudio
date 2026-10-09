import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { compressMediaFile, compressionErrorMessage } from "./compress.ts";

const execute = promisify(execFile);

test("missing desktop libraries explain engine startup failure instead of blaming the video", () => {
  const error = new Error("Command failed: /Applications/SevenMediaStudio.app/Contents/Resources/runtime/ffprobe\n" +
    "dyld[123]: Library not loaded: /opt/homebrew/Cellar/ffmpeg/8.1.2/lib/libavdevice.62.dylib");
  assert.equal(compressionErrorMessage(error), "压缩引擎启动失败：缺少运行依赖，请重新安装最新版本的桌面应用。");
});

test("missing FFmpeg executables give actionable setup instructions", () => {
  assert.match(compressionErrorMessage(new Error("spawn ffprobe ENOENT")), /未找到视频压缩引擎/);
  assert.match(compressionErrorMessage(new Error("spawn /Applications/SevenMedia Studio/runtime/ffmpeg ENOENT")), /未找到视频压缩引擎/);
  assert.equal(compressionErrorMessage(new Error("无法读取媒体时长")), "无法读取媒体时长");
});

test("video compression attempts very small targets instead of rejecting them by duration", { timeout: 60_000 }, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "seven-media-video-test-"));
  const input = path.join(folder, "source.mp4");
  const output = path.join(folder, "result.mp4");

  try {
    await execute("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "testsrc2=size=320x180:rate=24",
      "-f", "lavfi",
      "-i", "sine=frequency=1000:sample_rate=44100",
      "-t", "3",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-c:a", "aac",
      input,
    ]);

    const result = await compressMediaFile(input, "source.mp4", "video/mp4", {
      targetMB: 0.01,
      quality: 45,
    }, output);

    assert.equal(result.path, output);
    assert.ok(result.size > 0);
    assert.equal((await stat(output)).size, result.size);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
