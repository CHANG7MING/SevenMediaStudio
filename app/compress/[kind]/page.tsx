import { notFound } from "next/navigation";
import CompressionWorkspace, { type MediaKind } from "@/components/CompressionWorkspace";

const kinds = new Set(["video", "image", "audio"]);

export default async function CompressPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!kinds.has(kind)) notFound();
  return <CompressionWorkspace initialKind={kind as MediaKind} />;
}
