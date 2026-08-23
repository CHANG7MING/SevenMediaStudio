import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { compressMediaFile } from "./compress.ts";

const execute = promisify(execFile);

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
