import { describe, expect, it } from "vitest";
import {
  EXPORT_WARNING,
  estimateExportWaitSeconds,
  estimateRemaining,
  formatEstimatedWait,
  inferExportStage,
  stageFromLegacyStatus,
  type StageTimes,
} from "@/lib/export-progress";

describe("export wait and stages", () => {
  it("estimates a wait longer than the sum of clip durations", () => {
    const clips = 40;
    const estimate = estimateExportWaitSeconds(clips);
    expect(estimate).toBeGreaterThan(clips);
    expect(estimate).toBe(20 + 75 + 40 + Math.max(25, Math.round(40 * 0.7)));
    expect(formatEstimatedWait(estimate)).toContain("通常比片段时长更长");
    expect(EXPORT_WARNING).toContain("不要操作游戏");
    expect(EXPORT_WARNING).toContain("比片段时长更长");
  });

  it("maps csdm --verbose lines to recording and encoding stages", () => {
    expect(inferExportStage("Waiting for the video generation...", "queued")).toBe("starting_game");
    expect(inferExportStage("Recording 3 sequences...", "starting_game")).toBe("recording");
    expect(inferExportStage("WS:: game process socket connected", "starting_game")).toBe("recording");
    expect(inferExportStage("WS:: game process socket disconnected", "starting_game")).toBe("starting_game");
    expect(inferExportStage("Converting sequence #1 (1/3)...", "recording")).toBe("encoding");
    expect(inferExportStage("Concatenating sequences...", "recording")).toBe("encoding");
    expect(inferExportStage("Recording sequence #2...", "encoding")).toBe("encoding");
    expect(stageFromLegacyStatus("failed")).toBe("error");
    expect(stageFromLegacyStatus("done")).toBe("done");
  });

  it("uses a rough interval at cold start and signals an overrun", () => {
    const started = new Date(0).toISOString();
    expect(estimateRemaining("queued", started, 40, [], 0)).toBeNull();
    expect(estimateRemaining("preparing", started, 40, [], 0)).toEqual({
      source: "rough", minSeconds: 122, maxSeconds: 245,
    });
    expect(estimateRemaining("encoding", started, 40, [], 45000)).toEqual({
      source: "rough", minSeconds: 0, maxSeconds: 0,
    });
  });

  it("calibrates with three complete recordings and normalizes by clip length", () => {
    const at = (seconds: number) => new Date(seconds * 1000).toISOString();
    const history = [10, 20, 30].map((seconds) => ({
      clipDurationSeconds: 20,
      stageTimes: {
        preparing: at(0), starting_game: at(5), recording: at(10), encoding: at(10 + seconds), done: at(20 + seconds),
      } satisfies StageTimes,
    }));
    expect(estimateRemaining("recording", at(0), 40, history.slice(0, 2), 0)?.source).toBe("rough");
    expect(estimateRemaining("recording", at(0), 40, [{ stageTimes: { done: at(1) } }, ...history], 5000)).toEqual({
      source: "history", minSeconds: 45, maxSeconds: 65,
    });
  });
});
