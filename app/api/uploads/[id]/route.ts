import { NextRequest, NextResponse } from "next/server";
import { appendChunk, cancelSession, getSession, startCompression } from "@/lib/uploadSessions";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, context: Context) {
  try { const { id } = await context.params; return NextResponse.json(await getSession(id), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "任务不存在" }, { status: 404 }); }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params; const offset = Number(request.headers.get("x-chunk-offset"));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("分片偏移无效");
    const bytes = new Uint8Array(await request.arrayBuffer());
    const session = await appendChunk(id, offset, bytes);
    return NextResponse.json({ received: session.received, progress: Math.round(session.received / session.size * 100) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "分片上传失败" }, { status: 400 }); }
}

export async function POST(request: NextRequest, context: Context) {
  try { const { id } = await context.params; const action = new URL(request.url).searchParams.get("action"); if (action !== "complete") throw new Error("操作无效"); return NextResponse.json(await startCompression(id), { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无法开始压缩" }, { status: 400 }); }
}

export async function DELETE(_: NextRequest, context: Context) {
  try { const { id } = await context.params; await cancelSession(id); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无法取消任务" }, { status: 400 }); }
}
