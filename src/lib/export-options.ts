export type ExportPerspective = "player" | "enemy";

export type ExportOptions = {
  showXRay: boolean;
  perspective: ExportPerspective;
};

export type ExportRequestBody = {
  demoId: string;
  highlightIds: string[];
  options: ExportOptions;
};

export function perspectivesForClip(perspective: ExportPerspective, replayAvailable: boolean): ExportPerspective[] {
  return perspective === "enemy" && replayAvailable ? ["player", "enemy"] : ["player"];
}

export function exportDurationSeconds<T extends { durationSeconds: number }>(
  highlights: readonly T[],
  perspective: ExportPerspective,
  replayAvailable: (highlight: T) => boolean,
): number {
  return highlights.reduce(
    (total, highlight) => total + highlight.durationSeconds * perspectivesForClip(perspective, replayAvailable(highlight)).length,
    0,
  );
}
