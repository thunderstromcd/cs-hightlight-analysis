import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { perspectivesForClip, type ExportOptions, type ExportPerspective } from "@/lib/export-options";
import type { Highlight } from "@/lib/highlights";
import { highlightVictimPerspectiveAvailable } from "@/lib/perspective";
import { RECORDING_PRESET } from "@/lib/preset";

export type VideoSequence = {
  number: number;
  startTick: number;
  endTick: number;
  showXRay: boolean;
  showAssists: true;
  showOnlyDeathNotices: true;
  playersOptions: Array<{
    playerName: string;
    steamId: string;
    showKill: true;
    highlightKill: true;
    isVoiceEnabled: false;
  }>;
  playerCameras: Array<{ tick: number; playerSteamId: string; playerName: string }>;
  cameras: [];
  playerVoicesEnabled: false;
  recordAudio: true;
  deathNoticesDuration: 5;
};

export type VideoConfig = {
  demoPath: string;
  outputFolderPath: string;
  outputFileName: string;
  recordingSystem: typeof RECORDING_PRESET.recordingSystem;
  recordingOutput: typeof RECORDING_PRESET.recordingOutput;
  encoderSoftware: typeof RECORDING_PRESET.encoderSoftware;
  framerate: typeof RECORDING_PRESET.framerate;
  width: typeof RECORDING_PRESET.width;
  height: typeof RECORDING_PRESET.height;
  closeGameAfterRecording: true;
  keepRawFilesOnGameError: true;
  concatenateSequences: true;
  trueView: false;
  ffmpegSettings: {
    audioBitrate: 160;
    constantRateFactor: 23;
    customLocationEnabled: false;
    customExecutableLocation: "";
    videoContainer: typeof RECORDING_PRESET.videoContainer;
    videoCodec: "libx264";
    audioCodec: "aac";
    inputParameters: "";
    outputParameters: "";
  };
  sequences: VideoSequence[];
  perspective: ExportPerspective;
};

export function resolveExportOptions(options?: { showXRay?: boolean; perspective?: ExportPerspective }): ExportOptions {
  return {
    showXRay: options?.showXRay === true,
    perspective: options?.perspective === "enemy" ? "enemy" : "player",
  };
}

function usableSteamId(value: string | undefined): string | null {
  const id = (value ?? "").trim();
  if (!id || id === "0") return null;
  return id;
}

export function camerasForHighlight(
  highlight: Highlight,
  perspective: ExportPerspective,
): Array<{ tick: number; playerSteamId: string; playerName: string }> {
  if (perspective === "enemy") {
    const victims = (highlight.kills ?? [])
      .map((kill) => {
        const playerSteamId = usableSteamId(kill.victimSteamId);
        if (!playerSteamId) return null;
        return {
          tick: kill.tick,
          playerSteamId,
          playerName: kill.victimName || "未知",
        };
      })
      .filter((item): item is { tick: number; playerSteamId: string; playerName: string } => Boolean(item));
    if (victims.length > 0) {
      const cameras = [
        {
          tick: highlight.startTick,
          playerSteamId: victims[0].playerSteamId,
          playerName: victims[0].playerName,
        },
      ];
      for (let index = 1; index < victims.length; index += 1) {
        const midpoint = Math.round((victims[index - 1].tick + victims[index].tick) / 2);
        cameras.push({
          tick: Math.min(highlight.endTick, Math.max(highlight.startTick, midpoint)),
          playerSteamId: victims[index].playerSteamId,
          playerName: victims[index].playerName,
        });
      }
      return cameras;
    }
  }
  return [
    {
      tick: highlight.startTick,
      playerSteamId: highlight.steamId,
      playerName: highlight.playerName,
    },
  ];
}

