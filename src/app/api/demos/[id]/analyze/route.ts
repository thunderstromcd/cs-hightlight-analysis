import { requestReanalyze } from "@/lib/analysis";
import { readLibraryEntry } from "@/lib/account-store";
import { privateJson, requireAccount } from "@/lib/auth";
import { forLibraryEntry, toPublicDemoDetail } from "@/lib/public-demo";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  const { id } = await context.params;
  const entry = readLibraryEntry(user.id, id);
  if (!entry) return privateJson({ error: "not_found", message: "找不到这场录像。" }, { status: 404 });
  const result = await requestReanalyze(entry.assetId);
  if (!result.ok) {
    return Response.json({ error: result.error, message: result.message }, { status: result.status });
  }
  const detail = await toPublicDemoDetail(result.demo);
  return privateJson({
    demo: forLibraryEntry(detail.demo, entry),
    highlights: detail.highlights,
    reanalysis: result.report,
    message: result.report.message,
  });
}
