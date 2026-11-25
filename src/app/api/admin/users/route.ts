import { AccountError, createMember } from "@/lib/account-store";
import { privateJson, requireAccount } from "@/lib/auth";

export async function POST(request: Request) {
  const user = requireAccount(request);
  if (user instanceof Response) return user;
  if (user.role !== "admin") return privateJson({ message: "只有管理员可以开通账号。" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.username !== "string" || typeof body.password !== "string") {
    return privateJson({ message: "请输入新账号的用户名和密码。" }, { status: 400 });
  }
  try {
    return privateJson({ user: await createMember(body.username, body.password) }, { status: 201 });
  } catch (error) {
    if (error instanceof AccountError) return privateJson({ message: error.message }, { status: 400 });
    throw error;
  }
}
