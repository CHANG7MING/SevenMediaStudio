import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execute = promisify(execFile);
const VIDEO = new Set([".mp4", ".webm", ".mov", ".avi", ".m4v", ".mkv"]);
const AUDIO = new Set([".mp3", ".wav", ".m4a", ".flac", ".aac", ".acc", ".wma", ".aiff", ".aif", ".opus", ".ogg"]);
const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif", ".avif", ".tif", ".tiff", ".bmp"]);
const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".m4v": "video/x-m4v", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".flac": "audio/flac", ".aac": "audio/aac", ".acc": "audio/aac", ".wma": "audio/x-ms-wma", ".aiff": "audio/aiff", ".aif": "audio/aiff", ".opus": "audio/opus", ".ogg": "audio/ogg",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".avif": "image/avif", ".tif": "image/tiff", ".tiff": "image/tiff", ".bmp": "image/bmp",
};

function executable(name: "ffmpeg" | "ffprobe") {
  const configured = process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (configured && existsSync(configured)) return configured;
  if (process.platform !== "win32") return name;
  const root = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  const find = (folder: string): string | undefined => {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === `${name}.exe`) return full;
      if (entry.isDirectory()) { const match = find(full); if (match) return match; }
    }
  };
  const installed = find(root);
  if (installed) return installed;
  return name;
}

async function duration(file: string) {
  const { stdout } = await execute(executable("ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number(stdout.trim());
}

type ProgressHandler = (progress: number) => Promise<void> | void;
type CompressionOptions = { targetMB: number; quality: number; onProgress?: ProgressHandler };

async function executeWithProgress(command: string, args: string[], seconds: number, onProgress?: ProgressHandler) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ["-progress", "pipe:1", "-nostats", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    let progressQueue = Promise.resolve();
    const report = (value: number) => {
      if (!onProgress || !Number.isFinite(value)) return;
      const progress = Math.max(0, Math.min(100, Math.round(value)));
      progressQueue = progressQueue.then(() => onProgress(progress));
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        const match = line.match(/^out_time_(?:us|ms)=(\d+)$/);
        if (match) {
          const divisor = line.startsWith("out_time_ms") ? 1000 : 1_000_000;
          report(Number(match[1]) / divisor / seconds * 100);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", async (code, signal) => {
      await progressQueue;
      if (code === 0) { report(100); await progressQueue; resolve(); return; }
      const detail = stderr.trim() || `FFmpeg exited with code ${code ?? signal ?? "unknown"}`;
      reject(new Error(detail));
    });
  });
}

export function compressionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "压缩失败";
  if (/Unable to choose an output format|Invalid argument|Error initializing the muxer|Error opening output file/i.test(message)) {
    return "压缩失败：当前文件格式无法生成结果，请确认文件完整后重试。";
  }
  if (/Command failed|ffmpeg version|Error opening input|Error opening output files/i.test(message) || message.length > 500) {
    return "压缩失败：本机引擎无法处理该文件，请确认文件完整后重试。";
  }
  return message;
}

