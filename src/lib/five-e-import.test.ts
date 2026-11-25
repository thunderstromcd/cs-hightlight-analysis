import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analysisIdle, requestReanalyze, resetAnalysisForTests, setAnalysisRuntime } from "@/lib/analysis";
import { bootstrapAdmin, closeAccountDatabase, createMember, listLibrary, newSession } from "@/lib/account-store";
import * as progress from "@/lib/demo-progress";
import { extractFiveEDemo, fiveEImportsIdle, importFiveEDemo, parseFiveEMatchId, resumeFiveEImport } from "@/lib/five-e-import";
import { createFiveEDemo, demoDirectory, demoFilePath, listDemos, readHighlights, readMeta, updateMeta } from "@/lib/store";
import { DELETE } from "@/app/api/demos/[id]/route";
import { POST } from "@/app/api/demos/import/route";

const matchId = "g161-b-20261124220717909434665";
const link = `https://csgo.5eplay.com/app/share_loding_type11?domain=thunderstorm23&matchcode=${matchId}&uuid=abbfff05-dee2-11ea-a071-ec0d9a718678`;
const sharedText = `【5E对战平台：thunderstorm23的比赛详情页】${link}。`;
// ZIP 内含 nested/match.dem，内容为 PBDEMS2\0demo。
const archive = Buffer.from("UEsDBBQAAAAIALBueV3TX8/UDgAAAAwAAAAQAAAAbmVzdGVkL21hdGNoLmRlbQtwcnH1DTZiSEnNzQcAUEsBAhQAFAAAAAgAsG55XdNfz9QOAAAADAAAABAAAAAAAAAAAAAAAAAAAAAAAG5lc3RlZC9tYXRjaC5kZW1QSwUGAAAAAAEAAQA+AAAAPAAAAAAA", "base64");
const details = () => Response.json({ code: 0, data: { main: { demo_url: "https://cd-t-demo.5eplaycdn.com/test.zip" } } });
const download = () => new Response(new Uint8Array(archive), { headers: { "content-length": String(archive.length) } });

