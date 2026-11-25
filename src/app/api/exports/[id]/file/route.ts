import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { connection } from "next/server";
import { privateJson, requireAccount } from "@/lib/auth";
import { readOwnedJob } from "@/lib/export-queue";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  const { id } = await context.params;
  const job = await readOwnedJob(id, user.id);
  if (!job) return privateJson({ error: "not_found", message: "找不到这个导出任务。" }, { status: 404 });
  if (!job.outputPath || job.status !== "done") {
    return Response.json({ error: "not_ready", message: "成片还没好。" }, { status: 409 });
  }
  try {
    await stat(job.outputPath);
  } catch {
    return Response.json({ error: "missing", message: "成片文件不在了。" }, { status: 404 });
  }
  const stream = createReadStream(job.outputPath);
  const filename = encodeURIComponent(job.outputName || "highlights.mp4");
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Cache-Control": "private, no-store",
    },
  });
}
