import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Highlight } from "@/lib/highlights";
import { RECORDER_NOT_READY_MESSAGE } from "@/lib/preset";
import { createDemo, exportDirectory, newId, updateMeta, writeAnalysis } from "@/lib/store";
import { EXPORT_WARNING, estimateExportWaitSeconds } from "@/lib/export-progress";
import {
  exportIdle,
  INVALID_PERSPECTIVE_MESSAGE,
  listJobs,
  readPublicJob,
  requestExport,
  resetExportQueueForTests,
  setExportRuntime,
  toPublicJob,
  type CommandResult,
} from "@/lib/export-queue";

const highlight = (id: string, startTick: number): Highlight => ({
  id,
  kind: "triple",
  roundNumber: 1,
  steamId: "76561198000000001",
  playerName: "选手",
  side: 2,
  teamName: "A",
  startTick,
  endTick: startTick + 400,
  durationSeconds: 6,
  score: 64,
  tags: [],
  kills: [],
});

const analyzedSuccessfully: CommandResult = {
  code: 0,
  stdout: JSON.stringify({ analyzed: [{ demoPath: "match.dem" }], skipped: [], failed: [] }),
  stderr: "",
};

async function readyDemo(ids: string[]): Promise<string> {
  const meta = await createDemo("match.dem", Buffer.from("demo"));
  await updateMeta(meta.id, { status: "ready", mapName: "de_dust2" });
  await writeAnalysis(meta.id, { mapName: "de_dust2", tickrate: 64 }, ids.map((id, index) => highlight(id, 1000 + index * 500)));
  return meta.id;
}

