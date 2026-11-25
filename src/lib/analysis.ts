import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { runAnalyzer } from "@/lib/analyzer";
import { clearDemoProgress, setDemoProgress } from "@/lib/demo-progress";
import { sourceHint } from "@/lib/demo-source";
import { detectHighlights, type Highlight } from "@/lib/highlights";
import { durationSeconds, parseMatchJson, tickrateOf, trimMatch } from "@/lib/match";
import {
  DEMO_FILE_MISSING_MESSAGE,
  demoDirectory,
  demoFileExists,
  demoFilePath,
  readHighlights,
  readMeta,
  updateMeta,
  writeAnalysis,
  type DemoMeta,
} from "@/lib/store";

export type ReanalyzeReport = {
  inProgress: boolean;
  highlightsPreserved: boolean;
  highlightIdsChanged: boolean;
  droppedHighlightIds: string[];
  message: string | null;
};

export type ReanalyzeResult =
  | { ok: true; demo: DemoMeta; report: ReanalyzeReport }
  | { ok: false; status: number; error: string; message: string };

type AnalysisRuntime = {
  analyze: typeof runAnalyzer;
};

type AnalysisState = {
  running: Set<string>;
  reports: Map<string, ReanalyzeReport>;
  previousIds: Map<string, string[]>;
  runtime: AnalysisRuntime | null;
};

const globalState = globalThis as typeof globalThis & { __chaipianAnalysisState?: AnalysisState };

function state(): AnalysisState {
  if (!globalState.__chaipianAnalysisState) {
    globalState.__chaipianAnalysisState = {
      running: new Set(),
      reports: new Map(),
      previousIds: new Map(),
      runtime: null,
    };
  }
  return globalState.__chaipianAnalysisState;
}

export function analysisIsRunning(id: string): boolean {
  return state().running.has(id);
}

export function setAnalysisRuntime(runtime: AnalysisRuntime | null): void {
  state().runtime = runtime;
}

export function resetAnalysisForTests(): void {
  const current = state();
  current.running.clear();
  current.reports.clear();
  current.previousIds.clear();
  current.runtime = null;
}

export function getReanalyzeReport(id: string): ReanalyzeReport | null {
  return state().reports.get(id) ?? null;
}

export function emptyReanalyzeReport(): ReanalyzeReport {
  return {
    inProgress: false,
    highlightsPreserved: true,
    highlightIdsChanged: false,
    droppedHighlightIds: [],
    message: null,
  };
}

export function diffHighlightIds(previousIds: string[], nextIds: string[]): Pick<ReanalyzeReport, "highlightIdsChanged" | "droppedHighlightIds" | "message"> {
  const next = new Set(nextIds);
  const droppedHighlightIds = previousIds.filter((id) => !next.has(id));
  const highlightIdsChanged = droppedHighlightIds.length > 0;
  return {
    highlightIdsChanged,
    droppedHighlightIds,
    message: highlightIdsChanged
      ? "重新分析后，有些片段编号有变化，请再确认一次勾选。"
      : "重新分析完成，已勾选的片段编号保持不变。",
  };
}

export function startAnalysis(id: string): void {
  const jobs = state().running;
  if (jobs.has(id)) return;
  jobs.add(id);
  void execute(id).finally(() => jobs.delete(id));
}

