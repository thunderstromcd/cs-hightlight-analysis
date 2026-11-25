import { createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { openPromise } from "yauzl";
import { startAnalysis } from "@/lib/analysis";
import { setDemoProgress } from "@/lib/demo-progress";
import { createFiveEDemo, demoDirectory, listDemos, updateMeta, type DemoMeta } from "@/lib/store";

const MAX_BYTES = 1024 * 1024 * 1024;
const MATCH_ID = /^g\d+(?:-[a-z]+)?-\d+$/i;

export class FiveEImportError extends Error {}

export function parseFiveEMatchId(input: string): string {
  const text = input.trim().replace(/\\:/g, ":");
  if (MATCH_ID.test(text)) return text;
  const link = text.match(/https?:\/\/[^\s<>]+/)?.[0];
  if (link && URL.canParse(link)) {
    const url = new URL(link);
    const matchId = url.searchParams.get("matchcode");
    if ((url.hostname === "5eplay.com" || url.hostname.endsWith(".5eplay.com")) && matchId && MATCH_ID.test(matchId)) {
      return matchId;
    }
  }
  throw new FiveEImportError("请粘贴包含 matchcode 的 5E 比赛分享链接。");
}

type ImportResult = { demo: DemoMeta; reused: boolean };
type ImportState = {
  running: Map<string, Promise<void>>;
  requests: Map<string, Promise<ImportResult>>;
};
const globalState = globalThis as typeof globalThis & { __chaipianFiveEImports?: ImportState };

function state(): ImportState {
  return globalState.__chaipianFiveEImports ??= { running: new Map(), requests: new Map() };
}

export function fiveEImportIsRunning(id: string): boolean {
  return state().running.has(id);
}

export function importFiveEDemo(input: string): Promise<ImportResult> {
  const matchId = parseFiveEMatchId(input);
  const requests = state().requests;
  const pending = requests.get(matchId);
  if (pending) return pending;
  const request = prepareImport(matchId).finally(() => requests.delete(matchId));
  requests.set(matchId, request);
  return request;
}

async function prepareImport(matchId: string): Promise<ImportResult> {
  const existing = (await listDemos()).find((demo) => demo.importedFrom?.platform === "5e" && demo.importedFrom.matchId === matchId);
  let demo = existing ?? await createFiveEDemo(matchId);
  if (demo.status === "error" && !fiveEImportIsRunning(demo.id)) {
    demo = await updateMeta(demo.id, { status: "downloading", error: null });
  }
  resumeFiveEImport(demo);
  return { demo, reused: Boolean(existing) };
}

export function resumeFiveEImport(demo: DemoMeta): void {
  if (!demo.importedFrom || (demo.status !== "downloading" && demo.status !== "extracting") || fiveEImportIsRunning(demo.id)) return;
  const jobs = state().running;
  const job = downloadAndAnalyze(demo).finally(() => jobs.delete(demo.id));
  jobs.set(demo.id, job);
}

export async function fiveEImportsIdle(): Promise<void> {
  await Promise.all(state().running.values());
}

async function resolveDemoUrl(matchId: string): Promise<string> {
  const response = await fetch(`https://gate.5eplay.com/crane/http/api/data/match/${matchId}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new FiveEImportError("暂时无法获取 5E 比赛信息，请稍后重新导入。");
  const body = await response.json() as { code: number; data?: { main?: { demo_url?: string } } };
  const value = body.data?.main?.demo_url;
  if (body.code !== 0 || !value) throw new FiveEImportError("这场 5E 比赛暂无可下载的录像，可能尚未生成或已经过期。");
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".5eplaycdn.com")) {
    throw new FiveEImportError("5E 返回的录像下载地址无效。");
  }
  return url.href;
}

async function downloadAndAnalyze(demo: DemoMeta): Promise<void> {
  const archivePath = path.join(demoDirectory(demo.id), "download.zip");
  const partialPath = path.join(demoDirectory(demo.id), "download.dem.part");
  let stage: "downloading" | "extracting" = "downloading";
  try {
    await updateMeta(demo.id, { status: stage, error: null });
    setDemoProgress(demo.id, { phase: stage, percent: null, message: "正在获取 5E 录像下载地址…" });
    const url = await resolveDemoUrl(demo.importedFrom!.matchId);
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) throw new FiveEImportError("5E 录像下载失败，文件可能已经过期，请稍后重新导入。");
    const total = Number(response.headers.get("content-length"));
    if (total > MAX_BYTES) {
      await response.body.cancel();
      throw new FiveEImportError("这场录像的下载文件超过 1 GB。");
    }
    let loaded = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        loaded += chunk.length;
        if (loaded > MAX_BYTES) return callback(new FiveEImportError("这场录像的下载文件超过 1 GB。"));
        setDemoProgress(demo.id, {
          phase: "downloading",
          percent: total > 0 ? loaded / total * 100 : null,
          message: "正在从 5E 下载比赛录像…",
        });
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as ReadableStream), meter, createWriteStream(archivePath));

    stage = "extracting";
    await updateMeta(demo.id, { status: stage });
    setDemoProgress(demo.id, { phase: stage, percent: null, message: "正在解压比赛录像…" });
    await extractFiveEDemo(archivePath, partialPath);
    const { size } = await stat(partialPath);
    await rename(partialPath, path.join(demoDirectory(demo.id), demo.storedName));
    await updateMeta(demo.id, { bytes: size, status: "analyzing", error: null });
    setDemoProgress(demo.id, { phase: "analyzing", percent: null, message: "正在解析录像，找出高光片段…" });
    startAnalysis(demo.id);
  } catch (error) {
    const message = error instanceof FiveEImportError ? error.message
      : stage === "extracting" ? "5E 录像解压失败，请重新导入这场比赛。"
        : "5E 录像下载没有完成，请检查网络后重新导入。";
    await updateMeta(demo.id, { status: "error", error: message });
    setDemoProgress(demo.id, { phase: "error", percent: null, message });
  } finally {
    await Promise.all([rm(archivePath, { force: true }), rm(partialPath, { force: true })]);
  }
}

export async function extractFiveEDemo(archivePath: string, targetPath: string): Promise<void> {
  const zip = await openPromise(archivePath);
  try {
    for await (const entry of zip.eachEntry()) {
      if (!entry.fileName.toLowerCase().endsWith(".dem")) continue;
      if (entry.uncompressedSize <= 0 || entry.uncompressedSize > MAX_BYTES) {
        throw new FiveEImportError("解压后的录像是空的，或超过 1 GB。");
      }
      const stream = await zip.openReadStreamPromise(entry);
      await pipeline(stream, createWriteStream(targetPath));
      return;
    }
    throw new FiveEImportError("5E 下载文件中没有 .dem 录像。");
  } finally {
    zip.close();
  }
}