describe("export queue", () => {
  let previousDataDir: string | undefined;

  afterEach(async () => {
    await exportIdle();
    resetExportQueueForTests();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  });

  it("refuses export when csdm is missing and does not queue a job", async () => {
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "chaipian-missing-"));
    resetExportQueueForTests();
    setExportRuntime({
      findCsdm: async () => null,
      run: async () => {
        throw new Error("should not run");
      },
    });
    const demoId = await readyDemo(["clip-a"]);
    const result = await requestExport(demoId, ["clip-a"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("recorder_not_ready");
    expect(result.status).toBe(409);
    expect(result.message).toBe(RECORDER_NOT_READY_MESSAGE);
    expect(result.message).toContain("录像机未就绪");
    expect(await listJobs()).toEqual([]);
  });

  it("runs one csdm video job at a time and writes the fixed preset", async () => {
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "chaipian-queue-"));
    resetExportQueueForTests();
    let active = 0;
    let maxActive = 0;
    const configs: Array<{ width: number; framerate: number; concatenateSequences: boolean; keepRawFilesOnGameError?: boolean; perspective?: string; sequences: Array<{ showOnlyDeathNotices: boolean; showXRay?: boolean }> }> = [];
    const run = async (_binary: string, args: string[]): Promise<CommandResult> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (args[0] === "video") {
        const configPath = args[args.indexOf("--config-file") + 1];
        const config = JSON.parse(await readFile(configPath!, "utf8"));
        configs.push(config);
        await writeFile(path.join(config.outputFolderPath, "highlights.mp4"), "mp4");
      }
      active -= 1;
      return args[0] === "analyze" ? analyzedSuccessfully : { code: 0, stdout: "", stderr: "" };
    };
    setExportRuntime({ findCsdm: async () => "/usr/local/bin/csdm", run });

    const first = await readyDemo(["a", "b"]);
    const second = await readyDemo(["c"]);
    const queuedA = await requestExport(first, ["b", "a"]);
    const queuedB = await requestExport(second, ["c"]);
    expect(queuedA.ok && queuedB.ok).toBe(true);
    await exportIdle();

    expect(maxActive).toBe(1);
    expect(configs).toHaveLength(2);
    expect(configs[0]?.width).toBe(1280);
    expect(configs[0]?.framerate).toBe(30);
    expect(configs[0]?.concatenateSequences).toBe(true);
    expect(configs[0]?.keepRawFilesOnGameError).toBe(true);
    expect(configs[0]?.perspective).toBe("player");
    expect(configs[0]?.sequences.every((sequence) => sequence.showOnlyDeathNotices)).toBe(true);
    expect(configs[0]?.sequences.every((sequence) => sequence.showXRay === false)).toBe(true);
    expect(configs[0]?.sequences).toHaveLength(2);
    const jobs = await listJobs();
    expect(jobs.map((job) => job.status).sort()).toEqual(["done", "done"]);
    expect(jobs.every((job) => job.options.showXRay === false && job.options.perspective === "player")).toBe(true);
  });

  it("rejects an invalid perspective before queueing and writes accepted options into video.json", async () => {
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "chaipian-options-"));
    resetExportQueueForTests();
    const configs: Array<{
      perspective: string;
      sequences: Array<{ showXRay: boolean; playerCameras: Array<{ playerSteamId: string; playerName: string; tick: number }> }>;
    }> = [];
    const run = async (_binary: string, args: string[]): Promise<CommandResult> => {
      if (args[0] === "analyze") {
        expect(args.slice(2)).toEqual(["--json", "--source", "5eplay"]);
        return analyzedSuccessfully;
      }
      if (args[0] === "video") {
        const configPath = args[args.indexOf("--config-file") + 1];
        const config = JSON.parse(await readFile(configPath!, "utf8"));
        configs.push(config);
        await writeFile(path.join(config.outputFolderPath, "highlights.mp4"), "mp4");
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    setExportRuntime({ findCsdm: async () => "/usr/local/bin/csdm", run });

    const meta = await createDemo("match.dem", Buffer.from("demo"));
    await updateMeta(meta.id, { status: "ready", mapName: "de_dust2", source: "5eplay" });
    const clip = highlight("clip-a", 1000);
    clip.kills = [
      { tick: 1200, weaponName: "AK-47", victimName: "对手", victimSteamId: "76561198000000099", isHeadshot: true },
    ];
    await writeAnalysis(meta.id, { mapName: "de_dust2", tickrate: 64 }, [clip, highlight("clip-b", 2000)]);

    const invalid = await requestExport(meta.id, ["clip-a"], { showXRay: true, perspective: "free" });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.status).toBe(400);
    expect(invalid.error).toBe("invalid_perspective");
    expect(invalid.message).toBe(INVALID_PERSPECTIVE_MESSAGE);
    expect(await listJobs()).toEqual([]);

    const queued = await requestExport(meta.id, ["clip-b", "clip-a"], { showXRay: true, perspective: "enemy" });
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.job.options).toEqual({ showXRay: true, perspective: "enemy" });
    expect(queued.job.clipDurationSeconds).toBe(18);
    expect(queued.job.estimatedWaitSeconds).toBe(estimateExportWaitSeconds(18));
    await exportIdle();

    expect(configs).toHaveLength(1);
    expect(configs[0]?.perspective).toBe("enemy");
    expect(configs[0]?.sequences.map((sequence) => sequence.playerCameras[0]?.playerSteamId)).toEqual([
      clip.steamId, "76561198000000099", clip.steamId,
    ]);
    expect(configs[0]?.sequences.every((sequence) => sequence.showXRay)).toBe(true);
    const jobs = await listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("done");
    expect(jobs[0]?.options).toEqual({ showXRay: true, perspective: "enemy" });
  });

  it("does not start recording when CSDM exits with code zero but reports a failed analysis", async () => {
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "chaipian-analysis-failed-"));
    const demoId = await readyDemo(["a"]);
    const calls: string[] = [];
    setExportRuntime({
      findCsdm: async () => "/usr/local/bin/csdm",
      run: async (_binary, args) => {
        calls.push(args[0]);
        return {
          code: 0,
          stdout: JSON.stringify({
            analyzed: [], skipped: [], failed: [{ error: "The demo source could not be detected" }],
          }),
          stderr: "",
        };
      },
    });
    expect((await requestExport(demoId, ["a"])).ok).toBe(true);
    await exportIdle();

    expect(calls).toEqual(["analyze"]);
    expect((await listJobs())[0]).toMatchObject({
      status: "failed", stage: "error", outputPath: null,
      error: expect.stringContaining("录像机分析失败"),
    });
  });

  it("exposes a wait estimate longer than clip duration and maps verbose output to stages", async () => {
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "chaipian-stages-"));
    resetExportQueueForTests();
    const run = async (_binary: string, args: string[], hooks?: { onOutput?: (chunk: string) => void }): Promise<CommandResult> => {
      if (args[0] === "analyze") {
        return { code: 0, stdout: JSON.stringify({ analyzed: [], skipped: [{ demoPath: "match.dem" }], failed: [] }), stderr: "" };
      }
      if (args[0] === "video") {
        expect(args).toContain("--verbose");
        hooks?.onOutput?.("Waiting for the video generation...");
        hooks?.onOutput?.("\nRecord");
        hooks?.onOutput?.("ing 2 sequences...\n");
        await expect.poll(async () => (await listJobs())[0]?.stage).toBe("recording");
        hooks?.onOutput?.("Converting sequence #1 (1/2)...\n");
        await expect.poll(async () => (await listJobs())[0]?.stage).toBe("encoding");
        const configPath = args[args.indexOf("--config-file") + 1];
        const config = JSON.parse(await readFile(configPath!, "utf8"));
        await writeFile(path.join(config.outputFolderPath, "highlights.mp4"), "mp4");
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    setExportRuntime({ findCsdm: async () => "/usr/local/bin/csdm", run });

    const demoId = await readyDemo(["a", "b"]);
    const queued = await requestExport(demoId, ["a", "b"]);
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    const published = toPublicJob(queued.job);
    const clipSeconds = 6 + 6;
    expect(published.stage).toBe("queued");
    expect(published.stageLabel).toBe("排队等待中");
    expect(published.clipDurationSeconds).toBe(clipSeconds);
    expect(published.estimatedWaitSeconds).toBe(estimateExportWaitSeconds(clipSeconds));
    expect(published.estimatedWaitSeconds).toBeGreaterThan(clipSeconds);
    expect(published.estimatedWaitLabel).toContain("通常比片段时长更长");
    expect(published.warning).toBe(EXPORT_WARNING);
    await exportIdle();
    const jobs = await listJobs();
    expect(jobs).toHaveLength(1);
    expect(toPublicJob(jobs[0]!).stage).toBe("done");
    expect(toPublicJob(jobs[0]!).stageLabel).toBe("导出完成");
    expect(toPublicJob(jobs[0]!).observedStages).toEqual(["queued", "preparing", "starting_game", "recording", "encoding", "done"]);
    expect(toPublicJob(jobs[0]!).startedAt).toBeTruthy();
    expect(toPublicJob(jobs[0]!)).not.toHaveProperty("outputPath");
    expect(jobs[0]?.status).toBe("done");
  });

  it("returns persisted jobs left by a previous process as interrupted", async () => {
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "chaipian-interrupted-"));
    resetExportQueueForTests();
    const demoId = await readyDemo(["a"]);
    for (const status of ["queued", "recording"]) {
      const id = newId();
      await mkdir(exportDirectory(id), { recursive: true });
      await writeFile(path.join(exportDirectory(id), "job.json"), JSON.stringify({
        id, demoId, status, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }));
      expect(await readPublicJob(id)).toMatchObject({ status: "failed", stage: "error", error: expect.stringContaining("中断") });
    }
  });
});
