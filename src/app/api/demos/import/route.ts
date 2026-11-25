import { addLibraryEntry } from "@/lib/account-store";
import { privateJson, requireAccount } from "@/lib/auth";
import { FiveEImportError, importFiveEDemo } from "@/lib/five-e-import";
import { forLibraryEntry, toPublicDemo } from "@/lib/public-demo";

export async function POST(request: Request) {
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  let body: { link?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "import", message: "请提交 5E 比赛分享链接。" }, { status: 400 });
  }
  if (typeof body?.link !== "string" || !body.link.trim()) {
    return Response.json({ error: "import", message: "请粘贴 5E 比赛分享链接。" }, { status: 400 });
  }
  try {
    const { demo } = await importFiveEDemo(body.link);
    const { entry, added } = addLibraryEntry(user.id, demo.id);
    return privateJson({ demo: forLibraryEntry(await toPublicDemo(demo), entry), reused: !added }, { status: added ? 201 : 200 });
  } catch (error) {
    if (error instanceof FiveEImportError) {
      return Response.json({ error: "import", message: error.message }, { status: 400 });
    }
    throw error;
  }
}
