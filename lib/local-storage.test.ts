import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalStore, type LocalJob, type LocalSettings } from "./local-storage.ts";

test("persists settings and jobs in the app data directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "seven-media-store-"));
  const store = createLocalStore(root);
  const settings: LocalSettings = {
    outputDirectory: "/Users/test/SevenMediaStudio/Exports",
    conflictPolicy: "auto-rename",
  };
  const job: LocalJob = {
    id: "job-001",
    type: "compress",
    inputPath: "/Users/test/Videos/source.mov",
    outputPath: "/Users/test/SevenMediaStudio/Exports/source-compressed.mov",
    status: "pending",
    progress: 0,
    createdAt: "2026-08-21T00:00:00.000Z",
  };

  await store.saveSettings(settings);
  await store.saveJob(job);

  assert.deepEqual(await store.loadSettings(), settings);
  assert.deepEqual(await store.loadJobs(), [job]);
});

test("returns empty defaults when optional local files do not exist", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "seven-media-store-"));
  const store = createLocalStore(root);

  assert.deepEqual(await store.loadSettings(), {
    outputDirectory: null,
    conflictPolicy: "auto-rename",
  });
  assert.deepEqual(await store.loadJobs(), []);
});

test("writes JSON atomically without leaving a temporary settings file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "seven-media-store-"));
  const store = createLocalStore(root);

  await store.saveSettings({
    outputDirectory: null,
    conflictPolicy: "skip",
  });

  const raw = await readFile(path.join(root, "settings.json"), "utf8");
  assert.equal(JSON.parse(raw).conflictPolicy, "skip");
  await assert.rejects(readFile(path.join(root, "settings.json.tmp"), "utf8"));
});
