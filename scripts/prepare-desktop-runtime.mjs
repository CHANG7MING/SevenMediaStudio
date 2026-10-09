import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { bundleMacRuntime } from "./macos-runtime.mjs";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const runtime = path.join(root, "runtime");

if (!existsSync(path.join(standalone, "server.js"))) {
  throw new Error("Next standalone server.js was not generated.");
}

await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) {
  await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}

await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });

function findBinary(name) {
  const configured = process.env[name.toUpperCase() + "_PATH"];
  if (configured && existsSync(configured)) return configured;
  try {
    return execFileSync("which", [name], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const entries = [{ name: "node", source: process.execPath }];
for (const name of ["ffmpeg", "ffprobe"]) {
  const source = findBinary(name);
  if (!source) {
    throw new Error(`${name} was not found. Install it before building the desktop app.`);
  }
  entries.push({ name, source });
}

if (process.platform === "darwin") {
  const { libraries } = await bundleMacRuntime(entries, runtime);
  console.log(`Bundled ${libraries} shared libraries with relative load paths.`);
} else {
  for (const { name, source } of entries) {
    const destination = path.join(runtime, name);
    await cp(source, destination, { dereference: true });
    await chmod(destination, 0o755);
  }
}

console.log(`Prepared desktop runtime for ${os.arch()}: Node, ffmpeg and ffprobe.`);
