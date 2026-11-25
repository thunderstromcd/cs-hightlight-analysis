import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectHighlights, highlightDetail, highlightLabel, isCountableKill } from "@/lib/highlights";
import { durationSeconds, listPlayers, parseMatchJson, type AnalyzerKill, type MatchInput } from "@/lib/match";

function kill(overrides: Partial<AnalyzerKill> = {}): AnalyzerKill {
  return {
    tick: 2000,
    roundNumber: 1,
    weaponType: "rifle",
    weaponName: "AK-47",
    killerName: "A",
    killerSteamId: "111",
    killerSide: 2,
    killerTeamName: "T-side",
    victimName: "B",
    victimSteamId: "222",
    victimSide: 3,
    isHeadshot: false,
    penetratedObjects: 0,
    isThroughSmoke: false,
    isNoScope: false,
    is_killer_blinded: false,
    is_killer_airborne: false,
    ...overrides,
  };
}

function match(partial: Partial<MatchInput> = {}): MatchInput {
  return {
    tickrate: 64,
    rounds: [{ number: 1, startTick: 0, freezeTimeEndTick: 500, endTick: 8000 }],
    kills: [],
    clutches: [],
    bombsDefused: [],
    ...partial,
  };
}

describe("countable kills", () => {
  it("drops suicides, team kills, world deaths, and bomb explosions", () => {
    expect(isCountableKill(kill({ killerSteamId: "111", victimSteamId: "111" }))).toBe(false);
    expect(isCountableKill(kill({ killerSide: 2, victimSide: 2 }))).toBe(false);
    expect(isCountableKill(kill({ killerSteamId: 0, killerName: "World", weaponType: "world", weaponName: "World" }))).toBe(false);
    expect(isCountableKill(kill({ weaponType: "equipment", weaponName: "C4" }))).toBe(false);
    expect(isCountableKill(kill())).toBe(true);
  });
});

describe("multi-kills", () => {
  it("emits one ace and keeps a knife as a tag instead of a second clip", () => {
    const highlights = detectHighlights(
      match({
        kills: [0, 1, 2, 3, 4].map((index) =>
          kill({
            tick: 2000 + index * 80,
            victimName: `V${index}`,
            victimSteamId: `9${index}`,
            weaponType: index === 2 ? "melee" : "rifle",
            weaponName: index === 2 ? "Knife" : "AK-47",
          }),
        ),
      }),
    );
    expect(highlights.map((item) => item.kind)).toEqual(["ace"]);
    expect(highlights[0]?.tags).toContain("刀杀");
    expect(highlights[0]?.endTick).toBeGreaterThan(highlights[0]?.startTick ?? 0);
  });

  it("counts four real kills as a quad when the fifth is a team kill", () => {
    const kills = [0, 1, 2, 3].map((index) =>
      kill({ tick: 2000 + index * 100, victimName: `V${index}`, victimSteamId: `9${index}` }),
    );
    kills.push(kill({ tick: 2500, victimName: "mate", victimSteamId: "333", victimSide: 2 }));
    const highlights = detectHighlights(match({ kills }));
    expect(highlights.map((item) => item.kind)).toEqual(["quad"]);
  });

  it("keeps a two-kill burst inside six seconds and drops a slower pair", () => {
    const fast = detectHighlights(
      match({
        kills: [
          kill({ tick: 2000, victimSteamId: "222", victimName: "B" }),
          kill({ tick: 2300, victimSteamId: "333", victimName: "C" }),
        ],
      }),
    );
    expect(fast.map((item) => item.kind)).toEqual(["double"]);

    const slow = detectHighlights(
      match({
        kills: [
          kill({ tick: 2000, victimSteamId: "222", victimName: "B" }),
          kill({ tick: 2400, victimSteamId: "333", victimName: "C" }),
        ],
      }),
    );
    expect(slow).toEqual([]);
  });

  it("uses the match tickrate, and 64 when the analyzer omitted it", () => {
    const kills = [
      kill({ tick: 2000, victimSteamId: "222", victimName: "B" }),
      kill({ tick: 2200, victimSteamId: "333", victimName: "C" }),
    ];
    expect(detectHighlights(match({ tickrate: 10, kills }))).toEqual([]);
    expect(detectHighlights(match({ tickrate: undefined, kills })).map((item) => item.kind)).toEqual(["double"]);
  });

  it("treats two kills on the same tick as one collateral, including a knife tag", () => {
    const highlights = detectHighlights(
      match({
        kills: [
          kill({ tick: 3000, victimSteamId: "222", victimName: "B", weaponType: "rifle", weaponName: "AK-47" }),
          kill({ tick: 3000, victimSteamId: "333", victimName: "C", weaponType: "melee", weaponName: "Knife" }),
        ],
      }),
    );
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.kind).toBe("collateral");
    expect(highlights[0]?.tags).toContain("刀杀");
  });
});