export async function compressMedia(buffer: Buffer, name: string, mime: string, options: CompressionOptions) {
  const stem = path.parse(name).name;
  const extension = path.extname(name).toLowerCase() || (mime.startsWith("image/") ? ".png" : mime.startsWith("audio/") ? ".m4a" : ".mp4");
  const type = VIDEO.has(extension) ? "video" : AUDIO.has(extension) ? "audio" : IMAGE.has(extension) ? "image" : null;
  if (!type) throw new Error(`暂不支持 ${extension || "该"} 格式`);
  const limit = options.targetMB * 1024 * 1024;
  const assertTarget = (size: number) => {
    if (size > limit * 1.05) throw new Error(`目标 ${options.targetMB} MB 过小；在保持当前格式和质量的情况下，建议至少 ${(size / 1024 / 1024).toFixed(1)} MB。`);
  };
  if (type === "image") {
    if (extension === ".svg") {
      const source = buffer.toString("utf8");
      const optimized = source.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
      const output = Buffer.from(optimized.length < source.length ? optimized : source);
      assertTarget(output.length);
      return { buffer: output, name: `${stem}-compressed${extension}`, mime: MIME[extension] };
    }
    if (extension === ".bmp") {
      const folder = await mkdtemp(path.join(tmpdir(), "seven-media-image-"));
      const input = path.join(folder, `input${extension}`), output = path.join(folder, `${stem}-compressed${extension}`);
      try {
        await writeFile(input, buffer);
        const maxWidth = options.quality >= 90 ? 2400 : options.quality >= 78 ? 1920 : options.quality >= 60 ? 1600 : 1280;
        await execute(executable("ffmpeg"), ["-y", "-i", input, "-vf", `scale='min(${maxWidth},iw)':-2:flags=lanczos`, "-frames:v", "1", output]);
        const encoded = await readFile(output);
        const result = encoded.length >= buffer.length ? Buffer.from(buffer) : encoded;
        assertTarget(result.length);
        return { buffer: result, name: `${stem}-compressed${extension}`, mime: MIME[extension] };
      } finally { await rm(folder, { recursive: true, force: true }); }
    }
    const maxWidth = options.quality >= 100 ? 3200 : options.quality >= 90 ? 2560 : options.quality >= 78 ? 2400 : options.quality >= 60 ? 1920 : 1600;
    const image = sharp(buffer, { failOn: "none", animated: extension === ".gif" }).rotate().resize({ width: maxWidth, withoutEnlargement: true });
    const encode = (quality: number) => {
      if (extension === ".png") return image.clone().png({ compressionLevel: 9, palette: true, quality, effort: 10 }).toBuffer();
      if (extension === ".jpg" || extension === ".jpeg") return image.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
      if (extension === ".avif") return image.clone().avif({ quality, effort: 7 }).toBuffer();
      if (extension === ".tif" || extension === ".tiff") return image.clone().tiff({ quality, compression: "jpeg" }).toBuffer();
      if (extension === ".gif") return image.clone().gif({ effort: 7 }).toBuffer();
      return image.clone().webp({ quality, effort: 5 }).toBuffer();
    };
    let low = 25, high = Math.min(100, options.quality), output = await encode(high);
    while (low <= high) {
      const quality = Math.floor((low + high) / 2);
      const candidate = await encode(quality);
      if (candidate.length <= limit) { output = candidate; low = quality + 1; } else high = quality - 1;
    }
    if (output.length >= buffer.length) output = buffer;
    assertTarget(output.length);
    return { buffer: output, name: `${stem}-compressed${extension}`, mime: MIME[extension] || mime };
  }
  const folder = await mkdtemp(path.join(tmpdir(), "seven-media-"));
  const input = path.join(folder, name.replaceAll(/[\\/:*?"<>|]/g, "-"));
  const isVideo = type === "video";
  const outputName = `${stem}-compressed${extension}`;
  const output = path.join(folder, outputName);
  try {
    await writeFile(input, buffer);
    const seconds = await duration(input);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("无法读取媒体时长");
    const total = options.targetMB * 1024 * 1024 * 8 / seconds / 1000 * .95;
    if (isVideo) {
      const audio = 64, video = Math.max(180, Math.floor(total - audio));
      const minimum = seconds * (180 + audio) * 1000 / 8 / 1024 / 1024 / .95;
      if (total < 244) throw new Error(`目标 ${options.targetMB} MB 过小；按当前时长建议至少 ${minimum.toFixed(1)} MB。`);
      const passlog = path.join(folder, "pass");
      const webm = extension === ".webm";
      const videoCodec = webm ? "libvpx-vp9" : extension === ".avi" ? "mpeg4" : "libx264";
      const audioCodec = webm ? "libopus" : extension === ".avi" ? "libmp3lame" : "aac";
      const width = options.quality >= 100 ? 2560 : options.quality >= 90 ? 1920 : options.quality >= 78 ? 1280 : options.quality >= 60 ? 960 : 854;
      const fps = options.quality >= 100 ? 60 : options.quality >= 78 ? 30 : 24;
      const common = ["-y", "-i", input, "-vf", `scale='min(${width},iw)':-2:flags=lanczos,fps='min(${fps},source_fps)'`, "-c:v", videoCodec, ...(videoCodec === "libx264" ? ["-preset", "slow"] : []), "-b:v", `${video}k`];
      await execute(executable("ffmpeg"), [...common, "-pass", "1", "-passlogfile", passlog, "-an", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
      await execute(executable("ffmpeg"), [...common, "-pass", "2", "-passlogfile", passlog, "-c:a", audioCodec, "-b:a", `${audio}k`, ...(extension === ".mp4" || extension === ".m4v" || extension === ".mov" ? ["-movflags", "+faststart"] : []), output]);
    } else {
      const bitrate = Math.max(32, Math.min(320, Math.floor(total)));
      const codec = extension === ".mp3" ? "libmp3lame" : extension === ".flac" ? "flac" : extension === ".wav" ? "pcm_s16le" : extension === ".aiff" || extension === ".aif" ? "pcm_s16be" : extension === ".wma" ? "wmav2" : extension === ".opus" ? "libopus" : extension === ".ogg" ? "libvorbis" : "aac";
      const format = extension === ".acc" ? ["-f", "adts"] : [];
      await execute(executable("ffmpeg"), ["-y", "-i", input, "-vn", "-c:a", codec, ...(codec === "flac" || codec.startsWith("pcm_" ) ? [] : ["-b:a", `${bitrate}k`]), ...format, output]);
    }
    const result = await readFile(output);
    assertTarget(result.length);
    return { buffer: result, name: outputName, mime: MIME[extension] || mime };
  } finally { await rm(folder, { recursive: true, force: true }); }
}

export async function compressMediaFile(input: string, name: string, mime: string, options: CompressionOptions, output: string) {
  const stem = path.parse(name).name;
  const extension = path.extname(name).toLowerCase() || (mime.startsWith("image/") ? ".png" : mime.startsWith("audio/") ? ".m4a" : ".mp4");
  const type = VIDEO.has(extension) ? "video" : AUDIO.has(extension) ? "audio" : IMAGE.has(extension) ? "image" : null;
  if (!type) throw new Error(`暂不支持 ${extension || "该"} 格式`);
  const outputName = `${stem}-compressed${extension}`;
  const limit = options.targetMB * 1024 * 1024;
  if (type === "image") {
    const sourceInfo = await stat(input);
    if (sourceInfo.size > 750 * 1024 * 1024) throw new Error("超大图片暂不支持；5GB 模式主要用于视频和音频。");
    await options.onProgress?.(10);
    const result = await compressMedia(await readFile(input), name, mime, options);
    await writeFile(output, result.buffer);
    await options.onProgress?.(100);
    return { path: output, name: result.name, mime: result.mime, size: result.buffer.length };
  }
  const seconds = await duration(input);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("无法读取媒体时长");
  const total = options.targetMB * 1024 * 1024 * 8 / seconds / 1000 * .95;
  if (type === "video") {
    const audio = 64, video = Math.max(180, Math.floor(total - audio));
    const minimum = seconds * (180 + audio) * 1000 / 8 / 1024 / 1024 / .95;
    if (total < 244) throw new Error(`目标 ${options.targetMB} MB 过小；按当前时长建议至少 ${minimum.toFixed(1)} MB。`);
    const passlog = path.join(path.dirname(output), "pass");
    const webm = extension === ".webm";
    const videoCodec = webm ? "libvpx-vp9" : extension === ".avi" ? "mpeg4" : "libx264";
    const audioCodec = webm ? "libopus" : extension === ".avi" ? "libmp3lame" : "aac";
    const width = options.quality >= 100 ? 2560 : options.quality >= 90 ? 1920 : options.quality >= 78 ? 1280 : options.quality >= 60 ? 960 : 854;
    const fps = options.quality >= 100 ? 60 : options.quality >= 78 ? 30 : 24;
    const common = ["-y", "-i", input, "-vf", `scale='min(${width},iw)':-2:flags=lanczos,fps='min(${fps},source_fps)'`, "-c:v", videoCodec, ...(videoCodec === "libx264" ? ["-preset", "slow"] : []), "-b:v", `${video}k`];
    await executeWithProgress(executable("ffmpeg"), [...common, "-pass", "1", "-passlogfile", passlog, "-an", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"], seconds, progress => options.onProgress?.(progress / 2));
    await executeWithProgress(executable("ffmpeg"), [...common, "-pass", "2", "-passlogfile", passlog, "-c:a", audioCodec, "-b:a", `${audio}k`, ...(extension === ".mp4" || extension === ".m4v" || extension === ".mov" ? ["-movflags", "+faststart"] : []), output], seconds, progress => options.onProgress?.(50 + progress / 2));
  } else {
    const bitrate = Math.max(32, Math.min(320, Math.floor(total)));
    const codec = extension === ".mp3" ? "libmp3lame" : extension === ".flac" ? "flac" : extension === ".wav" ? "pcm_s16le" : extension === ".aiff" || extension === ".aif" ? "pcm_s16be" : extension === ".wma" ? "wmav2" : extension === ".opus" ? "libopus" : extension === ".ogg" ? "libvorbis" : "aac";
    const format = extension === ".acc" ? ["-f", "adts"] : [];
    await executeWithProgress(executable("ffmpeg"), ["-y", "-i", input, "-vn", "-c:a", codec, ...(codec === "flac" || codec.startsWith("pcm_") ? [] : ["-b:a", `${bitrate}k`]), ...format, output], seconds, options.onProgress);
  }
  const info = await stat(output);
  if (info.size > limit * 1.05) throw new Error(`目标 ${options.targetMB} MB 过小；当前结果约 ${(info.size / 1024 / 1024).toFixed(1)} MB。`);
  return { path: output, name: outputName, mime: MIME[extension] || mime, size: info.size };
}
