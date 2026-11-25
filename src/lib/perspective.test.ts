import { describe, expect, it } from "vitest";
import type { Highlight } from "@/lib/highlights";
import {
  containsInternalFieldName,
  demoVictimPerspective,
  highlightVictimPerspectiveAvailable,
  toPublicHighlight,
  VICTIM_PERSPECTIVE_CLIP_UNAVAILABLE,
  VICTIM_PERSPECTIVE_NEEDS_REANALYZE,
} from "@/lib/perspective";

function highlight(partial: Partial<Highlight>): Highlight {
  return {
    id: "triple:1:1:100",
    kind: "triple",
    roundNumber: 1,
    steamId: "76561198000000001",
    playerName: "选手",
    side: 2,
    teamName: "A",
    startTick: 1000,
    endTick: 2000,
    durationSeconds: 8,
    score: 64,
    tags: [],
    kills: [],
    ...partial,
  };
}

describe("victim perspective availability", () => {
  it("exposes a boolean and strips victimSteamId from public highlights", () => {
    const clip = highlight({
      kills: [
        { tick: 1200, weaponName: "AK-47", victimName: "对手", victimSteamId: "76561198000000099", isHeadshot: true },
      ],
    });
    const published = toPublicHighlight(clip);
    expect(published.victimPerspectiveAvailable).toBe(true);
    expect(published.victimPerspectiveMessage).toBeNull();
    expect(published.kills[0]).toEqual({
      tick: 1200,
      weaponName: "AK-47",
      victimName: "对手",
      isHeadshot: true,
    });
    expect(containsInternalFieldName(published)).toBe(false);
    expect(JSON.stringify(published)).not.toContain("victimSteamId");
  });

  it("asks for a re-analyze when kills have names but no victim ids", () => {
    const clip = highlight({
      kills: [{ tick: 1200, weaponName: "AK-47", victimName: "对手", isHeadshot: false }],
    });
    expect(highlightVictimPerspectiveAvailable(clip)).toBe(false);
    expect(toPublicHighlight(clip).victimPerspectiveMessage).toBe(VICTIM_PERSPECTIVE_NEEDS_REANALYZE);
    const info = demoVictimPerspective([clip]);
    expect(info.available).toBe(false);
    expect(info.needsReanalyze).toBe(true);
    expect(info.message).toBe(VICTIM_PERSPECTIVE_NEEDS_REANALYZE);
    expect(info.message).not.toMatch(/Steam|victimSteamId|字段/i);
  });

  it("marks a ninja clip without a victim as unavailable, without asking for re-analyze", () => {
    const clip = highlight({
      kind: "ninja",
      id: "ninja:1:1:100",
      kills: [],
    });
    const published = toPublicHighlight(clip);
    expect(published.victimPerspectiveAvailable).toBe(false);
    expect(published.victimPerspectiveMessage).toBe(VICTIM_PERSPECTIVE_CLIP_UNAVAILABLE);
    const info = demoVictimPerspective([clip]);
    expect(info.available).toBe(false);
    expect(info.needsReanalyze).toBe(false);
  });
});
