import type { DemoMeta, DemoStatus } from "@/lib/store";

export type DemoPhase = DemoStatus;

export type DemoProgress = {
  phase: DemoPhase;
  percent: number | null;
  message: string;
};

type ProgressState = {
  byId: Map<string, DemoProgress>;
};

const globalState = globalThis as typeof globalThis & { __chaipianDemoProgress?: ProgressState };

function state(): ProgressState {
  if (!globalState.__chaipianDemoProgress) {
    globalState.__chaipianDemoProgress = { byId: new Map() };
  }
  return globalState.__chaipianDemoProgress;
}

export function resetDemoProgressForTests(): void {
  state().byId.clear();
}

export function setDemoProgress(id: string, progress: DemoProgress): DemoProgress {
  const next: DemoProgress = {
    phase: progress.phase,
    percent: progress.percent == null ? null : Math.max(0, Math.min(100, Math.round(progress.percent))),
    message: progress.message,
  };
  state().byId.set(id, next);
  return next;
}

export function clearDemoProgress(id: string): void {
  state().byId.delete(id);
}

export function progressFromStatus(status: DemoStatus, error?: string | null): DemoProgress {
  if (status === "downloading") {
    return { phase: status, percent: null, message: "正在从 5E 下载比赛录像…" };
  }
  if (status === "extracting") {
    return { phase: status, percent: null, message: "正在解压比赛录像…" };
  }
  if (status === "uploading") {
    return { phase: "uploading", percent: null, message: "正在接收录像文件…" };
  }
  if (status === "analyzing") {
    return { phase: "analyzing", percent: null, message: "正在解析录像，找出高光片段…" };
  }
  if (status === "error") {
    return { phase: "error", percent: null, message: error || "解析失败。" };
  }
  return { phase: "ready", percent: 100, message: "解析完成，可以勾选片段。" };
}

export function getDemoProgress(meta: Pick<DemoMeta, "id" | "status" | "error">): DemoProgress {
  const current = state().byId.get(meta.id);
  return current?.phase === meta.status ? current : progressFromStatus(meta.status, meta.error);
}

export function parseAnalyzerProgress(chunk: string, previous: DemoProgress | null): DemoProgress {
  const base: DemoProgress = previous ?? {
    phase: "analyzing",
    percent: null,
    message: "正在解析录像，找出高光片段…",
  };
  const text = chunk.replace(/\s+/g, " ").trim();
  if (!text) return base;
  const percentMatch = text.match(/(\d{1,3})\s*%/);
  const percent = percentMatch ? Math.max(0, Math.min(100, Number(percentMatch[1]))) : base.percent;
  let message = base.message;
  if (/analy[sz]ing/i.test(text) || /parsing/i.test(text) || /reading/i.test(text)) {
    message = "正在解析录像，找出高光片段…";
  } else if (/detect|highlight|kill/i.test(text)) {
    message = "正在整理击杀和高光片段…";
  }
  return { phase: "analyzing", percent, message };
}
