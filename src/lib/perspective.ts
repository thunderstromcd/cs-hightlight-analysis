import type { Highlight, HighlightKill } from "@/lib/highlights";

export const VICTIM_PERSPECTIVE_NEEDS_REANALYZE =
  "这段录像需要重新分析，才能回放受害者视角。";

export const VICTIM_PERSPECTIVE_CLIP_UNAVAILABLE = "这个片段没有可跟随的受害者视角。";

export const VICTIM_PERSPECTIVE_DEMO_UNAVAILABLE = "这场录像里没有可回放的受害者视角。";

export type PublicHighlightKill = {
  tick: number;
  weaponName: string;
  victimName: string;
  isHeadshot: boolean;
};

export type PublicHighlight = Omit<Highlight, "kills"> & {
  kills: PublicHighlightKill[];
  victimPerspectiveAvailable: boolean;
  victimPerspectiveMessage: string | null;
};

export type VictimPerspectiveInfo = {
  available: boolean;
  message: string | null;
};

function usableId(value: string | undefined): string | null {
  const id = (value ?? "").trim();
  if (!id || id === "0") return null;
  return id;
}

export function killHasVictimCamera(kill: HighlightKill): boolean {
  return usableId(kill.victimSteamId) !== null;
}

export function highlightVictimPerspectiveAvailable(highlight: Highlight): boolean {
  return (highlight.kills ?? []).some(killHasVictimCamera);
}

export function highlightNeedsVictimReanalyze(highlight: Highlight): boolean {
  return (highlight.kills ?? []).some((kill) => {
    const named = (kill.victimName ?? "").trim();
    const hasName = named.length > 0 && named !== "未知";
    return hasName && !killHasVictimCamera(kill);
  });
}

export function highlightVictimPerspectiveMessage(highlight: Highlight): string | null {
  if (highlightVictimPerspectiveAvailable(highlight)) return null;
  if (highlightNeedsVictimReanalyze(highlight)) return VICTIM_PERSPECTIVE_NEEDS_REANALYZE;
  return VICTIM_PERSPECTIVE_CLIP_UNAVAILABLE;
}

export function demoVictimPerspective(highlights: Highlight[]): VictimPerspectiveInfo & { needsReanalyze: boolean } {
  if (highlights.some(highlightVictimPerspectiveAvailable)) {
    return { available: true, message: null, needsReanalyze: false };
  }
  if (highlights.some(highlightNeedsVictimReanalyze)) {
    return { available: false, message: VICTIM_PERSPECTIVE_NEEDS_REANALYZE, needsReanalyze: true };
  }
  return { available: false, message: VICTIM_PERSPECTIVE_DEMO_UNAVAILABLE, needsReanalyze: false };
}

export function toPublicKill(kill: HighlightKill): PublicHighlightKill {
  return {
    tick: kill.tick,
    weaponName: kill.weaponName,
    victimName: kill.victimName,
    isHeadshot: kill.isHeadshot,
  };
}

export function toPublicHighlight(highlight: Highlight): PublicHighlight {
  const available = highlightVictimPerspectiveAvailable(highlight);
  return {
    ...highlight,
    kills: (highlight.kills ?? []).map(toPublicKill),
    victimPerspectiveAvailable: available,
    victimPerspectiveMessage: highlightVictimPerspectiveMessage(highlight),
  };
}

export function containsInternalFieldName(value: unknown, field = "victimSteamId"): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((item) => containsInternalFieldName(item, field));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
      if (key === field) return true;
      return containsInternalFieldName(item, field);
    });
  }
  return false;
}
