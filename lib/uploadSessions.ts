import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { compressMediaFile } from "./compress";

export const MAX_UPLOAD_SIZE = 5 * 1024 ** 3;
export const CHUNK_SIZE = 16 * 1024 ** 2;
const ROOT = path.join(tmpdir(), "seven-media-browser");

export type UploadStatus = "uploading" | "queued" | "compressing" | "done" | "error" | "cancelled";
export type UploadSession = {
  id: string; name: string; mime: string; kind: "video" | "image" | "audio"; size: number;
  targetMB: number; quality: number; received: number; status: UploadStatus; message: string;
  outputName?: string; outputMime?: string; outputSize?: number; createdAt: number;
};

function safeId(id: string) { if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("无效任务编号"); return id; }
export function sessionDir(id: string) { return path.join(ROOT, safeId(id)); }
export function inputPath(id: string) { return path.join(sessionDir(id), "source.bin"); }
export function outputPath(id: string) { return path.join(sessionDir(id), "result.bin"); }
function metaPath(id: string) { return path.join(sessionDir(id), "session.json"); }

export async function createSession(input: Pick<UploadSession, "name" | "mime" | "kind" | "size" | "targetMB" | "quality">) {
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MAX_UPLOAD_SIZE) throw new Error("文件大小必须在 1B–5GB 之间");
  await mkdir(ROOT, { recursive: true });
  const disk = await statfs(ROOT);
  const available = disk.bavail * disk.bsize;
  const reserve = Math.max(2 * 1024 ** 3, Math.ceil(input.size * 1.25));
  if (available < input.size + reserve) throw new Error(`磁盘空间不足；处理该文件建议至少保留 ${Math.ceil((input.size + reserve) / 1024 ** 3)}GB 可用空间。`);
  const session: UploadSession = { ...input, id: randomUUID(), received: 0, status: "uploading", message: "准备接收文件", createdAt: Date.now() };
  await mkdir(sessionDir(session.id), { recursive: true });
  await writeFile(inputPath(session.id), new Uint8Array());
  await saveSession(session);
  return session;
}

export async function getSession(id: string): Promise<UploadSession> { return JSON.parse(await readFile(metaPath(id), "utf8")); }
export async function saveSession(session: UploadSession) { await writeFile(metaPath(session.id), JSON.stringify(session)); }

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
  session.status = "queued"; session.message = "文件上传完成，准备压缩"; await saveSession(session);
  void (async () => {
    try {
      session.status = "compressing"; session.message = "正在使用本机引擎压缩"; await saveSession(session);
      const result = await compressMediaFile(inputPath(id), session.name, session.mime, { targetMB: session.targetMB, quality: session.quality }, outputPath(id));
      session.status = "done"; session.message = "压缩完成"; session.outputName = result.name; session.outputMime = result.mime; session.outputSize = result.size;
      await saveSession(session);
    } catch (error) {
      session.status = "error"; session.message = error instanceof Error ? error.message : "压缩失败"; await saveSession(session);
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
  const info = await stat(outputPath(id)); return { session, info };
}
export function resultStream(id: string) { return Readable.toWeb(createReadStream(outputPath(id))); }
