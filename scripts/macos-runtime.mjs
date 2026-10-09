import { chmod, copyFile, mkdir, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const runCommand = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export function parseDependencies(output) {
  return output.split("\n").slice(1).flatMap((line) => {
    const match = line.match(/^\s+(.+?) \(compatibility version /);
    return match ? [match[1]] : [];
  });
}

export function parseRpaths(output) {
  return [...output.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset \d+\)/g)].map((match) => match[1]);
}

export function isSystemDependency(dependency) {
  return dependency.startsWith("/System/Library/") || dependency.startsWith("/usr/lib/");
}

function expandLoaderPath(value, source, executable) {
  return value
    .replace(/^@loader_path(?=\/|$)/, path.dirname(source))
    .replace(/^@executable_path(?=\/|$)/, path.dirname(executable));
}

export function resolveDependency(dependency, { source, executable, rpaths }, exists = existsSync) {
  const candidates = dependency.startsWith("@rpath/")
    ? rpaths.map((rpath) => path.join(rpath, dependency.slice("@rpath/".length)))
    : [expandLoaderPath(dependency, source, executable)];
  const resolved = candidates.find((candidate) => path.isAbsolute(candidate) && exists(candidate));
  if (!resolved) {
    throw new Error(`Cannot bundle ${dependency}, required by ${source}. Install its dependencies before building. Searched: ${candidates.join(", ") || "no LC_RPATH entries"}`);
  }
  return resolved;
}

/** Copy the complete Mach-O dependency closure and make every non-system load relative. */
export async function bundleMacRuntime(entries, runtime, { run = runCommand } = {}) {
  const files = new Map();
  const libraryDir = path.join(runtime, "lib");
  await mkdir(libraryDir, { recursive: true });

  async function collect(source, destination, executable, inheritedRpaths = []) {
    const canonical = await realpath(source);
    if (files.has(canonical)) return files.get(canonical);
    const record = { source, destination, links: [] };
    // Register before following dependencies: dylibs can refer back to one another.
    files.set(canonical, record);
    await copyFile(source, destination);
    await chmod(destination, 0o755);
    const ownRpaths = parseRpaths(run("otool", ["-l", source]));
    const installId = run("otool", ["-D", source]).split("\n").slice(1).map((line) => line.trim()).find(Boolean);
    const rpaths = [...ownRpaths.map((item) => expandLoaderPath(item, source, executable)), ...inheritedRpaths];
    for (const dependency of parseDependencies(run("otool", ["-L", source]))) {
      if (dependency === installId) continue;
      if (isSystemDependency(dependency)) continue;
      const dependencySource = resolveDependency(dependency, { source, executable, rpaths });
      const dependencyCanonical = await realpath(dependencySource);
      if (dependencyCanonical === canonical) continue;
      const key = createHash("sha256").update(dependencyCanonical).digest("hex").slice(0, 12);
      const dependencyDestination = path.join(libraryDir, `${key}-${path.basename(dependencyCanonical)}`);
      const child = await collect(dependencySource, dependencyDestination, executable, rpaths);
      record.links.push({ original: dependency, destination: child.destination });
    }
    record.rpaths = ownRpaths;
    return record;
  }

  for (const { source, name } of entries) {
    await collect(source, path.join(runtime, name), source);
  }

  for (const record of files.values()) {
    const args = record.links.flatMap((link) => ["-change", link.original, `@loader_path/${path.relative(path.dirname(record.destination), link.destination)}`]);
    if (path.dirname(record.destination) === libraryDir) {
      args.push("-id", `@loader_path/${path.basename(record.destination)}`);
    }
    // All loads are explicit now; discard build-machine search paths as well.
    for (const rpath of record.rpaths) args.push("-delete_rpath", rpath);
    if (args.length) run("install_name_tool", [...args, record.destination]);
  }

  for (const record of files.values()) {
    for (const dependency of parseDependencies(run("otool", ["-L", record.destination]))) {
      if (isSystemDependency(dependency)) continue;
      if (!dependency.startsWith("@loader_path/")) {
        throw new Error(`Non-portable runtime dependency remains in ${record.destination}: ${dependency}`);
      }
      const resolved = path.resolve(path.dirname(record.destination), dependency.slice("@loader_path/".length));
      const relative = path.relative(runtime, resolved);
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative) || !existsSync(resolved)) {
        throw new Error(`Runtime dependency escapes the bundle or is missing: ${dependency} in ${record.destination}`);
      }
    }
    // install_name_tool invalidates Mach-O signatures, including arm64 ad-hoc signatures.
    run("codesign", ["--force", "--sign", "-", record.destination]);
  }

  for (const { name } of entries) {
    run(path.join(runtime, name), [name === "node" ? "--version" : "-version"]);
  }
  return { libraries: files.size - entries.length };
}
