import {
  type AnalyzerBombDefused,
  type AnalyzerClutch,
  type AnalyzerKill,
  type AnalyzerRound,
  type MatchInput,
  listPlayers,
  steamId,
  tickrateOf,
} from "@/lib/match";

export const FAST_DOUBLE_SECONDS = 6;
export const MULTI_PAD_BEFORE_SECONDS = 5;
export const MULTI_PAD_AFTER_SECONDS = 3;
export const SIGNATURE_PAD_BEFORE_SECONDS = 3;
export const SIGNATURE_PAD_AFTER_SECONDS = 2;
export const CLUTCH_PAD_BEFORE_SECONDS = 2;
export const CLUTCH_MAX_SECONDS = 75;
export const NINJA_PAD_BEFORE_SECONDS = 8;
export const NINJA_PAD_AFTER_SECONDS = 2;

const SIDE_T = 2;
const SIDE_CT = 3;
const UNCOUNTED_TYPES = new Set(["world", "equipment", "unknown", ""]);
const UNCOUNTED_NAMES = new Set(["World", "C4", "Unknown", ""]);

export type HighlightKind =
  | "ace"
  | "quad"
  | "triple"
  | "double"
  | "clutch"
  | "collateral"
  | "knife"
  | "noscope"
  | "wallbang"
  | "smoke"
  | "blind"
  | "zeus"
  | "grenade"
  | "airborne"
  | "ninja";

export type HighlightKill = {
  tick: number;
  weaponName: string;
  victimName: string;
  victimSteamId?: string;
  isHeadshot: boolean;
};

export type Highlight = {
  id: string;
  kind: HighlightKind;
  roundNumber: number;
  steamId: string;
  playerName: string;
  side: number;
  teamName: string;
  startTick: number;
  endTick: number;
  durationSeconds: number;
  score: number;
  tags: string[];
  opponentCount?: number;
  note?: string;
  kills: HighlightKill[];
};

const KIND_LABEL: Record<HighlightKind, string> = {
  ace: "五杀",
  quad: "四杀",
  triple: "三杀",
  double: "双杀",
  clutch: "残局",
  collateral: "一枪多杀",
  knife: "刀杀",
  noscope: "不开镜",
  wallbang: "穿墙",
  smoke: "穿烟",
  blind: "盲打",
  zeus: "电击枪",
  grenade: "投掷物",
  airborne: "空中爆头",
  ninja: "忍者拆包",
};

const SIGNATURE_TAG: Partial<Record<HighlightKind, string>> = {
  knife: "刀杀",
  noscope: "不开镜",
  wallbang: "穿墙",
  smoke: "穿烟",
  blind: "盲打",
  zeus: "电击枪",
  grenade: "投掷物",
  airborne: "空中爆头",
};

export function highlightLabel(highlight: Highlight): string {
  if (highlight.kind === "clutch") return `1v${highlight.opponentCount ?? "?"} 残局`;
  return KIND_LABEL[highlight.kind];
}

export function highlightGroup(kind: HighlightKind): "multi" | "clutch" | "special" {
  if (kind === "clutch") return "clutch";
  if (kind === "ace" || kind === "quad" || kind === "triple" || kind === "double" || kind === "collateral") {
    return "multi";
  }
  return "special";
}

export function killPhrase(kill: HighlightKill): string {
  const verb = kill.isHeadshot ? "爆头击杀" : "击杀";
  return `${kill.weaponName} ${verb} ${kill.victimName}`;
}

export function highlightDetail(highlight: Highlight): string {
  if (highlight.note) return highlight.note;
  if (highlight.kills.length === 0) return highlightLabel(highlight);
  return highlight.kills.map(killPhrase).join(" · ");
}

export function isCountableKill(kill: AnalyzerKill): boolean {
  const killer = steamId(kill.killerSteamId);
  const victim = steamId(kill.victimSteamId);
  if (killer === "0" || killer === victim) return false;
  if (kill.killerSide !== SIDE_T && kill.killerSide !== SIDE_CT) return false;
  if (kill.killerSide === kill.victimSide) return false;
  if (UNCOUNTED_TYPES.has(kill.weaponType ?? "")) return false;
  if (UNCOUNTED_NAMES.has(kill.weaponName ?? "")) return false;
  return true;
}

