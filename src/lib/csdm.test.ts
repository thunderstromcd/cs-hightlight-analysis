import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVideoConfig, csdmProcess, findCsdm } from "@/lib/csdm";
import type { Highlight } from "@/lib/highlights";

function highlight(partial: Partial<Highlight>): Highlight {
  return {
    id: "double:1:1:100",
    kind: "double",
    roundNumber: 1,
    steamId: "76561198000000000",
    playerName: "Player",
    side: 2,
    teamName: "T",
    startTick: 1000,
    endTick: 2000,
    durationSeconds: 15,
    score: 32,
    tags: [],
    kills: [],
    ...partial,
  };
}

describe("csdm video config", () => {
  it("locks the hidden preset and orders clips into one concatenated MP4", () => {
    const config = buildVideoConfig({
      demoPath: "C:\\demos\\match.dem",
      outputFolderPath: "C:\\out",
      outputFileName: "highlights.mp4",
      highlights: [
        highlight({ id: "later", roundNumber: 8, startTick: 9000, endTick: 9400, playerName: "后", steamId: "22" }),
        highlight({
          id: "earlier", roundNumber: 2, startTick: 1500, endTick: 1800, playerName: "先", steamId: "11",
          kills: [{ tick: 1600, weaponName: "AK-47", victimName: "对手", victimSteamId: "21", isHeadshot: false }],
        }),
      ],
    });

    expect(config.width).toBe(1280);
    expect(config.height).toBe(720);
    expect(config.framerate).toBe(30);
    expect(config.concatenateSequences).toBe(true);
    expect(config.recordingSystem).toBe("CS");
    expect(config.encoderSoftware).toBe("FFmpeg");
    expect(config.ffmpegSettings.videoContainer).toBe("mp4");
    expect(config.closeGameAfterRecording).toBe(true);
    expect(config.keepRawFilesOnGameError).toBe(true);
    expect(config.sequences.map((sequence) => sequence.number)).toEqual([1, 2]);
    expect(config.sequences.map((sequence) => sequence.playerCameras[0]?.playerName)).toEqual(["先", "后"]);
    expect(config.sequences.every((sequence) => sequence.showOnlyDeathNotices)).toBe(true);
    expect(config.sequences.every((sequence) => sequence.showXRay === false)).toBe(true);
    expect(config.perspective).toBe("player");
    expect(config.sequences[0]?.playerCameras[0]).toEqual({
      tick: 1500,
      playerSteamId: "11",
      playerName: "先",
    });
  });

  it("places each victim replay directly after its killer POV and keeps chronological clip order", () => {
    const config = buildVideoConfig({
      demoPath: "C:\\demos\\match.dem",
      outputFolderPath: "C:\\out",
      outputFileName: "highlights.mp4",
      options: { showXRay: true, perspective: "enemy" },
      highlights: [
        highlight({
          id: "later", startTick: 4000, endTick: 5000, playerName: "后来者", steamId: "12",
          kills: [{ tick: 4500, weaponName: "AK-47", victimName: "对手", victimSteamId: "23", isHeadshot: false }],
        }),
        highlight({
          id: "triple",
          startTick: 1000,
          endTick: 3000,
          playerName: "击杀者",
          steamId: "11",
          kills: [
            { tick: 1400, weaponName: "AK-47", victimName: "甲", victimSteamId: "21", isHeadshot: false },
            { tick: 1800, weaponName: "AK-47", victimName: "乙", victimSteamId: "22", isHeadshot: true },
            { tick: 2000, weaponName: "AK-47", victimName: "丙", isHeadshot: false },
          ],
        }),
      ],
    });

    expect(config.perspective).toBe("enemy");
    expect(config.recordingSystem).toBe("CS");
    expect(config.trueView).toBe(false);
    expect(config.sequences.map(({ number, startTick, endTick, playerCameras }) => [
      number, startTick, endTick, playerCameras[0]?.playerSteamId,
    ])).toEqual([
      [1, 1000, 3000, "11"], [2, 1000, 3000, "21"],
      [3, 4000, 5000, "12"], [4, 4000, 5000, "23"],
    ]);
    expect(config.sequences.every((sequence) => sequence.showXRay)).toBe(true);
    expect(config.sequences[0]?.showAssists).toBe(true);
    expect(config.sequences[0]?.recordAudio).toBe(true);
    expect(config.sequences[0]?.playerVoicesEnabled).toBe(false);
    expect(config.sequences[0]?.deathNoticesDuration).toBe(5);
    expect(config.sequences[0]?.playersOptions[0]).toMatchObject({ steamId: "11", playerName: "击杀者" });
    expect(config.sequences[1]?.playerCameras).toEqual([
      { tick: 1000, playerSteamId: "21", playerName: "甲" },
      { tick: 1600, playerSteamId: "22", playerName: "乙" },
    ]);
  });

  it("keeps a clip without a victim POV exactly once", () => {
    const config = buildVideoConfig({
      demoPath: "C:\\demos\\match.dem",
      outputFolderPath: "C:\\out",
      outputFileName: "highlights.mp4",
      options: { showXRay: false, perspective: "enemy" },
      highlights: [
        highlight({
          id: "ninja",
          kind: "ninja",
          startTick: 500,
          endTick: 800,
          playerName: "拆弹手",
          steamId: "11",
          kills: [{ tick: 700, weaponName: "未知武器", victimName: "未知", isHeadshot: false }],
        }),
      ],
    });

    expect(config.perspective).toBe("enemy");
    expect(config.sequences).toHaveLength(1);
    expect(config.sequences[0]?.showXRay).toBe(false);
    expect(config.sequences[0]?.playerCameras).toEqual([
      { tick: 500, playerSteamId: "11", playerName: "拆弹手" },
    ]);
  });
});

describe("findCsdm", () => {
  it("uses CSDM_PATH, then PATH, and otherwise reports the recorder missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "csdm-"));
    const binary = path.join(dir, "csdm");
    await writeFile(binary, "");

    await expect(findCsdm({ env: { CSDM_PATH: binary }, which: async () => null })).resolves.toBe(binary);
    await expect(findCsdm({ env: { CSDM_PATH: path.join(dir, "missing") }, which: async () => binary })).resolves.toBe(binary);
    await expect(findCsdm({ env: {}, which: async () => null })).resolves.toBeNull();
  });
});

describe("csdmProcess", () => {
  it("runs official Windows csdm.cmd through the Electron exe as Node", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "csdm-cmd-"));
    const cmd = path.join(dir, "csdm.cmd");
    const exe = path.join(dir, "cs-demo-manager.exe");
    const cli = path.join(dir, "resources", "app.asar", "cli.js");
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cmd, "");
    await writeFile(exe, "");
    await writeFile(cli, "");
    const launch = csdmProcess(cmd, ["video", "--config-file", "video.json"], { PATH: "C:\\Windows" }, { platform: "win32" });
    expect(launch.command).toBe(exe);
    expect(launch.args).toEqual([cli, "video", "--config-file", "video.json"]);
    expect(launch.shell).toBe(false);
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("falls back to a shell when a cmd file has no sibling Electron exe", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "csdm-cmd-bare-"));
    const cmd = path.join(dir, "csdm.cmd");
    await writeFile(cmd, "");
    const launch = csdmProcess(cmd, ["analyze", "match.dem"], process.env, { platform: "win32" });
    expect(launch.command).toBe(cmd);
    expect(launch.args).toEqual(["analyze", "match.dem"]);
    expect(launch.shell).toBe(true);
  });
});
