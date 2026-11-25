export type AnalyzerKill = {
  tick: number;
  roundNumber: number;
  weaponType?: string;
  weaponName?: string;
  killerName?: string;
  killerSteamId?: string | number;
  killerSide?: number;
  killerTeamName?: string;
  victimName?: string;
  victimSteamId?: string | number;
  victimSide?: number;
  isHeadshot?: boolean;
  penetratedObjects?: number;
  isThroughSmoke?: boolean;
  isNoScope?: boolean;
  is_killer_blinded?: boolean;
  is_killer_airborne?: boolean;
};

export type AnalyzerRound = {
  number: number;
  startTick?: number;
  freezeTimeEndTick?: number;
  endTick?: number;
  endReason?: number;
  winnerName?: string;
  winnerSide?: number;
  teamAName?: string;
  teamBName?: string;
  teamAScore?: number;
  teamBScore?: number;
};

export type AnalyzerClutch = {
  tick: number;
  roundNumber: number;
  opponentCount: number;
  side?: number;
  hasWon?: boolean;
  clutcherSteamId?: string | number;
  clutcherName?: string;
  clutcherSurvived?: boolean;
  clutcherKillCount?: number;
};

export type AnalyzerBombDefused = {
  tick: number;
  roundNumber: number;
  site?: string;
  defuserSteamId?: string | number;
  defuserName?: string;
  counterTerroristAliveCount?: number;
  terroristAliveCount?: number;
};

export type AnalyzerPlayer = {
  steamId?: string | number;
  name?: string;
  killCount?: number;
  deathCount?: number;
  assistCount?: number;
  headshotCount?: number;
  hltvRating2?: number;
  team?: {
    name?: string;
    letter?: string;
    score?: number;
    currentSide?: number;
  } | null;
};

export type MatchInput = {
  checksum?: string;
  game?: string;
  demoFileName?: string;
  source?: string;
  type?: string;
  mapName?: string;
  tickrate?: number;
  date?: string;
  duration?: number;
  gameModeStr?: string;
  teamA?: { name?: string; letter?: string; score?: number; currentSide?: number };
  teamB?: { name?: string; letter?: string; score?: number; currentSide?: number };
  players?: AnalyzerPlayer[] | Record<string, AnalyzerPlayer>;
  kills?: AnalyzerKill[];
  rounds?: AnalyzerRound[];
  clutches?: AnalyzerClutch[];
  bombsDefused?: AnalyzerBombDefused[];
};

export type PlayerSummary = {
  steamId: string;
  name: string;
  teamName: string;
  teamLetter: string;
  side: number;
  kills: number;
  deaths: number;
  assists: number;
  rating: number;
  headshots: number;
};

const STEAM_INT = /(?<=[:[,]\s*)(\d{16,})(?=\s*[,}\]])/g;

export function steamId(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "0";
  const text = String(value).trim();
  if (!text || text === "0") return "0";
  return text;
}

// SteamID64 does not fit in a JavaScript number. The analyzer writes it as a
// JSON number, so parse the text and quote those integers first.
export function parseMatchJson(raw: string): MatchInput {
  const quoted = raw.replace(STEAM_INT, '"$1"');
  return JSON.parse(quoted) as MatchInput;
}

export function tickrateOf(match: MatchInput): number {
  return typeof match.tickrate === "number" && match.tickrate > 0 ? match.tickrate : 64;
}

export function durationSeconds(duration: number | undefined): number | null {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return null;
  if (duration >= 1e11) return duration / 1e9;
  if (duration >= 1e6) return duration / 1e3;
  return duration;
}

export function listPlayers(match: MatchInput): PlayerSummary[] {
  const raw = match.players;
  const entries: Array<[string, AnalyzerPlayer]> = Array.isArray(raw)
    ? raw.map((player) => [steamId(player.steamId), player])
    : Object.entries(raw ?? {});

  const players = entries
    .map(([key, player]) => {
      const id = steamId(player.steamId ?? key);
      if (id === "0") return null;
      return {
        steamId: id,
        name: player.name?.trim() || "未知选手",
        teamName: player.team?.name?.trim() || "",
        teamLetter: player.team?.letter?.trim() || "",
        side: player.team?.currentSide ?? 0,
        kills: player.killCount ?? 0,
        deaths: player.deathCount ?? 0,
        assists: player.assistCount ?? 0,
        rating: player.hltvRating2 ?? 0,
        headshots: player.headshotCount ?? 0,
      } satisfies PlayerSummary;
    })
    .filter((player): player is PlayerSummary => player !== null);

  players.sort((a, b) => a.teamLetter.localeCompare(b.teamLetter) || b.kills - a.kills || a.name.localeCompare(b.name));
  return players;
}

export function trimMatch(match: MatchInput): MatchInput {
  const players = listPlayers(match).map((player) => ({
    steamId: player.steamId,
    name: player.name,
    killCount: player.kills,
    deathCount: player.deaths,
    assistCount: player.assists,
    headshotCount: player.headshots,
    hltvRating2: player.rating,
    team: {
      name: player.teamName,
      letter: player.teamLetter,
      currentSide: player.side,
    },
  }));

  return {
    checksum: match.checksum,
    game: match.game,
    demoFileName: match.demoFileName,
    source: match.source,
    type: match.type,
    mapName: match.mapName,
    tickrate: match.tickrate,
    date: match.date,
    duration: match.duration,
    gameModeStr: match.gameModeStr,
    teamA: match.teamA,
    teamB: match.teamB,
    players,
    kills: match.kills ?? [],
    rounds: match.rounds ?? [],
    clutches: match.clutches ?? [],
    bombsDefused: match.bombsDefused ?? [],
  };
}