export function detectHighlights(match: MatchInput): Highlight[] {
  const tickrate = tickrateOf(match);
  const rounds = new Map<number, AnalyzerRound>();
  for (const round of match.rounds ?? []) rounds.set(round.number, round);

  const countable = (match.kills ?? []).filter(isCountableKill);
  const groups = new Map<string, AnalyzerKill[]>();
  for (const kill of countable) {
    const key = `${kill.roundNumber}:${steamId(kill.killerSteamId)}`;
    const list = groups.get(key);
    if (list) list.push(kill);
    else groups.set(key, [kill]);
  }

  const highlights: Highlight[] = [];
  const covered = new Set<AnalyzerKill>();

  for (const kills of groups.values()) {
    kills.sort((a, b) => a.tick - b.tick);
    const count = kills.length;
    const spanSeconds = (kills[count - 1].tick - kills[0].tick) / tickrate;
    const sameTick = count >= 2 && kills.every((kill) => kill.tick === kills[0].tick);
    let kind: HighlightKind | null = null;
    if (count >= 5) kind = "ace";
    else if (count === 4) kind = "quad";
    else if (count === 3) kind = "triple";
    else if (count === 2 && sameTick) kind = "collateral";
    else if (count === 2 && spanSeconds <= FAST_DOUBLE_SECONDS) kind = "double";

    if (!kind) continue;
    for (const kill of kills) covered.add(kill);
    const tags = tagsFor(kills, kind);
    if (kills.some((kill, index) => index > 0 && kill.tick === kills[index - 1].tick) && kind !== "collateral") {
      tags.push("一枪多杀");
    }
    highlights.push(buildKillClip(match, rounds, tickrate, kind, kills, tags));
  }

  for (const kill of countable) {
    if (covered.has(kill)) continue;
    const kind = signatureKind(kill);
    if (!kind) continue;
    highlights.push(buildKillClip(match, rounds, tickrate, kind, [kill], tagsFor([kill], kind)));
  }

  const clutches = wonClutches(match.clutches ?? []);
  const clutchKeys = new Set<string>();
  for (const clutch of clutches) {
    const id = steamId(clutch.clutcherSteamId);
    clutchKeys.add(`${clutch.roundNumber}:${id}`);
    const roundKills = countable.filter(
      (kill) => kill.roundNumber === clutch.roundNumber && steamId(kill.killerSteamId) === id && kill.tick >= clutch.tick,
    );
    highlights.push(buildClutchClip(match, rounds, tickrate, clutch, roundKills));
  }

  for (const defuse of match.bombsDefused ?? []) {
    if ((defuse.terroristAliveCount ?? 0) < 1) continue;
    const id = steamId(defuse.defuserSteamId);
    if (id === "0") continue;
    const key = `${defuse.roundNumber}:${id}`;
    if (clutchKeys.has(key)) {
      const target = highlights.find(
        (item) => item.kind === "clutch" && item.steamId === id && item.roundNumber === defuse.roundNumber,
      );
      if (target && !target.tags.includes("忍者拆包")) target.tags.push("忍者拆包");
      continue;
    }
    highlights.push(buildNinjaClip(match, rounds, tickrate, defuse));
  }

  highlights.sort((a, b) => a.roundNumber - b.roundNumber || a.startTick - b.startTick || b.score - a.score);
  return highlights;
}

function wonClutches(clutches: AnalyzerClutch[]): AnalyzerClutch[] {
  const best = new Map<string, AnalyzerClutch>();
  for (const clutch of clutches) {
    if (!clutch.hasWon || clutch.opponentCount < 2) continue;
    if (steamId(clutch.clutcherSteamId) === "0") continue;
    const key = `${clutch.roundNumber}:${steamId(clutch.clutcherSteamId)}`;
    const current = best.get(key);
    if (!current || clutch.opponentCount > current.opponentCount || (clutch.opponentCount === current.opponentCount && clutch.tick < current.tick)) {
      best.set(key, clutch);
    }
  }
  return [...best.values()];
}

