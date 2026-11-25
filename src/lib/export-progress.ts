export const EXPORT_WARNING =
  "导出时会打开本机 CS2，录制过程中请不要操作游戏。等待时间通常比片段时长更长，因为还要启动游戏和编码。";

export const EXPORT_STAGES = ["queued", "preparing", "starting_game", "recording", "encoding", "done"] as const;
export type ExportStage = (typeof EXPORT_STAGES)[number] | "error";
export type StageTimes = Partial<Record<ExportStage, string>>;
export type RemainingEstimate = { minSeconds: number; maxSeconds: number; source: "rough" | "history" };

export const EXPORT_STAGE_LABELS: Record<ExportStage, string> = {
  queued: "排队等待中",
  preparing: "正在准备录像",
  starting_game: "正在启动 CS2",
  recording: "正在录制片段",
  encoding: "正在编码成片",
  done: "导出完成",
  error: "导出失败",
};

/** CS2 launch, csdm analyze, and encode are extra work on top of clip length. */
export const EXPORT_GAME_START_SECONDS = 75;
export const EXPORT_ANALYZE_SECONDS = 20;
export const EXPORT_ENCODE_FACTOR = 0.7;
export const EXPORT_MIN_ENCODE_SECONDS = 25;

export function estimateExportWaitSeconds(clipDurationSeconds: number): number {
  const clips = Math.max(0, clipDurationSeconds);
  const encode = Math.max(EXPORT_MIN_ENCODE_SECONDS, Math.round(clips * EXPORT_ENCODE_FACTOR));
  return Math.round(EXPORT_ANALYZE_SECONDS + EXPORT_GAME_START_SECONDS + clips + encode);
}

const ACTIVE_STAGES = ["preparing", "starting_game", "recording", "encoding"] as const;
const TIMED_STAGES = [...ACTIVE_STAGES, "done"] as const;
type StageSample = { stageTimes?: StageTimes; clipDurationSeconds?: number };

function quantile(values: number[], fraction: number): number {
  const sorted = values.sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

export function estimateRemaining(
  stage: ExportStage,
  stageStartedAt: string | null,
  clipSeconds: number,
  history: StageSample[],
  now: number,
): RemainingEstimate | null {
  const stageIndex = ACTIVE_STAGES.findIndex((item) => item === stage);
  if (stageIndex < 0 || !stageStartedAt) return null;
  const samples = history.flatMap(({ stageTimes, clipDurationSeconds }) => {
    if (!stageTimes || !clipDurationSeconds || clipDurationSeconds <= 0) return [];
    const boundaries = TIMED_STAGES.map((item) => Date.parse(stageTimes[item] ?? ""));
    const seconds = ACTIVE_STAGES.map((_, index) => (boundaries[index + 1] - boundaries[index]) / 1000);
    if (seconds.some((value) => !Number.isFinite(value) || value < 0)) return [];
    return [seconds.map((value, index) => index < 2 ? value : value / clipDurationSeconds)];
  }).slice(0, 20);
  const rough = [
    EXPORT_ANALYZE_SECONDS,
    EXPORT_GAME_START_SECONDS,
    clipSeconds,
    Math.max(EXPORT_MIN_ENCODE_SECONDS, Math.round(clipSeconds * EXPORT_ENCODE_FACTOR)),
  ];
  const source = samples.length >= 3 ? "history" : "rough";
  const project = (fraction: number, roughFactor: number) => ACTIVE_STAGES.reduce((total, _, index) => {
    if (index < stageIndex) return total;
    const seconds = source === "history"
      ? quantile(samples.map((sample) => sample[index]), fraction) * (index < 2 ? 1 : clipSeconds)
      : rough[index] * roughFactor;
    return total + seconds;
  }, 0);
  const elapsed = Math.max(0, (now - Date.parse(stageStartedAt)) / 1000);
  return {
    minSeconds: Math.max(0, Math.floor(project(0.25, 0.75) - elapsed)),
    maxSeconds: Math.max(0, Math.ceil(project(0.75, 1.5) - elapsed)),
    source,
  };
}

export function formatEstimatedWait(seconds: number): string {
  if (seconds < 90) return `大约需要 ${Math.max(1, Math.round(seconds))} 秒，通常比片段时长更长`;
  const minutes = Math.max(2, Math.round(seconds / 60));
  return `大约需要 ${minutes} 分钟，通常比片段时长更长`;
}

export function stageFromLegacyStatus(status: string | undefined): ExportStage {
  if (status === "queued") return "queued";
  if (status === "done") return "done";
  if (status === "failed" || status === "error") return "error";
  if (status === "starting_game" || status === "recording" || status === "encoding") return status;
  return "recording";
}

export function inferExportStage(chunk: string, current: ExportStage): ExportStage {
  if (current === "done" || current === "error") return current;
  const text = chunk.replace(/\r/g, "\n");
  if (
    /Converting sequence/i.test(text) ||
    /Concatenating sequences/i.test(text) ||
    /Moving files/i.test(text) ||
    /Generating video with FFmpeg/i.test(text) ||
    /Starting FFmpeg/i.test(text) ||
    /libx264/i.test(text)
  ) {
    return "encoding";
  }
  if (current !== "encoding" && /Recording\s+\d+\s+sequences|Recording sequence|startmovie|WS:: game process socket connected/i.test(text)) {
    return "recording";
  }
  if (
    /Waiting for the video generation/i.test(text) ||
    /Installing HLAE/i.test(text) ||
    /Starting the game/i.test(text) ||
    /Launching/i.test(text) ||
    /Starting CS/i.test(text)
  ) {
    return current === "encoding" || current === "recording" ? current : "starting_game";
  }
  return current;
}
