import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openAccount } from "@/app/api/admin/users/route";
import { GET as getSession, POST as accountAction } from "@/app/api/auth/[action]/route";
import { DELETE as removeDemo, GET as getDemo } from "@/app/api/demos/[id]/route";
import { PATCH as updateIdentity } from "@/app/api/demos/[id]/binding/route";
import { GET as getExport, POST as startExport } from "@/app/api/exports/route";
import { GET as getJob } from "@/app/api/exports/[id]/route";
import { GET as download } from "@/app/api/exports/[id]/file/route";
import { addLibraryEntry, authenticate, bootstrapAdmin, closeAccountDatabase, listLibrary } from "@/lib/account-store";
import { requestPolicy } from "@/lib/auth";
import { exportIdle, resetExportQueueForTests, setExportRuntime } from "@/lib/export-queue";
import type { Highlight } from "@/lib/highlights";
import { createDemo, updateMeta, writeAnalysis } from "@/lib/store";

vi.mock("next/server", () => ({ connection: async () => {} }));

const origin = "http://localhost";
const alice = "76561198000000001";
const bob = "76561198000000002";
const players = [{ steamId: alice, name: "甲" }, { steamId: bob, name: "乙" }];
const clip: Highlight = {
  id: "clip", kind: "triple", roundNumber: 1, steamId: alice, playerName: "甲", side: 2,
  teamName: "A", startTick: 1000, endTick: 1400, durationSeconds: 6, score: 64, tags: [], kills: [],
};

function request(route: string, method = "GET", cookie = "", body?: unknown) {
  return new Request(origin + route, { method, headers: { Origin: origin, Cookie: cookie }, body: JSON.stringify(body) });
}

const idContext = (id: string) => ({ params: Promise.resolve({ id }) });
const authContext = (action: string) => ({ params: Promise.resolve({ action }) });
const noLegacy = async () => ({ entries: [], exports: [] });

async function login(username: string, password: string) {
  return accountAction(request("/api/auth/login", "POST", "", { username, password }), authContext("login"));
}

function cookie(response: Response) {
  return response.headers.get("Set-Cookie")!.split(";")[0];
}

