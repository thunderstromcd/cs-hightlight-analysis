import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { bootstrapAdmin, closeAccountDatabase, dataDir, hasAccounts } from "../src/lib/account-store.ts";

const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const root = dataDir();

async function legacyRecords(folder, file) {
  const directory = path.join(root, folder);
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return (await Promise.all(entries.filter((item) => item.isDirectory() && idPattern.test(item.name)).map(async (item) => {
    try {
      return { ...JSON.parse(await readFile(path.join(directory, item.name, file), "utf8")), id: item.name };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }))).filter(Boolean);
}

async function backupAndReadLegacy() {
  const [entries, exports] = await Promise.all([legacyRecords("demos", "meta.json"), legacyRecords("exports", "job.json")]);
  if (entries.length || exports.length) {
    const backup = path.join(root, "backups", `before-accounts-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    await mkdir(backup, { recursive: true });
    await Promise.all(["demos", "exports"].map((folder) => cp(path.join(root, folder), path.join(backup, folder), { recursive: true }).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    })));
    console.log(`已备份旧录像和成片到 ${backup}`);
  }
  const demoById = new Map(entries.map((demo) => [demo.id, demo]));
  return {
    entries,
    exports: exports.map((job) => ({
      id: job.id,
      entryId: job.demoId,
      originalName: demoById.get(job.demoId)?.originalName ?? job.outputName,
      mapName: demoById.get(job.demoId)?.mapName ?? null,
    })),
  };
}

async function readPassword() {
  if (process.env.CHAIPIAN_ADMIN_PASSWORD) return process.env.CHAIPIAN_ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new Error("请在终端交互输入密码，或通过 CHAIPIAN_ADMIN_PASSWORD 环境变量传入。");
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: silent, terminal: true });
  try {
    process.stdout.write("管理员密码：");
    return await input.question("");
  } finally {
    input.close();
    process.stdout.write("\n");
  }
}

try {
  const username = process.argv[2];
  if (!username) throw new Error("用法：npm run account:admin -- 管理员用户名");
  if (hasAccounts()) throw new Error("首个管理员已经创建。");
  const admin = await bootstrapAdmin(username, await readPassword(), backupAndReadLegacy);
  console.log(`已创建管理员 ${admin.username}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  closeAccountDatabase();
}
