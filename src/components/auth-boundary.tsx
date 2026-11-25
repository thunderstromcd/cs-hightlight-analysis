"use client";

import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ScanLine } from "lucide-react";
import { toast } from "sonner";
import { ExportMonitorProvider } from "@/components/export-monitor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Account } from "@/lib/account-store";
import { api } from "@/lib/client";

const AccountContext = createContext<{ user: Account; endSession: () => void } | null>(null);

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("AuthBoundary is required");
  return value;
}

export function AuthBoundary({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Account | null | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const endSession = useCallback(() => {
    toast.dismiss();
    setUser(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let revision = 0;
    function expire() {
      revision++;
      endSession();
    }
    async function checkSession() {
      const current = ++revision;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (current !== revision || controller.signal.aborted) return;
        if (response.ok) setUser((previous) => {
          if (previous && previous.id !== data.user.id) queueMicrotask(() => toast.dismiss());
          return data.user;
        });
        else {
          setError(response.status === 401 ? "" : data.message);
          expire();
        }
      } catch {
        if (!controller.signal.aborted && current === revision) setUser((currentUser) => currentUser ?? null);
      }
    }
    void checkSession();
    window.addEventListener("focus", checkSession);
    window.addEventListener("chaipian-auth", expire);
    return () => {
      controller.abort();
      window.removeEventListener("focus", checkSession);
      window.removeEventListener("chaipian-auth", expire);
    };
  }, [endSession]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await api("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      const body = await response.json();
      if (response.ok) setUser(body.user);
      else setError(body.message);
    } catch {
      setError("暂时无法连接拆片。");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <AccountContext.Provider value={{ user, endSession }}>
        <ExportMonitorProvider key={user.id} userId={user.id}>{children}</ExportMonitorProvider>
      </AccountContext.Provider>
    );
  }

  return (
    <main className="login-page">
      <section className="login-content">
        <p className="flex items-center gap-2 font-semibold text-accent"><ScanLine size={23} aria-hidden />拆片</p>
        {user === undefined ? <p className="mt-6 text-muted-foreground" role="status">正在检查登录状态…</p> : (
          <>
            <h1 className="login-title">登录拆片</h1>
            <form className="account-form" onSubmit={login}>
              <label>用户名<Input name="username" autoComplete="username" autoCapitalize="none" maxLength={40} required /></label>
              <label>密码<Input type="password" name="password" autoComplete="current-password" maxLength={128} required /></label>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              <Button type="submit" disabled={busy}>{busy ? "登录中…" : "登录"}</Button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
