import { SESSION_MAX_AGE, sessionAccount, type Account } from "@/lib/account-store";

const SESSION_COOKIE = "chaipian_session";
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

export function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

export function requestPolicy(request: Request): { secure: boolean; address: string } | Response {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const proxiedHttps = request.headers.get("x-forwarded-proto") === "https";
  const configured = URL.parse(process.env.PUBLIC_APP_ORIGIN ?? "");
  const secure = Boolean(configured?.protocol === "https:" && host.toLowerCase() === configured.host
    && (proxiedHttps || url.protocol === "https:"));
  const local = !secure && !proxiedHttps && LOOPBACK.test(host);
  if (!local && !secure) {
    return privateJson({ error: "transport", message: "请通过已配置的 HTTPS 地址访问。" }, { status: 403 });
  }
  const origin = secure ? configured!.origin : `http://${host}`;
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== origin) {
    return privateJson({ error: "origin", message: "请在拆片页面内重新操作。" }, { status: 403 });
  }
  const address = secure ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "proxy" : "local";
  return { secure, address };
}

export function sessionToken(request: Request): string | undefined {
  return request.headers.get("cookie")?.match(/(?:^|;\s*)chaipian_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

export function requireAccount(request: Request): Account | Response {
  const policy = requestPolicy(request);
  if (policy instanceof Response) return policy;
  return sessionAccount(sessionToken(request)) ?? privateJson(
    { error: "unauthorized", message: "请登录拆片。" }, { status: 401 },
  );
}

export function sessionResponse(secure: boolean, user: Account | null, token?: string) {
  const cookie = `${SESSION_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSION_MAX_AGE : 0}${secure ? "; Secure" : ""}`;
  return privateJson({ user }, { headers: { "Set-Cookie": cookie } });
}