function signatureKind(kill: AnalyzerKill): HighlightKind | null {
  const type = kill.weaponType ?? "";
  const name = kill.weaponName ?? "";
  if (type === "melee" || name === "Knife") return "knife";
  if (kill.isNoScope) return "noscope";
  if (name === "Zeus x27") return "zeus";
  if (type === "grenade") return "grenade";
  if (kill.is_killer_blinded) return "blind";
  if (kill.isThroughSmoke) return "smoke";
  if ((kill.penetratedObjects ?? 0) > 0) return "wallbang";
  if (kill.is_killer_airborne && kill.isHeadshot) return "airborne";
  return null;
}

function tagsFor(kills: AnalyzerKill[], primary: HighlightKind): string[] {
  const tags: string[] = [];
  if (kills.some((kill) => kill.isHeadshot) && primary !== "airborne") tags.push("爆头");
  const seen = new Set<string>();
  for (const kill of kills) {
    const kind = signatureKind(kill);
    const label = kind ? SIGNATURE_TAG[kind] : undefined;
    if (!label || kind === primary || seen.has(label)) continue;
    seen.add(label);
    tags.push(label);
  }
  return tags;
}

function buildKillClip(
  match: MatchInput,
  rounds: Map<number, AnalyzerRound>,
  tickrate: number,
  kind: HighlightKind,
  kills: AnalyzerKill[],
  tags: string[],
): Highlight {
  const first = kills[0];
  const last = kills[kills.length - 1];
  const before = kind === "double" || kind === "ace" || kind === "quad" || kind === "triple" || kind === "collateral"
    ? MULTI_PAD_BEFORE_SECONDS
    : SIGNATURE_PAD_BEFORE_SECONDS;
  const after = before === MULTI_PAD_BEFORE_SECONDS ? MULTI_PAD_AFTER_SECONDS : SIGNATURE_PAD_AFTER_SECONDS;
  const window = clipWindow(rounds.get(first.roundNumber), tickrate, first.tick - before * tickrate, last.tick + after * tickrate);
  const who = steamId(first.killerSteamId);
  return finish(match, {
    kind,
    roundNumber: first.roundNumber,
    steamId: who,
    playerName: first.killerName?.trim() || "未知选手",
    side: first.killerSide ?? 0,
    teamName: first.killerTeamName?.trim() || "",
    anchorTick: first.tick,
    ...window,
    tickrate,
    tags,
    kills: kills.map(toHighlightKill),
    headshot: kills.some((kill) => kill.isHeadshot),
  });
}

function buildClutchClip(
  match: MatchInput,
  rounds: Map<number, AnalyzerRound>,
  tickrate: number,
  clutch: AnalyzerClutch,
  kills: AnalyzerKill[],
): Highlight {
  const round = rounds.get(clutch.roundNumber);
  const end = round?.endTick && round.endTick > clutch.tick ? round.endTick : clutch.tick + 10 * tickrate;
  const start = Math.max(clutch.tick - CLUTCH_PAD_BEFORE_SECONDS * tickrate, end - CLUTCH_MAX_SECONDS * tickrate);
  const window = clipWindow(round, tickrate, start, end);
  const who = steamId(clutch.clutcherSteamId);
  const identity = identityFor(match, who, clutch.clutcherName, clutch.side);
  const killCount = Math.max(kills.length, clutch.clutcherKillCount ?? 0);
  return finish(match, {
    kind: "clutch",
    roundNumber: clutch.roundNumber,
    steamId: who,
    playerName: identity.name,
    side: clutch.side ?? identity.side,
    teamName: identity.teamName,
    anchorTick: clutch.tick,
    ...window,
    tickrate,
    tags: tagsFor(kills, "clutch"),
    kills: kills.map(toHighlightKill),
    opponentCount: clutch.opponentCount,
    clutchKills: killCount,
    headshot: kills.some((kill) => kill.isHeadshot),
  });
}

function buildNinjaClip(
  match: MatchInput,
  rounds: Map<number, AnalyzerRound>,
  tickrate: number,
  defuse: AnalyzerBombDefused,
): Highlight {
  const who = steamId(defuse.defuserSteamId);
  const identity = identityFor(match, who, defuse.defuserName, SIDE_CT);
  const window = clipWindow(
    rounds.get(defuse.roundNumber),
    tickrate,
    defuse.tick - NINJA_PAD_BEFORE_SECONDS * tickrate,
    defuse.tick + NINJA_PAD_AFTER_SECONDS * tickrate,
  );
  const alive = defuse.terroristAliveCount ?? 0;
  const site = defuse.site ? `${defuse.site} 点` : "包点";
  return finish(match, {
    kind: "ninja",
    roundNumber: defuse.roundNumber,
    steamId: who,
    playerName: identity.name,
    side: SIDE_CT,
    teamName: identity.teamName,
    anchorTick: defuse.tick,
    ...window,
    tickrate,
    tags: [],
    kills: [],
    note: `在${site}拆包，当时还有 ${alive} 名匪徒`,
    headshot: false,
  });
}

