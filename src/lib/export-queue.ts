import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { legacyExportOwnership, type ExportOwnership } from "@/lib/account-store";
import { buildVideoConfig, csdmProcess, findCsdm } from "@/lib/csdm";
import { csdmLogPath, watchCsdmRecording } from "@/lib/csdm-recording-log";
import { exportDurationSeconds, type ExportOptions } from "@/lib/export-options";
import {
  EXPORT_STAGE_LABELS,
  EXPORT_WARNING,
  estimateExportWaitSeconds,
  estimateRemaining,
  formatEstimatedWait,
  inferExportStage,
  stageFromLegacyStatus,
  type ExportStage,
  type StageTimes,
  type RemainingEstimate,
} from "@/lib/export-progress";
import type { Highlight } from "@/lib/highlights";
import { highlightVictimPerspectiveAvailable } from "@/lib/perspective";
import { RECORDER_NOT_READY_MESSAGE, RECORDING_PRESET } from "@/lib/preset";
import { demoFilePath, exportDirectory, exportsRoot, newId, readHighlights, readMeta } from "@/lib/store";

export type CommandResult = { code: number; stdout: string; stderr: string };

export type CommandHooks = { onOutput?: (chunk: string) => void };

export type ExportRuntime = {
  findCsdm: () => Promise<string | null>;
  run: (binary: string, args: string[], hooks?: CommandHooks) => Promise<CommandResult>;
  watchRecording?: typeof watchCsdmRecording;
};

export type ExportStatus = "queued" | "recording" | "done" | "failed";

export type ExportJob = {
  id: string;
  demoId: string;
  highlightIds: string[];
  status: ExportStatus;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  outputPath: string | null;
  outputName: string;
  preset: {
    width: 1280;
    height: 720;
    framerate: 30;
    showOnlyDeathNotices: true;
    concatenateSequences: true;
    oneAtATime: true;
  };
  options: ExportOptions;
  stage?: ExportStage;
  stageTimes?: StageTimes;
  clipDurationSeconds?: number;
  estimatedWaitSeconds?: number;
  ownership?: ExportOwnership;
};

export type PublicExportJob = Omit<ExportJob, "outputPath" | "stageTimes" | "ownership"> & {
  originalName: string | null;
  mapName: string | null;
  stage: ExportStage;
  stageLabel: string;
  clipDurationSeconds: number;
  estimatedWaitSeconds: number;
  estimatedWaitLabel: string;
  startedAt: string | null;
  stageStartedAt: string | null;
  observedStages: ExportStage[];
  estimatedRemaining: RemainingEstimate | null;
  warning: string;
};

export type ExportRequestResult =
  | { ok: true; job: ExportJob }
  | { ok: false; status: number; error: string; message: string };

type QueueState = {
  chain: Promise<void>;
  runtime: ExportRuntime | null;
  pending: Set<string>;
  startedAt: string;
};

const globalState = globalThis as typeof globalThis & { __chaipianExports?: QueueState };

function state(): QueueState {
  if (!globalState.__chaipianExports) {
    globalState.__chaipianExports = { chain: Promise.resolve(), runtime: null, pending: new Set(), startedAt: new Date().toISOString() };
  }
  return globalState.__chaipianExports;
}

export function setExportRuntime(runtime: ExportRuntime | null): void {
  state().runtime = runtime;
}

export function exportIdle(): Promise<void> {
  return state().chain;
}

export function resetExportQueueForTests(): void {
  const current = state();
  current.chain = Promise.resolve();
  current.runtime = null;
  current.pending.clear();
  current.startedAt = new Date().toISOString();
}

function runtime(): ExportRuntime {
  return state().runtime ?? defaultRuntime();
}

function defaultRuntime(): ExportRuntime {
  return { findCsdm: () => findCsdm(), run: runCommand, watchRecording: watchCsdmRecording };
}