export function buildVideoConfig(input: {
  demoPath: string;
  outputFolderPath: string;
  outputFileName: string;
  highlights: Highlight[];
  options?: { showXRay?: boolean; perspective?: ExportPerspective };
}): VideoConfig {
  const options = resolveExportOptions(input.options);
  const ordered = [...input.highlights].sort(
    (a, b) => a.roundNumber - b.roundNumber || a.startTick - b.startTick,
  );
  const takes = ordered.flatMap((highlight) =>
    perspectivesForClip(options.perspective, highlightVictimPerspectiveAvailable(highlight))
      .map((perspective) => ({ highlight, perspective })),
  );
  return {
    demoPath: input.demoPath,
    outputFolderPath: input.outputFolderPath,
    outputFileName: input.outputFileName,
    recordingSystem: RECORDING_PRESET.recordingSystem,
    recordingOutput: RECORDING_PRESET.recordingOutput,
    encoderSoftware: RECORDING_PRESET.encoderSoftware,
    framerate: RECORDING_PRESET.framerate,
    width: RECORDING_PRESET.width,
    height: RECORDING_PRESET.height,
    closeGameAfterRecording: true,
    keepRawFilesOnGameError: true,
    concatenateSequences: true,
    trueView: false,
    ffmpegSettings: {
      audioBitrate: 160,
      constantRateFactor: 23,
      customLocationEnabled: false,
      customExecutableLocation: "",
      videoContainer: RECORDING_PRESET.videoContainer,
      videoCodec: "libx264",
      audioCodec: "aac",
      inputParameters: "",
      outputParameters: "",
    },
    perspective: options.perspective,
    sequences: takes.map(({ highlight, perspective }, index) => ({
      number: index + 1,
      startTick: highlight.startTick,
      endTick: highlight.endTick,
      showXRay: options.showXRay,
      showAssists: true,
      showOnlyDeathNotices: true,
      playersOptions: [
        {
          playerName: highlight.playerName,
          steamId: highlight.steamId,
          showKill: true,
          highlightKill: true,
          isVoiceEnabled: false,
        },
      ],
      playerCameras: camerasForHighlight(highlight, perspective),
      cameras: [],
      playerVoicesEnabled: false,
      recordAudio: true,
      deathNoticesDuration: 5,
    })),
  };
}


export type ProcessEnvLike = Record<string, string | undefined>;

export type CsdmProcess = {
  command: string;
  args: string[];
  env: ProcessEnvLike;
  shell: boolean;
};

// Node on Windows refuses to spawn .cmd/.bat without a shell (EINVAL).
// Official CDM ships csdm.cmd, which just runs the Electron exe as Node.
export function csdmProcess(
  binary: string,
  args: string[],
  env: ProcessEnvLike = process.env,
  options?: { platform?: NodeJS.Platform },
): CsdmProcess {
  const platform = options?.platform ?? process.platform;
  if (platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    const dir = path.dirname(binary);
    const exe = path.join(dir, "cs-demo-manager.exe");
    const cli = path.join(dir, "resources", "app.asar", "cli.js");
    if (existsSync(exe) && existsSync(cli)) {
      return {
        command: exe,
        args: [cli, ...args],
        env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
        shell: false,
      };
    }
    return { command: binary, args, env: { ...env }, shell: true };
  }
  return { command: binary, args, env: { ...env }, shell: false };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function whichCommand(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(process.platform === "win32" ? "where" : "which", [name], (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const line = stdout
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean);
      resolve(line ?? null);
    });
  });
}

export async function findCsdm(options?: {
  env?: ProcessEnvLike;
  which?: (name: string) => Promise<string | null>;
}): Promise<string | null> {
  const env = options?.env ?? process.env;
  const which = options?.which ?? whichCommand;
  const fromEnv = env.CSDM_PATH?.trim();
  if (fromEnv && (await exists(fromEnv))) return fromEnv;
  const onPath = await which("csdm");
  if (onPath && (await exists(onPath))) return onPath;
  if (process.platform === "win32" && env.LOCALAPPDATA) {
    const candidates = [
      path.join(env.LOCALAPPDATA, "Programs", "cs-demo-manager", "csdm.cmd"),
      path.join(env.LOCALAPPDATA, "Programs", "CS Demo Manager", "csdm.exe"),
    ];
    for (const installed of candidates) {
      if (await exists(installed)) return installed;
    }
  }
  return null;
}