describe("special kills and clutches", () => {
  it("lists a lone knife, and clamps the clip to freeze time and round end", () => {
    const early = detectHighlights(
      match({
        rounds: [{ number: 1, startTick: 0, freezeTimeEndTick: 1500, endTick: 8000 }],
        kills: [kill({ tick: 1520, weaponType: "melee", weaponName: "Knife" })],
      }),
    );
    expect(early[0]?.kind).toBe("knife");
    expect(early[0]?.startTick).toBe(1500);

    const late = detectHighlights(
      match({
        rounds: [{ number: 1, startTick: 0, freezeTimeEndTick: 100, endTick: 2000 }],
        kills: [kill({ tick: 1980, weaponType: "melee", weaponName: "Knife" })],
      }),
    );
    expect(late[0]?.endTick).toBe(2000);
  });

  it("keeps won 1v2 and above, and drops lost clutches and won 1v1s", () => {
    const highlights = detectHighlights(
      match({
        rounds: [{ number: 3, startTick: 1000, freezeTimeEndTick: 1200, endTick: 5000 }],
        clutches: [
          { tick: 2000, roundNumber: 3, opponentCount: 3, side: 2, hasWon: true, clutcherSteamId: "111", clutcherName: "A", clutcherKillCount: 2 },
          { tick: 2100, roundNumber: 3, opponentCount: 4, side: 3, hasWon: false, clutcherSteamId: "222", clutcherName: "B", clutcherKillCount: 0 },
          { tick: 2200, roundNumber: 3, opponentCount: 1, side: 2, hasWon: true, clutcherSteamId: "333", clutcherName: "C", clutcherKillCount: 1 },
        ],
      }),
    );
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.kind).toBe("clutch");
    expect(highlights[0]?.opponentCount).toBe(3);
    expect(highlightLabel(highlights[0]!)).toBe("1v3 残局");
    expect(highlights[0]?.startTick).toBeLessThanOrEqual(2000);
    expect(highlights[0]?.startTick).toBeGreaterThanOrEqual(1200);
    expect(highlights[0]?.endTick).toBe(5000);
  });

  it("folds a ninja defuse into the clutcher's clip, and keeps a lone ninja defuse", () => {
    const merged = detectHighlights(
      match({
        clutches: [
          { tick: 2000, roundNumber: 1, opponentCount: 2, side: 3, hasWon: true, clutcherSteamId: "111", clutcherName: "A", clutcherKillCount: 1 },
        ],
        bombsDefused: [{ tick: 4000, roundNumber: 1, site: "A", defuserSteamId: "111", defuserName: "A", terroristAliveCount: 1, counterTerroristAliveCount: 1 }],
      }),
    );
    expect(merged.map((item) => item.kind)).toEqual(["clutch"]);
    expect(merged[0]?.tags).toContain("忍者拆包");

    const alone = detectHighlights(
      match({
        bombsDefused: [{ tick: 4000, roundNumber: 1, site: "B", defuserSteamId: "444", defuserName: "D", terroristAliveCount: 2, counterTerroristAliveCount: 1 }],
      }),
    );
    expect(alone.map((item) => item.kind)).toEqual(["ninja"]);
    expect(highlightDetail(alone[0]!)).toContain("B 点");
    expect(highlightDetail(alone[0]!)).toContain("2 名匪徒");
  });

  it("recognizes noscope, smoke, blind, and wallbang from analyzer flags", () => {
    const highlights = detectHighlights(
      match({
        kills: [
          kill({ tick: 2000, roundNumber: 1, isNoScope: true, weaponType: "sniper", weaponName: "AWP", victimSteamId: "2" }),
          kill({ tick: 3000, roundNumber: 2, isThroughSmoke: true, isHeadshot: true, victimSteamId: "3" }),
          kill({ tick: 4000, roundNumber: 3, is_killer_blinded: true, victimSteamId: "4" }),
          kill({ tick: 5000, roundNumber: 4, penetratedObjects: 1, victimSteamId: "5" }),
        ],
        rounds: [1, 2, 3, 4].map((number) => ({ number, startTick: number * 1000, freezeTimeEndTick: number * 1000 + 100, endTick: number * 1000 + 900 })),
      }),
    );
    expect(highlights.map((item) => item.kind)).toEqual(["noscope", "smoke", "blind", "wallbang"]);
    expect(highlights[1]?.tags).toContain("爆头");
    expect(highlightDetail(highlights[1]!)).toBe("AK-47 爆头击杀 B");
  });
});

describe("real analyzer excerpt", () => {
  const raw = readFileSync(fileURLToPath(new URL("./fixtures/esplay-vertigo-excerpt.json", import.meta.url)), "utf8");

  it("keeps SteamID64 exact and reads duration as nanoseconds", () => {
    const naive = JSON.parse(raw) as { kills: Array<{ killerName: string; roundNumber: number; killerSteamId: number }> };
    const rounded = naive.kills.find((item) => item.killerName === "Emmy" && item.roundNumber === 14);
    expect(String(rounded?.killerSteamId)).toBe("76561198795651870");

    const parsed = parseMatchJson(raw);
    const kept = parsed.kills?.find((item) => item.killerName === "Emmy" && item.roundNumber === 14);
    expect(kept?.killerSteamId).toBe("76561198795651874");
    expect(parsed.duration).toBe(942000000000);
    expect(durationSeconds(parsed.duration)).toBeCloseTo(942, 0);
    expect(listPlayers(parsed).map((player) => player.name).sort()).toEqual(["Emmy", "Lowlita", "stina", "zietra"]);
  });

  it("finds the smoke kill, the blind kill, and Emmy's won 1v2", () => {
    const highlights = detectHighlights(parseMatchJson(raw));
    expect(highlights.map((item) => `${item.kind}:${item.playerName}:${item.roundNumber}`).sort()).toEqual([
      "blind:Lowlita:10",
      "clutch:Emmy:14",
      "smoke:Lowlita:4",
    ]);
    const clutch = highlights.find((item) => item.kind === "clutch");
    expect(clutch?.steamId).toBe("76561198795651874");
    expect(clutch?.opponentCount).toBe(2);
    expect(clutch?.endTick).toBe(58836);
    expect(clutch?.startTick).toBeLessThanOrEqual(55619);
    expect(clutch?.startTick).toBeGreaterThanOrEqual(54078);
    expect(highlights.every((item) => item.endTick > item.startTick)).toBe(true);
    expect(highlightDetail(highlights.find((item) => item.kind === "smoke")!)).toBe("AK-47 爆头击杀 stina");
  });
});