export function runCommand(binary: string, args: string[], hooks?: CommandHooks): Promise<CommandResult> {
  return new Promise((resolve) => {
    const launch = csdmProcess(binary, args);
    const child = spawn(launch.command, launch.args, { windowsHide: true, shell: launch.shell, env: launch.env as NodeJS.ProcessEnv });
    let stdout = "";
    let stderr = "";
    const keep = (value: string) => (value.length > 8000 ? value.slice(-8000) : value);
    const take = (chunk: Buffer, dest: "stdout" | "stderr") => {
      const text = chunk.toString();
      if (dest === "stdout") stdout = keep(stdout + text);
      else stderr = keep(stderr + text);
      hooks?.onOutput?.(text);
    };
    child.stdout?.on("data", (chunk: Buffer) => take(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => take(chunk, "stderr"));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: keep(stderr + error.message) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function toPublicJob(job: ExportJob, history: ExportJob[] = [], now = Date.now()): PublicExportJob {
  const { stageTimes } = job;
  const stage = job.stage ?? stageFromLegacyStatus(job.status);
  const clipDurationSeconds = job.clipDurationSeconds ?? 0;
  const estimatedWaitSeconds = job.estimatedWaitSeconds ?? estimateExportWaitSeconds(clipDurationSeconds);
  const stageStartedAt = stageTimes?.[stage] ?? null;
  return {
    id: job.id,
    demoId: job.ownership?.entryId ?? job.demoId,
    originalName: job.ownership?.originalName ?? null,
    mapName: job.ownership?.mapName ?? null,
    highlightIds: job.highlightIds,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    outputName: job.outputName,
    preset: job.preset,
    options: job.options,
    stage,
    stageLabel: EXPORT_STAGE_LABELS[stage],
    clipDurationSeconds,
    estimatedWaitSeconds,
    estimatedWaitLabel: formatEstimatedWait(estimatedWaitSeconds),
    startedAt: stageTimes?.preparing ?? null,
    stageStartedAt,
    observedStages: Object.keys(stageTimes ?? {}) as ExportStage[],
    estimatedRemaining: estimateRemaining(stage, stageStartedAt, clipDurationSeconds, history, now),
    warning: EXPORT_WARNING,
  };
}

function ownedJob(job: ExportJob, ownerId: string): ExportJob | null {
  const ownership = job.ownership ?? legacyExportOwnership(job.id);
  return ownership?.ownerId === ownerId ? { ...job, ownership } : null;
}

export async function listPublicJobs(ownerId: string, demoId?: string): Promise<PublicExportJob[]> {
  const jobs = await listJobs();
  const history = completedHistory(jobs);
  const now = Date.now();
  const visible = jobs.flatMap((job) => ownedJob(job, ownerId) ?? []);
  return visible.filter((job) => !demoId || (job.ownership?.entryId ?? job.demoId) === demoId).map((job) => toPublicJob(job, history, now));
}

export async function readOwnedJob(id: string, ownerId: string): Promise<ExportJob | null> {
  const job = await readJob(id);
  return job ? ownedJob(job, ownerId) : null;
}

export async function readPublicJob(id: string, ownerId?: string): Promise<PublicExportJob | null> {
  const job = ownerId ? await readOwnedJob(id, ownerId) : await readJob(id);
  if (!job) return null;
  const history = job.status === "recording" ? completedHistory(await listJobs()) : [];
  return toPublicJob(job, history);
}

function completedHistory(jobs: ExportJob[]): ExportJob[] {
  return jobs.filter((job) => job.status === "done").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export { EXPORT_WARNING };

export const INVALID_PERSPECTIVE_MESSAGE = "视角只能是 player 或 enemy。";

export function normalizeExportOptions(
  input?: unknown,
): { ok: true; options: ExportOptions } | { ok: false; status: number; error: string; message: string } {
  if (input === undefined || input === null) {
    return { ok: true, options: { showXRay: false, perspective: "player" } };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, error: "invalid_options", message: "导出选项格式不对。" };
  }
  const raw = input as { showXRay?: unknown; perspective?: unknown };
  if (raw.perspective !== undefined && raw.perspective !== "player" && raw.perspective !== "enemy") {
    return { ok: false, status: 400, error: "invalid_perspective", message: INVALID_PERSPECTIVE_MESSAGE };
  }
  return {
    ok: true,
    options: {
      showXRay: raw.showXRay === true,
      perspective: raw.perspective === "enemy" ? "enemy" : "player",
    },
  };
}

export async function requestExport(demoId: string, highlightIds: string[], options?: unknown, owner?: Pick<ExportOwnership, "ownerId" | "entryId">): Promise<ExportRequestResult> {
  const parsed = normalizeExportOptions(options);
  if (!parsed.ok) return parsed;
  const meta = await readMeta(demoId);
  if (!meta) return { ok: false, status: 404, error: "not_found", message: "找不到这场录像。" };
  if (meta.status !== "ready") {
    return { ok: false, status: 409, error: "not_ready", message: "这场录像还没解析完，先等列表出来再导出。" };
  }
  const unique = [...new Set(highlightIds)];
  if (unique.length === 0) {
    return { ok: false, status: 400, error: "empty", message: "先勾选要录的片段。" };
  }
  const available = await readHighlights(demoId);
  const selected = unique
    .map((id) => available.find((item) => item.id === id))
    .filter((item): item is Highlight => Boolean(item));
  if (selected.length !== unique.length) {
    return { ok: false, status: 400, error: "unknown_highlight", message: "有片段不在这场的高光列表里。" };
  }

  const binary = await runtime().findCsdm();
  if (!binary) {
    return { ok: false, status: 409, error: "recorder_not_ready", message: RECORDER_NOT_READY_MESSAGE };
  }

  const now = new Date().toISOString();
  const clipDurationSeconds = exportDurationSeconds(selected, parsed.options.perspective, highlightVictimPerspectiveAvailable);
  const estimatedWaitSeconds = estimateExportWaitSeconds(clipDurationSeconds);
  const job: ExportJob = {
    id: newId(),
    demoId,
    ownership: owner && { ...owner, originalName: meta.originalName, mapName: meta.mapName },
    highlightIds: selected.map((item) => item.id),
    status: "queued",
    stage: "queued",
    stageTimes: { queued: now },
    clipDurationSeconds,
    estimatedWaitSeconds,
    createdAt: now,
    updatedAt: now,
    error: null,
    outputPath: null,
    outputName: `拆片-${meta.mapName ?? "match"}.mp4`,
    preset: {
      width: RECORDING_PRESET.width,
      height: RECORDING_PRESET.height,
      framerate: RECORDING_PRESET.framerate,
      showOnlyDeathNotices: true,
      concatenateSequences: true,
      oneAtATime: true,
    },
    options: parsed.options,
  };
  const current = state();
  current.pending.add(job.id);
  try {
    await writeJob(job);
  } catch (error) {
    current.pending.delete(job.id);
    throw error;
  }
  current.chain = current.chain
    .then(() => processJob(job.id, binary, selected, meta.source))
    .catch(() => undefined)
    .finally(() => { current.pending.delete(job.id); });
  return { ok: true, job };
}

async function processJob(id: string, binary: string, highlights: Highlight[], source: string | null): Promise<void> {
  const job = await readJob(id);
  if (!job) return;
  const started = Date.now();
  const outDir = path.join(exportDirectory(id), "out");
  try {
    await patchJob(id, { status: "recording", stage: "preparing" });
    await mkdir(outDir, { recursive: true });
    const demoPath = await demoFilePath(job.demoId);
    const analyzeArgs = ["analyze", demoPath, "--json"];
    if (source === "5eplay") analyzeArgs.push("--source", source);
    requireCsdmAnalysis(await runtime().run(binary, analyzeArgs));
    const config = buildVideoConfig({
      demoPath,
      outputFolderPath: outDir,
      outputFileName: job.outputName,
      highlights,
      options: job.options,
    });
    const configPath = path.join(exportDirectory(id), "video.json");
    await writeFile(configPath, JSON.stringify(config, null, 2));
    await patchJob(id, { status: "recording", stage: "starting_game" });
    let stageUpdates = Promise.resolve();
    let stage: ExportStage = "starting_game";
    let tail = "";
    const recorder = runtime();
    const stopWatching = await recorder.watchRecording?.(outDir, (timestamp) => move("recording", timestamp));
    let recorded: CommandResult;
    try {
      recorded = await recorder.run(binary, ["video", "--config-file", configPath, "--verbose"], {
        onOutput: (chunk) => {
          const lines = (tail + chunk).split(/[\r\n]+/);
          tail = lines.pop()?.slice(-512) ?? "";
          for (const line of lines) move(inferExportStage(line, stage));
          move(inferExportStage(tail, stage));
        },
      });
    } finally {
      await stopWatching?.();
      await stageUpdates;
    }
    const outputPath = await newestMp4(outDir, started - 5000);
    if (!outputPath) {
      throw new Error(await describeMissingMp4Error(recorded));
    }
    await patchJob(id, { status: "done", stage: "done", error: null, outputPath });

    function move(next: ExportStage, observedAt = new Date().toISOString()) {
      if (next === stage || (stage === "encoding" && next === "recording")) return;
      stage = next;
      stageUpdates = stageUpdates.then(async () => {
        await patchJob(id, { status: "recording", stage: next }, observedAt);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出失败。";
    await patchJob(id, { status: "failed", stage: "error", error: message.slice(0, 800), outputPath: null });
  }
}

function requireCsdmAnalysis(result: CommandResult): void {
  if (result.code !== 0) {
    throw new Error(cleanOutput(redactSecrets(result.stderr || result.stdout)) || "录像机分析失败。");
  }

  let report: { analyzed: unknown[]; skipped: unknown[]; failed: Array<{ error: string }> };
  try {
    report = JSON.parse(result.stdout) as typeof report;
  } catch {
    throw new Error("录像机没有返回有效的分析结果，无法开始录制。");
  }
  if (!Array.isArray(report?.analyzed) || !Array.isArray(report.skipped) || !Array.isArray(report.failed)) {
    throw new Error("录像机没有返回有效的分析结果，无法开始录制。");
  }

  // CSDM can exit with code zero while all of its requested analyses failed.
  const failure = report.failed[0];
  if (failure) throw new Error(`录像机分析失败。${cleanOutput(redactSecrets(failure.error))}`);
  if (report.analyzed.length === 0 && report.skipped.length === 0) {
    throw new Error("录像机没有完成这场录像的分析，无法开始录制。");
  }
}

async function patchJob(id: string, patch: Partial<ExportJob>, observedAt = new Date().toISOString()): Promise<ExportJob | null> {
  const current = await readJob(id);
  if (!current) return null;
  const next: ExportJob = {
    ...current,
    ...patch,
    id: current.id,
    updatedAt: observedAt,
    stageTimes: patch.stage ? { ...current.stageTimes, [patch.stage]: observedAt } : current.stageTimes,
  };
  await writeJob(next);
  return next;
}

export async function readJob(id: string): Promise<ExportJob | null> {
  try {
    const job = JSON.parse(await readFile(path.join(exportDirectory(id), "job.json"), "utf8")) as ExportJob;
    const current = state();
    if ((job.status === "queued" || job.status === "recording") && !current.pending.has(id)) {
      const interruptedAt = current.startedAt > job.updatedAt ? current.startedAt : job.updatedAt;
      return {
        ...job,
        status: "failed",
        stage: "error",
        updatedAt: interruptedAt,
        stageTimes: { ...job.stageTimes, error: interruptedAt },
        error: "服务重启，导出已中断。可以重新导出。",
      };
    }
    return job;
  } catch {
    return null;
  }
}

export async function listJobs(demoId?: string): Promise<ExportJob[]> {
  let names: string[];
  try {
    names = await readdir(exportsRoot());
  } catch {
    return [];
  }
  const jobs: ExportJob[] = [];
  for (const name of names) {
    try {
      const job = await readJob(name);
      if (job && (!demoId || job.demoId === demoId)) jobs.push(job);
    } catch {
      // Skip folders that are not export jobs.
    }
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return jobs;
}

async function writeJob(job: ExportJob): Promise<void> {
  const dir = exportDirectory(job.id);
  await mkdir(dir, { recursive: true });
  const temporary = path.join(dir, "job.tmp");
  await writeFile(temporary, JSON.stringify(job, null, 2));
  await rename(temporary, path.join(dir, "job.json"));
}

async function newestMp4(dir: string, sinceMs: number): Promise<string | null> {
  const found: { file: string | null; mtime: number } = { file: null, mtime: 0 };
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.toLowerCase().endsWith(".mp4")) {
        const info = await stat(full);
        if (info.mtimeMs >= sinceMs && (found.file === null || info.mtimeMs >= found.mtime)) {
          found.file = full;
          found.mtime = info.mtimeMs;
        }
      }
    }
  }
  await walk(dir);
  return found.file;
}


function redactSecrets(text: string): string {
  return text
    .replace(/([?&]key=)[A-Za-z0-9]+/gi, "$1REDACTED")
    .replace(/(steam[_ ]?api[_ ]?key\s*[:=]\s*)(\S+)/gi, "$1REDACTED");
}

export function extractGameExitCode(text: string): string | null {
  const match = text.match(/Game process exited with code\s+(-?\d+)/i);
  return match?.[1] ?? null;
}

export async function describeMissingMp4Error(recorded: CommandResult): Promise<string> {
  const combined = redactSecrets(`${recorded.stdout}\n${recorded.stderr}`);
  let exitCode = extractGameExitCode(combined);
  if (!exitCode) {
    const logPath = csdmLogPath();
    try {
      exitCode = extractGameExitCode(redactSecrets(await readFile(logPath, "utf8")));
    } catch {
      // The official log is only present after a real csdm video run.
    }
  }
  const fromCli = cleanOutput(combined);
  const parts: string[] = [];
  if (recorded.code !== 0 && fromCli) {
    parts.push(fromCli);
  } else if (recorded.code !== 0) {
    parts.push("csdm video 失败。");
  } else {
    parts.push("csdm 已结束，但没有找到合成后的 MP4。");
  }
  if (exitCode) {
    const hex = Number(exitCode) >>> 0;
    const suffix = hex === 0xc0000409 ? "（0xC0000409）" : hex > 255 ? `（0x${hex.toString(16).toUpperCase()}）` : "";
    parts.push(`CS2 退出码 ${exitCode}${suffix}。`);
  }
  return parts.join(" ").slice(0, 800);
}

function cleanOutput(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}
