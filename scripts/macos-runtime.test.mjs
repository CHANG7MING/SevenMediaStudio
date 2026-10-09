import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bundleMacRuntime, parseDependencies, parseRpaths, resolveDependency } from "./macos-runtime.mjs";

test("reads Mach-O load commands including paths containing spaces", () => {
  assert.deepEqual(parseDependencies("/tmp/a:\n\t/opt/a b/libx.dylib (compatibility version 1.0.0, current version 1.2.0)\n"), ["/opt/a b/libx.dylib"]);
  assert.deepEqual(parseRpaths("Load command 8\n          cmd LC_RPATH\n      cmdsize 48\n         path @loader_path/a b (offset 12)\n"), ["@loader_path/a b"]);
});

test("resolves rpaths in loader order and reports missing dependencies", () => {
  const context = { source: "/opt/bin/ffmpeg", executable: "/opt/bin/ffmpeg", rpaths: ["/opt/lib", "/usr/local/lib"] };
  assert.equal(resolveDependency("@rpath/libx.dylib", context, (candidate) => candidate === "/usr/local/lib/libx.dylib"), "/usr/local/lib/libx.dylib");
  assert.equal(resolveDependency("@loader_path/../lib/libx.dylib", context, () => true), "/opt/bin/../lib/libx.dylib");
  assert.throws(() => resolveDependency("/missing/libx.dylib", context, () => false), /Cannot bundle.*required by/);
});

async function fixture(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "seven-runtime-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const source = path.join(folder, "build host");
  const runtime = path.join(folder, "runtime");
  await mkdir(source, { recursive: true });
  await mkdir(runtime, { recursive: true });
  const calls = [];
  const binary = async (relative, metadata) => {
    const file = path.join(source, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ dependencies: [], rpaths: [], ...metadata }));
    return file;
  };
  const run = (command, args) => {
    calls.push({ command, args });
    if (command === "otool") {
      const file = args[1];
      const metadata = JSON.parse(readFileSync(file, "utf8"));
      if (args[0] === "-D") return `${file}:\n${metadata.id || ""}\n`;
      if (args[0] === "-l") return metadata.rpaths.map((item) => `cmd LC_RPATH\ncmdsize 48\npath ${item} (offset 12)\n`).join("");
      return `${file}:\n${[metadata.id, ...metadata.dependencies].filter(Boolean).map((item) => `\t${item} (compatibility version 1.0.0, current version 1.0.0)\n`).join("")}`;
    }
    if (command === "install_name_tool") {
      const file = args.at(-1);
      const metadata = JSON.parse(readFileSync(file, "utf8"));
      for (let index = 0; index < args.length - 1; index++) {
        const option = args[index];
        const value = args[++index];
        if (option === "-change") {
          const replacement = args[++index];
          metadata.dependencies = metadata.dependencies.map((item) => item === value ? replacement : item);
        } else if (option === "-id") metadata.id = value;
        else if (option === "-delete_rpath") metadata.rpaths = metadata.rpaths.filter((item) => item !== value);
        else assert.fail(`Unexpected install_name_tool option: ${option}`);
      }
      writeFileSync(file, JSON.stringify(metadata));
    }
    return "";
  };
  return { folder, source, runtime, calls, binary, run };
}

test("bundles transitive and cyclic dependencies, preserves system loads and validates every executable", async (t) => {
  const f = await fixture(t);
  const libA = path.join(f.source, "lib/a.dylib");
  const libB = path.join(f.source, "lib/b.dylib");
  await f.binary("lib/a.dylib", { id: "@rpath/a.dylib", dependencies: ["@loader_path/b.dylib", "/usr/lib/libSystem.B.dylib"] });
  await f.binary("lib/b.dylib", { id: libB, dependencies: [libA] });
  const ffmpeg = await f.binary("bin/ffmpeg", { rpaths: ["@executable_path/../lib"], dependencies: ["@rpath/a.dylib"] });
  const ffprobe = await f.binary("bin/ffprobe", { dependencies: [libA] });
  const result = await bundleMacRuntime([{ name: "ffmpeg", source: ffmpeg }, { name: "ffprobe", source: ffprobe }], f.runtime, { run: f.run });
  assert.equal(result.libraries, 2);
  assert.equal((await readdir(path.join(f.runtime, "lib"))).length, 2);
  const output = JSON.parse(await readFile(path.join(f.runtime, "ffmpeg"), "utf8"));
  assert.equal(output.rpaths.length, 0);
  assert.match(output.dependencies[0], /^@loader_path\/lib\/.*-a\.dylib$/);
  const library = JSON.parse(await readFile(path.resolve(f.runtime, output.dependencies[0].slice("@loader_path/".length)), "utf8"));
  assert.ok(library.dependencies.includes("/usr/lib/libSystem.B.dylib"));
  assert.equal(f.calls.filter((item) => item.command === "codesign").length, 4);
  assert.deepEqual(f.calls.filter((item) => item.command.startsWith(f.runtime)).map((item) => [path.basename(item.command), item.args]), [["ffmpeg", ["-version"]], ["ffprobe", ["-version"]]]);
  assert.deepEqual(JSON.parse(await readFile(ffmpeg, "utf8")).dependencies, ["@rpath/a.dylib"]);
});

test("keeps distinct libraries with identical filenames", async (t) => {
  const f = await fixture(t);
  const first = await f.binary("first/libcodec.dylib", {});
  const second = await f.binary("second/libcodec.dylib", {});
  const ffmpeg = await f.binary("ffmpeg", { dependencies: [first, second] });
  await bundleMacRuntime([{ name: "ffmpeg", source: ffmpeg }], f.runtime, { run: f.run });
  const output = JSON.parse(await readFile(path.join(f.runtime, "ffmpeg"), "utf8"));
  assert.equal(new Set(output.dependencies).size, 2);
  assert.equal((await readdir(path.join(f.runtime, "lib"))).length, 2);
});

test("fails the build if rewriting leaves any dependency on the build machine", async (t) => {
  const f = await fixture(t);
  const library = await f.binary("libcodec.dylib", {});
  const ffmpeg = await f.binary("ffmpeg", { dependencies: [library] });
  await assert.rejects(bundleMacRuntime([{ name: "ffmpeg", source: ffmpeg }], f.runtime, {
    run: (command, args) => command === "install_name_tool" ? "" : f.run(command, args),
  }), /Non-portable runtime dependency remains/);
  assert.equal(f.calls.filter((item) => item.command.startsWith(f.runtime)).length, 0);
});
