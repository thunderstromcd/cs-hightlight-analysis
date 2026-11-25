import { connection } from "next/server";
import { privateJson, requireAccount } from "@/lib/auth";
import { findCsdm } from "@/lib/csdm";
import { EXPORT_WARNING } from "@/lib/export-progress";
import { RECORDER_NOT_READY_MESSAGE } from "@/lib/preset";

export async function GET(request: Request) {
  await connection();
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  const binary = await findCsdm();
  return privateJson({
    ready: Boolean(binary),
    message: binary
      ? "录像机就绪。导出时会在这台电脑上打开 CS2，并用 csdm 把勾选的片段合成一条 MP4。"
      : RECORDER_NOT_READY_MESSAGE,
    exportWarning: EXPORT_WARNING,
  });
}
