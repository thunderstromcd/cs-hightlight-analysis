import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export function csdmLogPath() {
  return path.join(homedir(), ".csdm", "logs", "csdm.log");
}

export function recordingLogReader(outputFolder: string, onRecording: (observedAt: string) => void) {
  const normalize = (value: string) => value.replace(/[\\/]+/g, "/").toLowerCase();
  const folder = normalize(outputFolder);
  let matching = false;

  return (line: string) => {
    if (line.includes("Generating video with parameters:")) matching = false;
    const target = line.match(/^\s*outputFolderPath:\s*(['"])(.*)\1,?\s*$/);
    if (target) {
      const reported = normalize(target[2]);
      matching = reported === folder || reported.startsWith(`${folder}/`);
    }
    if (!matching || !line.includes("WS:: game process socket connected")) return;
    const timestamp = line.split(" | ", 1)[0];
    if (Number.isFinite(Date.parse(timestamp))) onRecording(timestamp);
  };
}

export async function watchCsdmRecording(outputFolder: string, onRecording: (observedAt: string) => void) {
  const log = csdmLogPath();
  let offset = (await stat(log).catch(() => null))?.size ?? 0;
  let decoder = new StringDecoder("utf8");
  let tail = "";
  let reading: Promise<void> | null = null;
  const consumeLine = recordingLogReader(outputFolder, onRecording);

  async function scan() {
    const file = await open(log, "r").catch(() => null);
    if (!file) return;
    try {
      const { size } = await file.stat();
      if (size < offset) {
        offset = 0;
        tail = "";
        decoder = new StringDecoder("utf8");
      }
      const buffer = Buffer.alloc(Math.min(64 * 1024, size - offset));
      while (offset < size) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        const lines = (tail + decoder.write(buffer.subarray(0, bytesRead))).split(/\r?\n/);
        tail = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      }
    } catch {
      // The daemon may rotate its local log while a recording is starting.
    } finally {
      await file.close();
    }
  }

  const timer = setInterval(() => {
    if (!reading) reading = scan().finally(() => { reading = null; });
  }, 500);
  return async () => {
    clearInterval(timer);
    await reading;
    await scan();
  };
}