function identityFor(match: MatchInput, id: string, fallbackName: string | undefined, fallbackSide: number | undefined) {
  const player = listPlayers(match).find((item) => item.steamId === id);
  const kill = (match.kills ?? []).find((item) => steamId(item.killerSteamId) === id);
  return {
    name: player?.name || fallbackName?.trim() || "未知选手",
    side: fallbackSide || player?.side || kill?.killerSide || 0,
    teamName: player?.teamName || kill?.killerTeamName || "",
  };
}

function finish(
  match: MatchInput,
  input: {
    kind: HighlightKind;
    roundNumber: number;
    steamId: string;
    playerName: string;
    side: number;
    teamName: string;
    anchorTick: number;
    startTick: number;
    endTick: number;
    tickrate: number;
    tags: string[];
    kills: HighlightKill[];
    opponentCount?: number;
    clutchKills?: number;
    note?: string;
    headshot: boolean;
  },
): Highlight {
  const player = listPlayers(match).find((item) => item.steamId === input.steamId);
  return {
    id: `${input.kind}:${input.steamId}:${input.roundNumber}:${input.anchorTick}`,
    kind: input.kind,
    roundNumber: input.roundNumber,
    steamId: input.steamId,
    playerName: player?.name || input.playerName,
    side: input.side,
    teamName: player?.teamName || input.teamName,
    startTick: input.startTick,
    endTick: input.endTick,
    durationSeconds: (input.endTick - input.startTick) / input.tickrate,
    score: scoreOf(input.kind, input.opponentCount, input.clutchKills, input.headshot),
    tags: input.tags,
    opponentCount: input.opponentCount,
    note: input.note,
    kills: input.kills,
  };
}

function scoreOf(kind: HighlightKind, opponentCount: number | undefined, clutchKills: number | undefined, headshot: boolean): number {
  if (kind === "clutch") {
    const enemies = opponentCount ?? 2;
    const extra = Math.max(0, (clutchKills ?? 1) - 1);
    return 50 + enemies * 12 + extra * 4;
  }
  const base: Record<Exclude<HighlightKind, "clutch">, number> = {
    ace: 100,
    quad: 84,
    triple: 64,
    double: 32,
    collateral: 68,
    knife: 72,
    noscope: 60,
    zeus: 58,
    grenade: 48,
    blind: 46,
    wallbang: 40,
    smoke: 36,
    airborne: 34,
    ninja: 70,
  };
  return base[kind] + (headshot ? 3 : 0);
}

function clipWindow(round: AnalyzerRound | undefined, tickrate: number, start: number, end: number): { startTick: number; endTick: number } {
  const min = round && (round.freezeTimeEndTick ?? 0) > 0 ? round.freezeTimeEndTick! : (round?.startTick ?? 0);
  const max = round && (round.endTick ?? 0) > min ? round.endTick! : undefined;
  const startTick = Math.max(min, Math.round(start));
  let endTick = Math.round(end);
  if (max !== undefined) endTick = Math.min(max, endTick);
  if (endTick <= startTick) {
    endTick = max !== undefined ? Math.min(max, startTick + Math.round(tickrate)) : startTick + Math.round(tickrate);
  }
  if (endTick <= startTick) endTick = startTick + 1;
  return { startTick, endTick };
}

function toHighlightKill(kill: AnalyzerKill): HighlightKill {
  const victimSteamId = steamId(kill.victimSteamId);
  return {
    tick: kill.tick,
    weaponName: kill.weaponName || "未知武器",
    victimName: kill.victimName || "未知",
    isHeadshot: Boolean(kill.isHeadshot),
    ...(victimSteamId !== "0" ? { victimSteamId } : {}),
  };
}