describe("5E 分享链接导入", () => {
  const originalDataDir = process.env.DATA_DIR;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "chaipian-five-e-"));
    process.env.DATA_DIR = directory;
    setAnalysisRuntime({
      analyze: vi.fn(async (_demoPath, outputFolder) => {
        await mkdir(outputFolder, { recursive: true });
        const jsonPath = path.join(outputFolder, "match.json");
        await copyFile(path.join(process.cwd(), "src/lib/fixtures/esplay-vertigo-excerpt.json"), jsonPath);
        return { jsonPath, log: "" };
      }),
    });
  });

  afterEach(async () => {
    await fiveEImportsIdle();
    await analysisIdle();
    resetAnalysisForTests();
    progress.resetDemoProgressForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    closeAccountDatabase();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    await rm(directory, { recursive: true, force: true });
  });

  it("从完整分享文案、转义链接和对局 ID 提取 matchcode", () => {
    expect(parseFiveEMatchId(sharedText)).toBe(matchId);
    expect(parseFiveEMatchId(link.replace("https:", "https\\:"))).toBe(matchId);
    expect(parseFiveEMatchId(matchId)).toBe(matchId);
    for (const invalid of ["", "https://%", "https://example.com/?matchcode=" + matchId, "https://csgo.5eplay.com/?domain=name"]) {
      expect(() => parseFiveEMatchId(invalid)).toThrow("5E 比赛分享链接");
    }
  });

  it("下载、解压并复用现有分析流程，同场并发提交只创建一条记录", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn().mockImplementationOnce(async () => { await gate; return details(); }).mockImplementationOnce(download);
    vi.stubGlobal("fetch", fetcher);
    const progressSpy = vi.spyOn(progress, "setDemoProgress");
    const [first, duplicate] = await Promise.all([importFiveEDemo(sharedText), importFiveEDemo(link)]);
    try {
      expect(first.demo.id).toBe(duplicate.demo.id);
      expect((await listDemos())).toHaveLength(1);
      expect((await readMeta(first.demo.id))?.status).toBe("downloading");
      expect(progress.getDemoProgress(first.demo).phase).toBe("downloading");
      expect(await requestReanalyze(first.demo.id)).toMatchObject({ ok: false, status: 409 });
    } finally { release(); }
    await fiveEImportsIdle();
    await analysisIdle();
    const meta = await readMeta(first.demo.id);
    expect(meta).toMatchObject({ status: "ready", bytes: 12, importedFrom: { platform: "5e", matchId } });
    expect(await readFile(await demoFilePath(first.demo.id), "utf8")).toBe("PBDEMS2\0demo");
    expect((await readHighlights(first.demo.id)).length).toBeGreaterThan(0);
    expect(await readdir(demoDirectory(first.demo.id))).not.toContain("download.zip");
    for (const phase of ["downloading", "extracting", "analyzing"]) {
      expect(progressSpy).toHaveBeenCalledWith(first.demo.id, expect.objectContaining({ phase }));
    }
    expect(fetcher.mock.calls[0][0]).toBe(`https://gate.5eplay.com/crane/http/api/data/match/${matchId}`);
    expect((await importFiveEDemo(link)).reused).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("录像不可用时保存错误，再次提交原链接复用记录重试", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ code: 0, data: { main: {} } }))
      .mockImplementationOnce(details).mockImplementationOnce(download));
    const first = await importFiveEDemo(link);
    await fiveEImportsIdle();
    expect(await readMeta(first.demo.id)).toMatchObject({ status: "error", error: expect.stringContaining("暂无可下载") });
    const retry = await importFiveEDemo(link);
    expect(retry.demo.id).toBe(first.demo.id);
    await fiveEImportsIdle();
    await analysisIdle();
    expect((await readMeta(first.demo.id))?.status).toBe("ready");
  });

  it.each([
    ["下载连接断开", () => Promise.reject(new Error("connection reset")), "下载没有完成"],
    ["下载响应失败", () => new Response(null, { status: 404 }), "下载失败"],
    ["压缩文件超过上限", () => new Response("", { headers: { "content-length": String(1024 ** 3 + 1) } }), "超过 1 GB"],
    ["文件不是 ZIP", () => new Response("not a zip"), "解压失败"],
  ])("%s 后结束任务并清理临时文件", async (_name, response, message) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(details).mockImplementationOnce(response));
    const { demo } = await importFiveEDemo(link);
    await fiveEImportsIdle();
    expect(await readMeta(demo.id)).toMatchObject({ status: "error", error: expect.stringContaining(message) });
    expect(await readdir(demoDirectory(demo.id))).toEqual(["meta.json"]);
  });

  it("服务恢复后重新下载中断的导入，重复恢复不会启动第二个任务", async () => {
    const pending = await createFiveEDemo(matchId);
    const interrupted = await updateMeta(pending.id, { status: "extracting" });
    const fetcher = vi.fn().mockImplementationOnce(details).mockImplementationOnce(download);
    vi.stubGlobal("fetch", fetcher);
    resumeFiveEImport(interrupted);
    resumeFiveEImport(interrupted);
    await fiveEImportsIdle();
    await analysisIdle();
    expect((await readMeta(pending.id))?.status).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("不向 5E CDN 以外的地址发起下载", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 0, data: { main: { demo_url: "http://127.0.0.1/internal.zip" } } }));
    vi.stubGlobal("fetch", fetcher);
    const { demo } = await importFiveEDemo(link);
    await fiveEImportsIdle();
    expect((await readMeta(demo.id))?.error).toContain("下载地址无效");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("解压时拒绝超大录像和不含录像的 ZIP", async () => {
    const oversized = Buffer.from(archive);
    const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    oversized.writeUInt32LE(1024 ** 3 + 1, central + 24);
    const archivePath = path.join(directory, "oversized.zip");
    const targetPath = path.join(directory, "match.dem");
    await writeFile(archivePath, oversized);
    await expect(extractFiveEDemo(archivePath, targetPath)).rejects.toThrow("超过 1 GB");
    const noDemo = Buffer.from(archive);
    let offset = noDemo.indexOf(".dem");
    while (offset !== -1) { noDemo.write(".txt", offset); offset = noDemo.indexOf(".dem", offset + 4); }
    await writeFile(archivePath, noDemo);
    await expect(extractFiveEDemo(archivePath, targetPath)).rejects.toThrow("没有 .dem");
  });

  it("同场为两个账号创建独立条目，复用一次下载和解析", async () => {
    const admin = await bootstrapAdmin("owner", "a", async () => ({ entries: [], exports: [] }));
    const member = await createMember("friend", "b");
    const adminCookie = `chaipian_session=${newSession(admin.id)}`;
    const memberCookie = `chaipian_session=${newSession(member.id)}`;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const request = (body: unknown, cookie = "") => new Request("http://localhost/api/demos/import", {
      method: "POST", headers: { Origin: "http://localhost", Cookie: cookie }, body: JSON.stringify(body),
    });
    expect((await POST(request({ link }))).status).toBe(401);
    expect((await POST(request({}, adminCookie))).status).toBe(400);
    expect((await POST(request({ link: "https://%" }, adminCookie))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const fetchReplay = vi.fn().mockImplementationOnce(details).mockImplementationOnce(download);
    vi.stubGlobal("fetch", fetchReplay);
    const [created, shared] = await Promise.all([POST(request({ link }, adminCookie)), POST(request({ link }, memberCookie))]);
    expect(created.status).toBe(201);
    expect(shared.status).toBe(201);
    const body = await created.json();
    const other = await shared.json();
    expect(body.demo.progress.phase).toBe("downloading");
    expect(body.demo.id).not.toBe(other.demo.id);
    const [asset] = await listDemos();
    expect(listLibrary(admin.id)[0].assetId).toBe(asset.id);
    expect(listLibrary(member.id)[0].assetId).toBe(asset.id);
    const remove = (cookie: string) => DELETE(new Request(`http://localhost/api/demos/${body.demo.id}`, {
      method: "DELETE", headers: { Origin: "http://localhost", Cookie: cookie },
    }), { params: Promise.resolve({ id: body.demo.id }) });
    expect((await remove(memberCookie)).status).toBe(404);
    expect((await remove(adminCookie)).status).toBe(200);
    await fiveEImportsIdle();
    await analysisIdle();
    expect(await readMeta(asset.id)).toMatchObject({ status: "ready" });
    expect((await POST(request({ link }, memberCookie))).status).toBe(200);
    expect(fetchReplay).toHaveBeenCalledTimes(2);
  });
});
