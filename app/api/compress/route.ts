import { NextRequest, NextResponse } from "next/server";
import { compressMedia, compressionErrorMessage } from "@/lib/compress";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    if (file.size > 500 * 1024 * 1024) return NextResponse.json({ error: "文件不能超过 500MB" }, { status: 413 });
    const targetMB = Number(form.get("targetMB") || 10);
    const quality = Number(form.get("quality") || 78);
    if (!Number.isFinite(targetMB) || targetMB <= 0 || targetMB > 500) return NextResponse.json({ error: "目标大小必须在 1–500 MB 之间" }, { status: 400 });
    if (!Number.isFinite(quality) || quality < 1 || quality > 100) return NextResponse.json({ error: "质量参数无效" }, { status: 400 });
    const result = await compressMedia(Buffer.from(await file.arrayBuffer()), file.name, file.type, {
      targetMB, quality,
    });
    return new NextResponse(new Uint8Array(result.buffer), { headers: {
      "content-type": result.mime, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,
      "x-output-name": encodeURIComponent(result.name), "cache-control": "no-store",
    }});
  } catch (error) {
    return NextResponse.json({ error: compressionErrorMessage(error) }, { status: 500 });
  }
}
