import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analysisIdle, diffHighlightIds, requestReanalyze, resetAnalysisForTests, setAnalysisRuntime } from "@/lib/analysis";
import { DEMO_FILE_MISSING_MESSAGE, createDemo, readHighlights, updateMeta, writeAnalysis } from "@/lib/store";
import type { Highlight } from "@/lib/highlights";

function clip(id: string): Highlight {
  return {
    id,
    kind: "triple",
    roundNumber: 1,
    steamId: "76561198000000001",
    playerName: "选手",
    side: 2,
    teamName: "A",
    startTick: 1000,
    endTick: 1600,
    durationSeconds: 10,
    score: 64,
    tags: [],
    kills: [{ tick: 1200, weaponName: "AK-47", victimName: "对手", victimSteamId: "76561198000000099", isHeadshot: true }],
  };
}

describe("reanalyze", () => {
  let previousDataDir: string | undefined;

  afterEach(async () => {
    await analysisIdle();
    resetAnalysisForTests();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  });

  it("keeps previous highlights while reanalyze is running and does not clear them first", async () => {
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "chaipian-reanalyze-"));
    const meta = await createDemo("match.dem", Buffer.from("demo-bytes"));
    await updateMeta(meta.id, { status: "ready", mapName: "de_cache" });
    const existing = clip("triple:76561198000000001:1:1200");
    await writeAnalysis(meta.id, { mapName: "de_cache", tickrate: 64 }, [existing]);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setAnalysisRuntime({
      analyze: async (_demoPath, outputFolder) => {
        await gate;
        await mkdir(outputFolder, { recursive: true });
        const jsonPath = path.join(outputFolder, "match.json");
        await writeFile(jsonPath, JSON.stringify({ mapName: "de_cache", tickrate: 64 }));
        return { jsonPath, log: "" };
      },
    });

    const result = await requestReanalyze(meta.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.inProgress).toBe(true);
    expect(result.report.highlightsPreserved).toBe(true);
    expect(result.report.message).toContain("已勾选的片段编号会尽量保持不变");
    expect(await readHighlights(meta.id)).toEqual([existing]);
    release();
    await analysisIdle();
    expect((await readHighlights(meta.id)).length).toBeGreaterThanOrEqual(0);
  });

  it("explains in human language when the .dem is gone", async () => {
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "chaipian-missing-dem-"));
    const meta = await createDemo("match.dem", Buffer.from("demo-bytes"));
    await updateMeta(meta.id, { status: "ready", storedName: "gone.dem", mapName: "de_cache" });
    const result = await requestReanalyze(meta.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe("demo_file_missing");
    expect(result.message).toBe(DEMO_FILE_MISSING_MESSAGE);
    expect(result.message).not.toMatch(/storedName|\.dem was deleted|ENOENT/i);
  });

  it("describes dropped ids in human language when they change", () => {
    const diff = diffHighlightIds(["a", "b"], ["a", "c"]);
    expect(diff.highlightIdsChanged).toBe(true);
    expect(diff.droppedHighlightIds).toEqual(["b"]);
    expect(diff.message).toBe("重新分析后，有些片段编号有变化，请再确认一次勾选。");
  });
});
