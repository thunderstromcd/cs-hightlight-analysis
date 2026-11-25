import { connection } from "next/server";
import { privateJson, requireAccount } from "@/lib/auth";
import { readPublicJob } from "@/lib/export-queue";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  const { id } = await context.params;
  let job;
  try {
    job = await readPublicJob(id, user.id);
  } catch {
    return Response.json({ error: "not_found", message: "找不到这个导出任务。" }, { status: 404 });
  }
  if (!job) return Response.json({ error: "not_found", message: "找不到这个导出任务。" }, { status: 404 });
  return privateJson({ job });
}
