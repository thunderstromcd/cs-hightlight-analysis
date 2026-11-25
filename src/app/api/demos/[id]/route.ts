import { connection } from "next/server";
import { analysisIsRunning, startAnalysis } from "@/lib/analysis";
import { bindLibraryPlayer, listLibrary, readLibraryEntry, removeLibraryEntry } from "@/lib/account-store";
import { privateJson, requireAccount } from "@/lib/auth";
import { frequentPlayersFor } from "@/lib/frequent-players";
import { resumeFiveEImport } from "@/lib/five-e-import";
import { durationSeconds, listPlayers, tickrateOf, type MatchInput } from "@/lib/match";
import { forLibraryEntry, publicBinding, toPublicDemoDetail } from "@/lib/public-demo";
import { readMatch, readMeta } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  const { id } = await context.params;
  let entry = readLibraryEntry(user.id, id);
  if (!entry) return missing();
  const demo = await readMeta(entry.assetId);
  if (!demo) return missing();
  resumeFiveEImport(demo);
  if (demo.status === "analyzing" && !analysisIsRunning(demo.id)) startAnalysis(demo.id);

  const match = demo.status === "ready" || demo.status === "analyzing" || demo.status === "error" ? await readMatch(entry.assetId) : null;
  const summary = match ? publicMatch(match) : null;
  if (entry.bindingState === "pending" && user.preferredSteamId && summary?.players.some((player) => player.steamId === user.preferredSteamId)) {
    entry = bindLibraryPlayer(user.id, id, user.preferredSteamId, false, true);
    if (!entry) return missing();
  }
  const detail = await toPublicDemoDetail(demo);
  return privateJson({
    demo: forLibraryEntry(detail.demo, entry),
    match: summary,
    binding: publicBinding(entry),
    frequentPlayers: match ? await frequentPlayersFor(id, match, listLibrary(user.id)) : [],
    highlights: detail.highlights,
    reanalysis: detail.reanalysis,
  });
}

export async function DELETE(request: Request, context: Context) {
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  const { id } = await context.params;
  return removeLibraryEntry(user.id, id) ? privateJson({ ok: true }) : missing();
}

function missing() {
  return privateJson({ error: "not_found", message: "找不到这场录像。" }, { status: 404 });
}

function publicMatch(match: MatchInput) {
  return {
    mapName: match.mapName ?? "未知地图",
    game: match.game ?? "",
    source: match.source ?? "",
    date: match.date ?? "",
    durationSeconds: durationSeconds(match.duration),
    tickrate: tickrateOf(match),
    teamA: { name: match.teamA?.name || "A 队", score: match.teamA?.score ?? 0, letter: match.teamA?.letter ?? "A" },
    teamB: { name: match.teamB?.name || "B 队", score: match.teamB?.score ?? 0, letter: match.teamB?.letter ?? "B" },
    players: listPlayers(match),
  };
}
