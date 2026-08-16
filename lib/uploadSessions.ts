import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { compressMediaFile, compressionErrorMessage } from "./compress";

export const MAX_UPLOAD_SIZE = 5 * 1024 ** 3;
export const CHUNK_SIZE = 16 * 1024 ** 2;
const MIN_PROCESS_RESERVE = 256 * 1024 ** 2;
const ROOT = path.join(tmpdir(), "seven-media-browser");
const saveQueues = new Map<string, Promise<void>>();

export type UploadStatus = "uploading" | "queued" | "compressing" | "done" | "error" | "cancelled";
export type UploadSession = {
  id: string; name: string; mime: string; kind: "video" | "image" | "audio"; size: number;
  targetMB: number; quality: number; received: number; status: UploadStatus; message: string; compressionProgress: number;
  outputName?: string; outputMime?: string; outputSize?: number; createdAt: number;
};

function safeId(id: string) { if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("无效任务编号"); return id; }
export function sessionDir(id: string) { return path.join(ROOT, safeId(id)); }
export function inputPath(id: string) { return path.join(sessionDir(id), "source.bin"); }
export function outputPath(id: string, name: string) {
  const extension = path.extname(name).toLowerCase() || ".mp4";
  return path.join(sessionDir(id), `result${extension}`);
}
function metaPath(id: string) { return path.join(sessionDir(id), "session.json"); }

export async function createSession(input: Pick<UploadSession, "name" | "mime" | "kind" | "size" | "targetMB" | "quality">) {
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MAX_UPLOAD_SIZE) throw new Error("文件大小必须在 1B–5GB 之间");
  await mkdir(ROOT, { recursive: true });
  const disk = await statfs(ROOT);
  const available = disk.bavail * disk.bsize;
  const targetBytes = input.targetMB * 1024 ** 2;
  const reserve = Math.max(MIN_PROCESS_RESERVE, Math.ceil(targetBytes * 1.25));
  const required = input.size + reserve;
  if (available < required) {
    const requiredMB = Math.ceil(required / 1024 ** 2);
    throw new Error(`磁盘空间不足；上传和处理该文件至少需要约 ${requiredMB} MB 可用空间。`);
  }
  const session: UploadSession = { ...input, id: randomUUID(), received: 0, status: "uploading", message: "准备接收文件", compressionProgress: 0, createdAt: Date.now() };
  await mkdir(sessionDir(session.id), { recursive: true });
  await writeFile(inputPath(session.id), new Uint8Array());
  await saveSession(session);
  return session;
}

export async function getSession(id: string): Promise<UploadSession> {
  const raw = await readFile(metaPath(id), "utf8");
  try {
    return JSON.parse(raw) as UploadSession;
  } catch {
    throw new Error("任务状态读取失败，请重新上传文件");
  }
}

export async function saveSession(session: UploadSession) {
  const previous = saveQueues.get(session.id) || Promise.resolve();
  let next: Promise<void>;
  next = previous.catch(() => undefined).then(async () => {
    const file = metaPath(session.id);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(session), "utf8");
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  });
  saveQueues.set(session.id, next);
  try {
    await next;
  } finally {
    if (saveQueues.get(session.id) === next) saveQueues.delete(session.id);
  }
}

export async function appendChunk(id: string, offset: number, bytes: Uint8Array) {
  const session = await getSession(id);
  if (session.status !== "uploading") throw new Error("该任务当前不能继续上传");
  if (offset !== session.received) throw new Error(`分片顺序不一致，应从 ${session.received} 字节继续`);
  if (bytes.byteLength > CHUNK_SIZE || session.received + bytes.byteLength > session.size) throw new Error("分片大小无效");
  await appendFile(inputPath(id), bytes);
  session.received += bytes.byteLength;
  session.message = `正在上传 ${Math.round(session.received / session.size * 100)}%`;
  await saveSession(session);
  return session;
}

export async function startCompression(id: string) {
  const session = await getSession(id);
  if (session.received !== session.size) throw new Error("文件尚未上传完整");
  const sourceInfo = await stat(inputPath(id));
  if (sourceInfo.size !== session.size) throw new Error("文件尚未上传完整，请等待上传进度到 100% 后重试");
  session.status = "queued"; session.compressionProgress = 0; session.message = "文件上传完成，准备压缩"; await saveSession(session);
  void (async () => {
    try {
      session.status = "compressing"; session.message = "正在使用本机引擎压缩"; await saveSession(session);
      const result = await compressMediaFile(inputPath(id), session.name, session.mime, {
        targetMB: session.targetMB,
        quality: session.quality,
        onProgress: async (progress) => {
          session.compressionProgress = progress;
          session.message = `正在压缩 ${progress}%`;
          await saveSession(session);
        },
      }, outputPath(id, session.name));
      session.compressionProgress = 100; session.status = "done"; session.message = "压缩完成"; session.outputName = result.name; session.outputMime = result.mime; session.outputSize = result.size;
      await saveSession(session);
    } catch (error) {
      session.status = "error"; session.message = compressionErrorMessage(error); await saveSession(session);
    }
  })();
  return session;
}

export async function cancelSession(id: string) {
  const session = await getSession(id); session.status = "cancelled"; session.message = "任务已取消"; await saveSession(session);
  await rm(sessionDir(id), { recursive: true, force: true });
}
export async function resultInfo(id: string) {
  const session = await getSession(id);
  if (session.status !== "done" || !session.outputName) throw new Error("结果尚未生成");
  const info = await stat(outputPath(id, session.name)); return { session, info };
}
export function resultStream(id: string, name: string) { return Readable.toWeb(createReadStream(outputPath(id, name))); }
