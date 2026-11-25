"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAccount } from "@/components/auth-boundary";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";

export default function Page() {
  const { user, endSession } = useAccount();
  const [pending, setPending] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [memberError, setMemberError] = useState("");
  const [created, setCreated] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>, accountCreation: boolean) {
    event.preventDefault();
    const form = event.currentTarget;
    const setError = accountCreation ? setMemberError : setPasswordError;
    setError("");
    setCreated("");
    setPending(accountCreation ? "member" : "password");
    try {
      const response = await api(accountCreation ? "/api/admin/users" : "/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.message);
        return;
      }
      form.reset();
      if (accountCreation) setCreated(`已开通账号 ${body.user.username}`);
      else {
        endSession();
        toast.success("密码已更换，请用新密码登录。");
      }
    } catch {
      setError("暂时无法连接拆片，请重试。");
    } finally {
      setPending("");
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="page-width subpage-list">
        <h1 className="subpage-title">账户设置</h1>
        <p className="mt-2 break-words text-muted-foreground">{user.username} · {user.role === "admin" ? "管理员" : "成员"}</p>
        <div className="settings-layout">
          <section aria-labelledby="password-title">
            <h2 id="password-title" className="text-xl font-semibold">更换密码</h2>
            <form className="account-form" onSubmit={(event) => void submit(event, false)}>
              <label>当前密码<Input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
              <label>新密码<Input name="newPassword" type="password" autoComplete="new-password" maxLength={128} required /></label>
              {passwordError && <p className="text-sm text-destructive" role="alert">{passwordError}</p>}
              <Button type="submit" disabled={Boolean(pending)}>{pending === "password" ? "正在保存…" : "保存密码"}</Button>
            </form>
          </section>
          {user.role === "admin" && <section aria-labelledby="member-title">
            <h2 id="member-title" className="text-xl font-semibold">开通账号</h2>
            <form className="account-form" onSubmit={(event) => void submit(event, true)}>
              <label>新用户名<Input name="username" autoComplete="off" autoCapitalize="none" maxLength={40} required /></label>
              <label>初始密码<Input name="password" type="password" autoComplete="new-password" maxLength={128} required /></label>
              {memberError && <p className="text-sm text-destructive" role="alert">{memberError}</p>}
              {created && <p className="break-words text-sm text-ct" role="status">{created}</p>}
              <Button type="submit" variant="outline" disabled={Boolean(pending)}>{pending === "member" ? "正在开通…" : "开通账号"}</Button>
            </form>
          </section>}
        </div>
      </main>
    </>
  );
}
