import { emptyReanalyzeReport, getReanalyzeReport, type ReanalyzeReport } from "@/lib/analysis";
import { getDemoProgress, type DemoProgress } from "@/lib/demo-progress";
import { demoVictimPerspective, toPublicHighlight, type PublicHighlight, type VictimPerspectiveInfo } from "@/lib/perspective";
import type { Highlight } from "@/lib/highlights";
import type { DemoMeta } from "@/lib/store";
import { readHighlights } from "@/lib/store";
import type { LibraryEntry } from "@/lib/account-store";

export type PublicDemo = Omit<DemoMeta, "storedName"> & {
  progress: DemoProgress;
  victimPerspective: VictimPerspectiveInfo;
};

export type PublicDemoDetail = {
  demo: PublicDemo;
  highlights: PublicHighlight[];
  reanalysis: ReanalyzeReport;
};

export async function toPublicDemo(meta: DemoMeta, highlights?: Highlight[]): Promise<PublicDemo> {
  const list = highlights ?? (meta.status === "ready" || meta.status === "analyzing" || meta.status === "error" ? await readHighlights(meta.id) : []);
  const victimPerspective =
    list.length === 0 && meta.status !== "ready"
      ? { available: false, message: null }
      : demoVictimPerspective(list);
  return {
    id: meta.id,
    originalName: meta.originalName,
    bytes: meta.bytes,
    createdAt: meta.createdAt,
    status: meta.status,
    error: meta.error,
    mapName: meta.mapName,
    source: meta.source,
    game: meta.game,
    teamAName: meta.teamAName,
    teamBName: meta.teamBName,
    teamAScore: meta.teamAScore,
    teamBScore: meta.teamBScore,
    highlightCount: meta.highlightCount,
    durationSeconds: meta.durationSeconds,
    tickrate: meta.tickrate,
    importedFrom: meta.importedFrom,
    progress: getDemoProgress(meta),
    victimPerspective: { available: victimPerspective.available, message: victimPerspective.message },
  };
}

export function forLibraryEntry(demo: PublicDemo, entry: LibraryEntry): PublicDemo {
  return { ...demo, id: entry.id, createdAt: entry.createdAt };
}

export function publicBinding(entry: LibraryEntry) {
  return { state: entry.bindingState, steamId: entry.steamId };
}

export async function toPublicDemoDetail(meta: DemoMeta): Promise<PublicDemoDetail> {
  const highlights = await readHighlights(meta.id);
  const report = getReanalyzeReport(meta.id);
  const reanalysis = report ?? (
    meta.status === "analyzing" && highlights.length > 0
      ? {
          inProgress: true,
          highlightsPreserved: true,
          highlightIdsChanged: false,
          droppedHighlightIds: [],
          message: "正在重新分析。已勾选的片段编号会尽量保持不变。",
        }
      : emptyReanalyzeReport()
  );
  return {
    demo: await toPublicDemo(meta, highlights),
    highlights: highlights.map(toPublicHighlight),
    reanalysis,
  };
}
