import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { JobStatus, MediaJob, OperationType } from "./media/types";

export type ConflictPolicy = "skip" | "replace" | "auto-rename";

export type LocalSettings = {
  outputDirectory: string | null;
  conflictPolicy: ConflictPolicy;
};

export type LocalJobStatus = JobStatus;
export type LocalJob = MediaJob;
export type LocalOperationType = OperationType;

const DEFAULT_SETTINGS: LocalSettings = {
  outputDirectory: null,
  conflictPolicy: "auto-rename",
};

type LocalStore = {
  loadSettings(): Promise<LocalSettings>;
  saveSettings(settings: LocalSettings): Promise<void>;
  loadJobs(): Promise<LocalJob[]>;
  saveJob(job: LocalJob): Promise<void>;
};

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(root: string, fileName: string, value: unknown) {
  await mkdir(root, { recursive: true });
  const destination = path.join(root, fileName);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function createLocalStore(root: string): LocalStore {
  const settingsFile = path.join(root, "settings.json");
  const jobsFile = path.join(root, "jobs.json");

  return {
    async loadSettings() {
      return readJson(settingsFile, DEFAULT_SETTINGS);
    },

    async saveSettings(settings) {
      await writeJsonAtomic(root, "settings.json", settings);
    },

    async loadJobs() {
      return readJson<LocalJob[]>(jobsFile, []);
    },

    async saveJob(job) {
      const jobs = await readJson<LocalJob[]>(jobsFile, []);
      const index = jobs.findIndex((current) => current.id === job.id);
      if (index === -1) jobs.push(job);
      else jobs[index] = job;
      await writeJsonAtomic(root, "jobs.json", jobs);
    },
  };
}
