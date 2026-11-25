import { connection } from "next/server";
import { readLibraryEntry } from "@/lib/account-store";
import { privateJson, requireAccount } from "@/lib/auth";
import { listPublicJobs, requestExport, toPublicJob } from "@/lib/export-queue";

export async function GET(request: Request) {
  await connection();
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  const demoId = new URL(request.url).searchParams.get("demoId") ?? undefined;
  return privateJson({ jobs: await listPublicJobs(user.id, demoId) });
}

export async function POST(request: Request) {
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  let body: { demoId?: string; highlightIds?: string[]; options?: unknown };
  try {
    body = (await request.json()) as { demoId?: string; highlightIds?: string[]; options?: unknown };
  } catch {
    return Response.json({ error: "bad_request", message: "请求格式不对。" }, { status: 400 });
  }
  if (typeof body?.demoId !== "string" || !Array.isArray(body.highlightIds)) {
    return Response.json({ error: "bad_request", message: "需要录像编号和勾选的片段。" }, { status: 400 });
  }
  const entry = readLibraryEntry(user.id, body.demoId);
  if (!entry) return privateJson({ error: "not_found", message: "找不到这场录像。" }, { status: 404 });
  const result = await requestExport(entry.assetId, body.highlightIds, body.options, { ownerId: user.id, entryId: entry.id });
  if (!result.ok) {
    return Response.json({ error: result.error, message: result.message }, { status: result.status });
  }
  const job = toPublicJob(result.job);
  return privateJson({ job, warning: job.warning }, { status: 202 });
}
