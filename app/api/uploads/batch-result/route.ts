import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { resultFilePath, resultInfo } from "@/lib/uploadSessions";
import { ZipArchive } from "archiver";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ids = [...new Set(new URL(request.url).searchParams.getAll("id"))];
    if (!ids.length || ids.length > 100) throw new Error("批量下载任务无效");
    const results = await Promise.all(ids.map(async (id) => {
      const { session, info } = await resultInfo(id);
      return { id, name: session.outputName || `compressed-${id}`, path: resultFilePath(id, session.name), size: info.size };
    }));
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const stream = Readable.toWeb(archive) as unknown as BodyInit;
    for (const result of results) archive.append(createReadStream(result.path), { name: result.name });
    void archive.finalize();
    const total = results.reduce((sum, result) => sum + result.size, 0);
    return new Response(stream, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": "attachment; filename*=UTF-8''seven-media-compressed.zip",
        "cache-control": "no-store",
        "x-uncompressed-size": String(total),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法创建压缩包" }, { status: 400 });
  }
}
