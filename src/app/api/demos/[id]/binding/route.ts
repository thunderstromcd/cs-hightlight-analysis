import { bindLibraryPlayer, readLibraryEntry } from "@/lib/account-store";
import { privateJson, requireAccount } from "@/lib/auth";
import { listPlayers } from "@/lib/match";
import { publicBinding } from "@/lib/public-demo";
import { readMatch } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  const { id } = await context.params;
  const entry = readLibraryEntry(user.id, id);
  if (!entry) return missing();
  const match = await readMatch(entry.assetId);
  if (!match) return privateJson({ message: "请等录像解析出选手名单。" }, { status: 409 });
  const body = await request.json().catch(() => null);
  if (body?.steamId !== null && !listPlayers(match).some((player) => player.steamId === body?.steamId)) {
    return privateJson({ message: "请选择本场比赛中的选手。" }, { status: 400 });
  }
  const binding = bindLibraryPlayer(user.id, id, body.steamId, body.makePreferred === true);
  return binding ? privateJson({ binding: publicBinding(binding) }) : missing();
}

function missing() {
  return privateJson({ error: "not_found", message: "找不到这场录像。" }, { status: 404 });
}
