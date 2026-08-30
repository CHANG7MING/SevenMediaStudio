import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

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

const nodePath = path.join(runtime, "node");
await cp(process.execPath, nodePath);
await chmod(nodePath, 0o755);

function findBinary(name) {
  const configured = process.env[name.toUpperCase() + "_PATH"];
  if (configured && existsSync(configured)) return configured;
  try {
    return execFileSync("which", [name], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

for (const name of ["ffmpeg", "ffprobe"]) {
  const source = findBinary(name);
  if (!source) {
    throw new Error(`${name} was not found. Install it before building the desktop app.`);
  }
  const destination = path.join(runtime, name);
  await cp(source, destination, { dereference: true });
  await chmod(destination, 0o755);
}

console.log(`Prepared desktop runtime for ${os.arch()}: Node, ffmpeg and ffprobe.`);
