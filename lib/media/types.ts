export type MediaKind = "video" | "image" | "audio";

export type OperationType = "compress" | "convert" | "resize" | "trim" | "merge" | "export";

export type JobStatus = "pending" | "analyzing" | "processing" | "completed" | "failed" | "cancelled" | "interrupted";

export type OperationSettings = Record<string, unknown>;

export type MediaJob = {
  id: string;
  type: OperationType;
  inputPath: string;
  outputPath: string;
  status: JobStatus;
  progress: number;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  settings?: OperationSettings;
};
