import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/account-store";
import type { Highlight } from "@/lib/highlights";
import type { MatchInput } from "@/lib/match";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DemoStatus = "uploading" | "downloading" | "extracting" | "analyzing" | "ready" | "error";

export type DemoMeta = {
  id: string;
  originalName: string;
  storedName: string;
  bytes: number;
  createdAt: string;
  status: DemoStatus;
  error: string | null;
  mapName: string | null;
  game: string | null;
  source: string | null;
  teamAName: string | null;
  teamBName: string | null;
  teamAScore: number | null;
  teamBScore: number | null;
  highlightCount: number | null;
  durationSeconds: number | null;
  tickrate: number | null;
  importedFrom?: { platform: "5e"; matchId: string };
};

export { dataDir };

export function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error("无效的编号");
}

export function demoDirectory(id: string): string {
  assertId(id);
  return path.join(dataDir(), "demos", id);
}

export function exportsRoot(): string {
  return path.join(dataDir(), "exports");
}

export function exportDirectory(id: string): string {
  assertId(id);
  return path.join(exportsRoot(), id);
}

export async function demoFilePath(id: string): Promise<string> {
  const meta = await readMeta(id);
  const dir = demoDirectory(id);
  if (meta?.storedName) return path.join(dir, meta.storedName);
  return path.join(dir, "match.dem");
}

export function newId(): string {
  return randomUUID();
}

export async function demoFileExists(id: string): Promise<boolean> {
  try {
    const file = await demoFilePath(id);
    await access(file);
    const info = await stat(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export const DEMO_FILE_MISSING_MESSAGE = "这场录像的原始文件已经不在了，没法重新分析。请重新上传录像。";

function sanitizeDemoName(originalName: string): string {
  const base = originalName.split(/[/\\]/).pop()?.trim() || "match.dem";
  const cleaned = base.replace(/[^\w.\- ()\u4e00-\u9fff]/g, "_").slice(0, 120);
  return cleaned.toLowerCase().endsWith(".dem") ? cleaned : `${cleaned}.dem`;
}

export async function createDemo(originalName: string, bytes: Buffer): Promise<DemoMeta> {
  const meta = newDemoMeta(originalName, bytes.length, "analyzing");
  await mkdir(demoDirectory(meta.id), { recursive: true });
  await writeFile(path.join(demoDirectory(meta.id), meta.storedName), bytes);
  await writeMeta(meta);
  return meta;
}

export async function createFiveEDemo(matchId: string): Promise<DemoMeta> {
  const meta = newDemoMeta(`5eplay_${matchId}.dem`, 0, "downloading");
  meta.importedFrom = { platform: "5e", matchId };
  meta.source = "5eplay";
  await writeMeta(meta);
  return meta;
}

function newDemoMeta(originalName: string, bytes: number, status: DemoStatus): DemoMeta {
  const id = newId();
  const storedName = sanitizeDemoName(originalName);
  return {
    id,
    originalName,
    storedName,
    bytes,
    createdAt: new Date().toISOString(),
    status,
    error: null,
    mapName: null,
    game: null,
    source: null,
    teamAName: null,
    teamBName: null,
    teamAScore: null,
    teamBScore: null,
    highlightCount: null,
    durationSeconds: null,
    tickrate: null,
  };
}

export async function readMeta(id: string): Promise<DemoMeta | null> {
  try {
    return JSON.parse(await readFile(path.join(demoDirectory(id), "meta.json"), "utf8")) as DemoMeta;
  } catch {
    return null;
  }
}

export async function writeMeta(meta: DemoMeta): Promise<void> {
  await mkdir(demoDirectory(meta.id), { recursive: true });
  await writeFile(path.join(demoDirectory(meta.id), "meta.json"), JSON.stringify(meta, null, 2));
}

export async function updateMeta(id: string, patch: Partial<DemoMeta>): Promise<DemoMeta> {
  const current = await readMeta(id);
  if (!current) throw new Error("找不到这场录像");
  const next = { ...current, ...patch, id: current.id };
  await writeMeta(next);
  return next;
}

export async function listDemos(): Promise<DemoMeta[]> {
  const root = path.join(dataDir(), "demos");
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const demos: DemoMeta[] = [];
  for (const name of names) {
    if (!ID_PATTERN.test(name)) continue;
    const meta = await readMeta(name);
    if (meta) demos.push(meta);
  }
  demos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return demos;
}

export async function writeAnalysis(id: string, match: MatchInput, highlights: Highlight[]): Promise<void> {
  const dir = demoDirectory(id);
  await writeFile(path.join(dir, "match.json"), JSON.stringify(match));
  await writeFile(path.join(dir, "highlights.json"), JSON.stringify(highlights));
}

export async function readMatch(id: string): Promise<MatchInput | null> {
  try {
    return JSON.parse(await readFile(path.join(demoDirectory(id), "match.json"), "utf8")) as MatchInput;
  } catch {
    return null;
  }
}

export async function readHighlights(id: string): Promise<Highlight[]> {
  try {
    return JSON.parse(await readFile(path.join(demoDirectory(id), "highlights.json"), "utf8")) as Highlight[];
  } catch {
    return [];
  }
}

export async function deleteDemo(id: string): Promise<void> {
  await rm(demoDirectory(id), { recursive: true, force: true });
}
