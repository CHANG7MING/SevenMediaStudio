import { NextRequest, NextResponse } from "next/server";
import { CHUNK_SIZE, createSession, MAX_UPLOAD_SIZE } from "@/lib/uploadSessions";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const size = Number(body.size), targetMB = Number(body.targetMB), quality = Number(body.quality);
    if (!body.name || !body.kind || !Number.isFinite(targetMB) || targetMB <= 0 || targetMB > 2048 || !Number.isFinite(quality)) return NextResponse.json({ error: "任务参数无效" }, { status: 400 });
    const session = await createSession({ name: String(body.name), mime: String(body.mime || "application/octet-stream"), kind: body.kind, size, targetMB, quality });
    return NextResponse.json({ id: session.id, chunkSize: CHUNK_SIZE, maxSize: MAX_UPLOAD_SIZE });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无法准备文件上传，请稍后重试" }, { status: 400 }); }
}
