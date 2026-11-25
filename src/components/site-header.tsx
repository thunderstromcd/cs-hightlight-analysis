"use client";

import Link from "next/link";
import { ChevronDown, CircleUser, ScanLine } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/auth-boundary";
import { useExportMonitor } from "@/components/export-monitor";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

export function SiteHeader({ ready, reanalysis }: {
  ready?: boolean | null;
  reanalysis?: { pending: boolean; open: (trigger: HTMLElement) => void };
} = {}) {
  const { user, endSession } = useAccount();
  const router = useRouter();
  const menu = useRef<HTMLDetailsElement>(null);
  const [error, setError] = useState("");
  const { reconnecting } = useExportMonitor();
  const label = reconnecting ? "导出状态重连中" : ready === null ? "正在检查" : ready ? "可以导出" : "暂时不能导出";
  async function logout() {
    try {
      const response = await api("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      router.replace("/");
      endSession();
    } catch {
      setError("暂时无法退出，请重试。");
    }
  }

  return (
    <header
      data-site-header
      className="site-header"
    >
      <div className="page-width site-header-content">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ScanLine size={20} className="text-accent" aria-hidden />
        <span className="text-xl font-semibold tracking-tight">拆片</span>
      </Link>
      <div className="flex items-center gap-3">
        {(ready !== undefined || reconnecting) && <p className="recorder-status inline-flex items-center gap-2 text-sm text-muted-foreground" role="status" title={label}>
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", reconnecting ? "bg-accent" : ready === null ? "bg-muted-foreground" : ready ? "bg-ct" : "bg-destructive")}
          />
          {label}
        </p>}
        <details ref={menu} className="account-menu" onKeyDown={(event) => {
          if (event.key === "Escape" && menu.current?.open) {
            menu.current.open = false;
            menu.current.querySelector("summary")?.focus();
          }
        }}>
          <summary aria-label={`用户菜单，${user.username}`}>
            <CircleUser size={17} aria-hidden /><span className="account-menu-name">{user.username}</span><ChevronDown size={14} aria-hidden />
          </summary>
          <nav aria-label="个人页面">
            <Link href="/library" onClick={() => { if (menu.current) menu.current.open = false; }}>录像库</Link>
            <Link href="/exports" onClick={() => { if (menu.current) menu.current.open = false; }}>导出历史</Link>
            <Link href="/account" onClick={() => { if (menu.current) menu.current.open = false; }}>账户设置</Link>
            {reanalysis && <button className="short-review-action" type="button" disabled={reanalysis.pending} onClick={() => {
              const panel = menu.current!;
              panel.open = false;
              reanalysis.open(panel.querySelector("summary")!);
            }}>重新分析本场</button>}
            <button type="button" onClick={() => void logout()}>退出登录</button>
            {error && <p className="px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
          </nav>
        </details>
      </div>
      </div>
    </header>
  );
}
