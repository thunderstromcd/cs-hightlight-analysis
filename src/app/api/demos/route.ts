import { connection } from "next/server";
import { analysisIsRunning, startAnalysis } from "@/lib/analysis";
import { addLibraryEntry, listLibrary } from "@/lib/account-store";
import { privateJson, requireAccount } from "@/lib/auth";
import { setDemoProgress } from "@/lib/demo-progress";
import { resumeFiveEImport } from "@/lib/five-e-import";
import { forLibraryEntry, toPublicDemo } from "@/lib/public-demo";
import { createDemo, readMeta } from "@/lib/store";

const MAX_BYTES = 1024 * 1024 * 1024;

export async function GET(request: Request) {
  await connection();
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  const limit = new URL(request.url).searchParams.get("limit") === "2" ? 2 : undefined;
  const demos = await Promise.all(listLibrary(user.id, limit).map(async (entry) => {
    const demo = await readMeta(entry.assetId);
    if (!demo) return null;
    resumeFiveEImport(demo);
    if (demo.status === "analyzing" && !analysisIsRunning(demo.id)) startAnalysis(demo.id);
    return forLibraryEntry(await toPublicDemo(demo), entry);
  }));
  return privateJson({ demos: demos.filter(Boolean) });
}

export async function POST(request: Request) {
  const user = requireAccount(request);
  if (user instanceof Response) return user;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "upload", message: "没有读到上传的录像。" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "upload", message: "请选择一个 .dem 文件。" }, { status: 400 });
  }

  const originalName = safeName(file.name);
  if (!originalName.toLowerCase().endsWith(".dem")) {
    return Response.json({ error: "upload", message: "只接受 Counter-Strike 的 .dem 录像。" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return Response.json({ error: "upload", message: "录像是空的，或超过 1 GB。" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const demo = await createDemo(originalName, bytes);
  const { entry } = addLibraryEntry(user.id, demo.id);
  setDemoProgress(demo.id, { phase: "analyzing", percent: null, message: "正在解析录像，找出高光片段…" });
  startAnalysis(demo.id);
  return privateJson({ demo: forLibraryEntry(await toPublicDemo(demo), entry) }, { status: 201 });
}

function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "match.dem";
  return base.slice(0, 180);
}
