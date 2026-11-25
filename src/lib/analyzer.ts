import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

export type AnalyzerHooks = {
  onOutput?: (chunk: string) => void;
};

export async function runAnalyzer(
  demoPath: string,
  outputFolder: string,
  source?: string,
  hooks?: AnalyzerHooks,
): Promise<{ jsonPath: string; log: string }> {
  const { analyzeDemo, DemoSource, ExportFormat } = await import("@akiver/cs-demo-analyzer");
  const lines: string[] = [];
  const collect = (data: unknown) => {
    const chunk = String(data);
    lines.push(chunk);
    hooks?.onOutput?.(chunk);
  };
  await mkdir(outputFolder, { recursive: true });
  const knownSource = Object.values(DemoSource).find((value) => value === source);
  try {
    await analyzeDemo({
      demoPath,
      outputFolderPath: outputFolder,
      format: ExportFormat.JSON,
      ...(knownSource ? { source: knownSource } : {}),
      analyzePositions: false,
      minify: true,
      onStdout: collect,
      onStderr: collect,
    });
  } catch {
    throw new Error(lines.join("").trim() || "解析器没有成功退出。");
  }
  const jsonPath = await findAnalysisJson(outputFolder);
  if (!jsonPath) throw new Error(lines.join("").trim() || "解析完成，但没有找到 JSON。");
  return { jsonPath, log: lines.join("") };
}

async function findAnalysisJson(folder: string): Promise<string | null> {
  const entries = await readdir(folder);
  const files = entries.filter((name) => name.endsWith(".json") && !name.endsWith(".tmp"));
  if (files.length === 0) return null;
  const ranked = await Promise.all(
    files.map(async (name) => {
      const full = path.join(folder, name);
      const info = await stat(full);
      return { full, mtime: info.mtimeMs };
    }),
  );
  ranked.sort((a, b) => b.mtime - a.mtime);
  return ranked[0]?.full ?? null;
}
