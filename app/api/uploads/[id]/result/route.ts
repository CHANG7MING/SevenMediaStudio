import { NextResponse } from "next/server";
import { resultInfo, resultStream } from "@/lib/uploadSessions";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  try {
    const { id } = await context.params; const { session, info } = await resultInfo(id);
    return new Response(resultStream(id) as unknown as BodyInit, { headers: { "content-type": session.outputMime || "application/octet-stream", "content-length": String(info.size), "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(session.outputName || "compressed-file")}`, "cache-control": "no-store", "accept-ranges": "none" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "结果尚不可用" }, { status: 404 }); }
}
