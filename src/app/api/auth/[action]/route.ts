import { connection } from "next/server";
import { AccountError, authenticate, changePassword, endSession } from "@/lib/account-store";
import { privateJson, requestPolicy, requireAccount, sessionResponse, sessionToken } from "@/lib/auth";

type Context = { params: Promise<{ action: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  if ((await context.params).action !== "session") return privateJson({}, { status: 404 });
  const user = requireAccount(request);
  return user instanceof Response ? user : privateJson({ user });
}

export async function POST(request: Request, context: Context) {
  const policy = requestPolicy(request);
  if (policy instanceof Response) return policy;
  const { action } = await context.params;
  if (action === "logout") {
    endSession(sessionToken(request));
    return sessionResponse(policy.secure, null);
  }
  const body = await request.json().catch(() => null);
  try {
    if (action === "login") {
      if (typeof body?.username !== "string" || typeof body.password !== "string") {
        return privateJson({ message: "请输入用户名和密码。" }, { status: 400 });
      }
      const result = await authenticate(body.username, body.password, policy.address);
      if (result.limited) return privateJson({ message: "登录尝试过多，请 15 分钟后重试。" }, { status: 429 });
      if (!result.account) return privateJson({ message: "用户名或密码不正确。" }, { status: 401 });
      endSession(sessionToken(request));
      return sessionResponse(policy.secure, result.account, result.token);
    }
    if (action === "password") {
      const user = requireAccount(request);
      if (user instanceof Response) return user;
      if (typeof body?.currentPassword !== "string" || typeof body.newPassword !== "string") {
        return privateJson({ message: "请输入当前密码和新密码。" }, { status: 400 });
      }
      if (!await changePassword(user, body.currentPassword, body.newPassword)) {
        return privateJson({ message: "当前密码不正确。" }, { status: 400 });
      }
      return sessionResponse(policy.secure, null);
    }
  } catch (error) {
    if (error instanceof AccountError) return privateJson({ message: error.message }, { status: 400 });
    throw error;
  }
  return privateJson({}, { status: 404 });
}