export async function analysisIdle(): Promise<void> {
  while (state().running.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function requestReanalyze(id: string): Promise<ReanalyzeResult> {
  let demo: DemoMeta | null;
  try {
    demo = await readMeta(id);
  } catch {
    return { ok: false, status: 404, error: "not_found", message: "找不到这场录像。" };
  }
  if (!demo) return { ok: false, status: 404, error: "not_found", message: "找不到这场录像。" };
  if (demo.status === "downloading" || demo.status === "extracting") {
    return { ok: false, status: 409, error: "busy", message: "正在导入录像，请等下载和解压完成。" };
  }
  if (!(await demoFileExists(id))) {
    return { ok: false, status: 409, error: "demo_file_missing", message: DEMO_FILE_MISSING_MESSAGE };
  }
  if (analysisIsRunning(id)) {
    const existing = state().reports.get(id);
    const highlightsPreserved = (await readHighlights(id)).length > 0;
    return {
      ok: true,
      demo,
      report: existing ?? {
        inProgress: true,
        highlightsPreserved,
        highlightIdsChanged: false,
        droppedHighlightIds: [],
        message: "正在解析，请稍候。",
      },
    };
  }
  const previous = await readHighlights(id);
  const previousIds = previous.map((item) => item.id);
  state().previousIds.set(id, previousIds);
  const highlightsPreserved = previousIds.length > 0;
  const report: ReanalyzeReport = {
    inProgress: true,
    highlightsPreserved,
    highlightIdsChanged: false,
    droppedHighlightIds: [],
    message: highlightsPreserved
      ? "正在重新分析。已勾选的片段编号会尽量保持不变。"
      : "正在解析录像，找出高光片段…",
  };
  state().reports.set(id, report);
  const next = await updateMeta(id, { status: "analyzing", error: null });
  setDemoProgress(id, { phase: "analyzing", percent: null, message: report.message ?? "正在解析录像，找出高光片段…" });
  startAnalysis(id);
  return { ok: true, demo: next, report };
}

async function execute(id: string): Promise<void> {
  const meta = await readMeta(id);
  if (!meta) return;
  const hadHighlights = (await readHighlights(id)).length > 0;
  const demoPath = await demoFilePath(id);
  try {
    await access(demoPath);
  } catch {
    if (hadHighlights) {
      await updateMeta(id, { status: "ready", error: DEMO_FILE_MISSING_MESSAGE });
    } else {
      await updateMeta(id, { status: "error", error: DEMO_FILE_MISSING_MESSAGE });
    }
    setDemoProgress(id, { phase: hadHighlights ? "ready" : "error", percent: hadHighlights ? 100 : null, message: DEMO_FILE_MISSING_MESSAGE });
    return;
  }
  setDemoProgress(id, { phase: "analyzing", percent: null, message: "正在解析录像，找出高光片段…" });
  try {
    await persistAnalysis(id, demoPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "解析失败";
    const hint = sourceHint(meta.originalName);
    if (hint && /unknown demo source/i.test(detail)) {
      try {
        await persistAnalysis(id, demoPath, hint);
        return;
      } catch (retryError) {
        const retryDetail = retryError instanceof Error ? retryError.message : detail;
        await failAnalysis(id, explain(retryDetail), hadHighlights);
        return;
      }
    }
    await failAnalysis(id, explain(detail), hadHighlights);
  }
}

async function failAnalysis(id: string, message: string, hadHighlights: boolean): Promise<void> {
  if (hadHighlights) {
    const warning = `重新分析失败，仍使用上次的高光列表。${message}`;
    await updateMeta(id, { status: "ready", error: warning });
    setDemoProgress(id, { phase: "ready", percent: 100, message: warning });
    state().reports.set(id, {
      inProgress: false,
      highlightsPreserved: true,
      highlightIdsChanged: false,
      droppedHighlightIds: [],
      message: warning,
    });
    return;
  }
  await updateMeta(id, { status: "error", error: message });
  setDemoProgress(id, { phase: "error", percent: null, message });
}

async function persistAnalysis(id: string, demoPath: string, source?: string): Promise<void> {
  const outputFolder = path.join(demoDirectory(id), "analyzer-out");
  const analyze = state().runtime?.analyze ?? runAnalyzer;
  setDemoProgress(id, { phase: "analyzing", percent: null, message: "正在解析录像，找出高光片段…" });
  const { jsonPath } = await analyze(demoPath, outputFolder, source, {
    onOutput: (chunk) => {
      const current = { phase: "analyzing" as const, percent: null, message: "正在解析录像，找出高光片段…" };
      const percentMatch = chunk.match(/(\d{1,3})\s*%/);
      setDemoProgress(id, {
        phase: "analyzing",
        percent: percentMatch ? Math.max(0, Math.min(100, Number(percentMatch[1]))) : current.percent,
        message: "正在解析录像，找出高光片段…",
      });
    },
  });
  setDemoProgress(id, { phase: "analyzing", percent: 90, message: "正在整理击杀和高光片段…" });
  const match = trimMatch(parseMatchJson(await readFile(jsonPath, "utf8")));
  const highlights = detectHighlights(match);
  const previousIds = state().previousIds.get(id) ?? [];
  await writeAnalysis(id, match, highlights);
  await updateMeta(id, {
    status: "ready",
    error: null,
    mapName: match.mapName ?? null,
    game: match.game ?? null,
    source: match.source ?? null,
    teamAName: match.teamA?.name ?? null,
    teamBName: match.teamB?.name ?? null,
    teamAScore: match.teamA?.score ?? null,
    teamBScore: match.teamB?.score ?? null,
    highlightCount: highlights.length,
    durationSeconds: durationSeconds(match.duration),
    tickrate: tickrateOf(match),
  });
  if (previousIds.length > 0) {
    const diff = diffHighlightIds(previousIds, highlights.map((item: Highlight) => item.id));
    state().reports.set(id, {
      inProgress: false,
      highlightsPreserved: true,
      ...diff,
    });
  } else {
    state().reports.set(id, emptyReanalyzeReport());
  }
  setDemoProgress(id, { phase: "ready", percent: 100, message: "解析完成，可以勾选片段。" });
  await rm(outputFolder, { recursive: true, force: true });
  clearDemoProgress(id);
}

function explain(log: string): string {
  const text = log.replace(/\s+/g, " ").trim();
  if (/unknown demo source/i.test(text)) {
    return "解析器认不出这场录像的平台。把文件名里加上平台再传一次，例如 esplay、faceit、5eplay、valve。";
  }
  if (/pov/i.test(text)) return "这像是玩家自己的 POV 录像。当前只解析 GOTV 或服务器录像。";
  if (!text) return "解析失败。请确认文件是 CS2 或 CS:GO 的 .dem。";
  return `解析失败。${text.slice(0, 500)}`;
}