describe("账户与个人录像", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "chaipian-accounts-"));
    vi.stubEnv("DATA_DIR", directory);
  });
  afterEach(async () => {
    await exportIdle();
    resetExportQueueForTests();
    closeAccountDatabase();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("会话使用 HttpOnly Cookie，改密作废所有旧会话，成员无法开通账号", async () => {
    await bootstrapAdmin("admin", "a", noLegacy);
    const admin = await login("admin", "a");
    expect(admin.headers.get("Set-Cookie")).toContain("HttpOnly; SameSite=Lax");
    const newUser = { username: "member", password: "b" };
    expect((await openAccount(request("/api/admin/users", "POST", cookie(admin), newUser))).status).toBe(201);
    const first = cookie(await login("member", "b"));
    const second = cookie(await login("member", "b"));
    expect((await openAccount(request("/api/admin/users", "POST", first, newUser))).status).toBe(403);
    expect((await accountAction(request("/api/auth/password", "POST", first, {
      currentPassword: "b", newPassword: "c",
    }), authContext("password"))).status).toBe(200);
    for (const stale of [first, second]) {
      expect((await getSession(request("/api/auth/session", "GET", stale), authContext("session"))).status).toBe(401);
    }
    expect((await login("member", "b")).status).toBe(401);
    const next = cookie(await login("member", "c"));
    await accountAction(request("/api/auth/logout", "POST", next), authContext("logout"));
    expect((await getSession(request("/api/auth/session", "GET", next), authContext("session"))).status).toBe(401);
  });

  it("禁止外网明文和跨源写入，HTTPS 代理签发 Secure 会话", async () => {
    await bootstrapAdmin("admin", "a", noLegacy);
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://clips.example.com");
    expect(requestPolicy(new Request("http://clips.example.com/api/demos"))).toMatchObject({ status: 403 });
    expect(requestPolicy(new Request(origin, { method: "DELETE", headers: { Origin: "http://example.com" } }))).toMatchObject({ status: 403 });
    const response = await accountAction(new Request("http://clips.example.com/api/auth/login", {
      method: "POST",
      headers: { Origin: "https://clips.example.com", "X-Forwarded-Proto": "https" },
      body: JSON.stringify({ username: "admin", password: "a" }),
    }), authContext("login"));
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
  });

  it("同一用户名连续八次尝试后触发限流", async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      expect(await authenticate("missing", "guess", "local")).toMatchObject({ limited: false, account: null });
    }
    expect((await login("MISSING", "guess")).status).toBe(429);
  });

  it("账号分别绑定与导出，改选和跳过只影响当前比赛，移除后仍可下载", async () => {
    const assets = await Promise.all(["one", "two", "three", "four", "five"].map(async (name) => {
      const demo = await createDemo(`${name}.dem`, Buffer.from("demo"));
      await writeAnalysis(demo.id, { mapName: "de_mirage", players, checksum: name }, [clip]);
      await updateMeta(demo.id, { status: "ready", mapName: "de_mirage" });
      return demo;
    }));
    const admin = await bootstrapAdmin("admin", "a", async () => ({ entries: [assets[0]], exports: [] }));
    const retry = vi.fn(noLegacy);
    await expect(bootstrapAdmin("duplicate", "z", retry)).rejects.toThrow("已经创建");
    expect(retry).not.toHaveBeenCalled();
    const adminCookie = cookie(await login("admin", "a"));
    const memberResponse = await openAccount(request("/api/admin/users", "POST", adminCookie, { username: "member", password: "b" }));
    const member = (await memberResponse.json()).user;
    const memberCookie = cookie(await login("member", "b"));
    const adminEntries = [listLibrary(admin.id)[0], ...assets.slice(1).map((asset) => addLibraryEntry(admin.id, asset.id).entry)];
    const other = addLibraryEntry(member.id, assets[0].id).entry;
    const detail = (id: string, owner = adminCookie) => getDemo(request(`/api/demos/${id}`, "GET", owner), idContext(id));
    const bind = (id: string, steamId: string | null, makePreferred = false, owner = adminCookie) => updateIdentity(
      request(`/api/demos/${id}/binding`, "PATCH", owner, { steamId, makePreferred }), idContext(id),
    );
    expect((await detail(adminEntries[0].id, memberCookie)).status).toBe(404);
    expect((await bind(adminEntries[0].id, bob, false, memberCookie)).status).toBe(404);
    expect((await bind(adminEntries[0].id, alice)).status).toBe(200);
    expect((await bind(other.id, bob, false, memberCookie)).status).toBe(200);
    expect((await (await detail(adminEntries[1].id)).json()).binding.steamId).toBe(alice);
    await bind(adminEntries[1].id, bob);
    expect((await (await detail(adminEntries[2].id)).json()).binding.steamId).toBe(alice);
    await bind(adminEntries[2].id, bob, true);
    await bind(adminEntries[3].id, null);
    expect((await (await detail(adminEntries[3].id)).json()).binding.state).toBe("skipped");
    expect((await (await detail(adminEntries[4].id)).json()).binding.steamId).toBe(bob);
    expect((await (await detail(adminEntries[0].id)).json()).binding.steamId).toBe(alice);
    expect((await (await detail(other.id, memberCookie)).json()).binding.steamId).toBe(bob);

    setExportRuntime({
      findCsdm: async () => "fake-csdm",
      run: async (_binary, args) => {
        if (args[0] === "analyze") {
          return { code: 0, stdout: '{"analyzed":[{"demoPath":"match.dem"}],"skipped":[],"failed":[]}', stderr: "" };
        }
        const config = JSON.parse(await readFile(args[args.indexOf("--config-file") + 1], "utf8"));
        await writeFile(path.join(config.outputFolderPath, "highlights.mp4"), "mock mp4");
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const submit = (id: string, owner: string) => startExport(request("/api/exports", "POST", owner, { demoId: id, highlightIds: ["clip"] }));
    expect((await submit(adminEntries[0].id, memberCookie)).status).toBe(404);
    const [jobA, jobB] = await Promise.all([submit(adminEntries[0].id, adminCookie), submit(other.id, memberCookie)]);
    expect([jobA.status, jobB.status]).toEqual([202, 202]);
    const job = (await jobA.json()).job;
    expect(job).toMatchObject({ demoId: adminEntries[0].id, originalName: "one.dem", mapName: "de_mirage" });
    await exportIdle();
    const remove = await removeDemo(request(`/api/demos/${job.demoId}`, "DELETE", adminCookie), idContext(job.demoId));
    expect(remove.status).toBe(200);
    expect((await detail(other.id, memberCookie)).status).toBe(200);
    expect((await getJob(request(`/api/exports/${job.id}`, "GET", memberCookie), idContext(job.id))).status).toBe(404);
    const fileRoute = `/api/exports/${job.id}/file`;
    expect((await download(request(fileRoute, "GET", memberCookie), idContext(job.id))).status).toBe(404);
    expect(await (await download(request(fileRoute, "GET", adminCookie), idContext(job.id))).text()).toBe("mock mp4");
    const history = await getExport(request("/api/exports", "GET", adminCookie));
    expect((await history.json()).jobs).toMatchObject([{ id: job.id, status: "done", originalName: "one.dem" }]);
  });
});
