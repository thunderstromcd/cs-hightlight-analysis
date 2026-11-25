import { listPlayers, type MatchInput } from "@/lib/match";
import { readMatch } from "@/lib/store";
import type { LibraryEntry } from "@/lib/account-store";

export type FrequentPlayer = { steamId: string; appearances: number };

export function rankFrequentPlayers(current: MatchInput, library: Array<{ match: MatchInput; createdAt: string }>): FrequentPlayer[] {
  const candidates = new Map(listPlayers(current).map((player) => [
    player.steamId,
    { steamId: player.steamId, matches: new Set<string>(), latest: "" },
  ]));
  for (const { match, createdAt } of library) {
    const checksum = match.checksum?.trim().toLowerCase();
    if (!checksum) continue;
    const playedAt = match.date || createdAt;
    for (const { steamId } of listPlayers(match)) {
      const entry = candidates.get(steamId);
      if (!entry) continue;
      entry.matches.add(checksum);
      if (playedAt > entry.latest) entry.latest = playedAt;
    }
  }
  return [...candidates.values()]
    .filter((player) => player.matches.size >= 3)
    .sort((a, b) => b.matches.size - a.matches.size || b.latest.localeCompare(a.latest) || a.steamId.localeCompare(b.steamId))
    .slice(0, 3)
    .map(({ steamId, matches }) => ({ steamId, appearances: matches.size }));
}

export async function frequentPlayersFor(id: string, current: MatchInput, demos: LibraryEntry[]): Promise<FrequentPlayer[]> {
  if (demos.length < 3) return [];
  const library = await Promise.all(demos.map(async (demo) => ({
    match: demo.id === id ? current : await readMatch(demo.assetId),
    createdAt: demo.createdAt,
  })));
  return rankFrequentPlayers(current, library.flatMap(({ match, createdAt }) => match ? [{ match, createdAt }] : []));
}
