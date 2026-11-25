import { describe, expect, it, vi } from "vitest";
import { recordingLogReader } from "@/lib/csdm-recording-log";

describe("CSDM recording phase", () => {
  it("only reads connection signals belonging to the task's output directory", () => {
    const notify = vi.fn();
    const read = recordingLogReader("E:/test/video-123/out", notify);
    const signal = "2026-11-25T04:37:00.493Z | DEBUG | server | WS:: game process socket connected";
    read(signal);
    read("  outputFolderPath: 'E:\\\\test\\\\other-job\\\\out',");
    read(signal);
    expect(notify).not.toHaveBeenCalled();
    read("  outputFolderPath: 'E:\\\\test\\\\video-123\\\\out\\\\sequence',");
    read(signal.replace("connected", "disconnected"));
    read(signal);
    read("2026-11-25T04:38:00.000Z | DEBUG | server | Generating video with parameters:");
    read(signal);
    expect(notify).toHaveBeenCalledExactlyOnceWith("2026-11-25T04:37:00.493Z");
  });
});
