"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Download, Film, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, uploadDemo } from "@/lib/client";
import { formatBytes, formatWhen } from "@/lib/format";
import type { DemoProgress } from "@/lib/demo-progress";
import type { DemoStatus } from "@/lib/store";
import { cn } from "@/lib/utils";

type DemoCard = {
  id: string;
  originalName: string;
  bytes: number;
  createdAt: string;
  status: DemoStatus;
  error: string | null;
  mapName: string | null;
  teamAName: string | null;
  teamBName: string | null;
  teamAScore: number | null;
  teamBScore: number | null;
  highlightCount: number | null;
  progress?: DemoProgress;
};

export function HomeView({ library = false }: { library?: boolean }) {
  const router = useRouter();
  const [demos, setDemos] = useState<DemoCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [recorderReady, setRecorderReady] = useState<boolean | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [upload, setUpload] = useState<{ name: string; percent: number } | null>(null);
  const [fiveELink, setFiveELink] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DemoCard | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [demoResponse, recorderResponse] = await Promise.all([api(library ? "/api/demos" : "/api/demos?limit=2"), api("/api/recorder")]);
      if (demoResponse.ok) {
        const body = (await demoResponse.json()) as { demos: DemoCard[] };
        setDemos(body.demos);
      }
      if (recorderResponse.ok) {
        const body = (await recorderResponse.json()) as { ready: boolean };
        setRecorderReady(body.ready);
      }
    } catch {
      setError("暂时读不到录像库，请检查服务连接。");
    } finally {
      setLoaded(true);
    }
  }, [library]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!demos.some((demo) => demo.status === "analyzing" || demo.status === "downloading" || demo.status === "extracting")) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [demos, refresh]);

  async function uploadFile(file: File | undefined) {
    if (!file || upload || importing) return;
    setError(null);
    setUpload({ name: file.name, percent: 0 });
    try {
      const result = await uploadDemo(file, ({ percent }) => {
        setUpload({ name: file.name, percent });
      });
      if (!result.ok || !result.demo) {
        setUpload(null);
        setError(result.message ?? "上传失败。");
        return;
      }
      setUpload(null);
      router.push(`/demos/${(result.demo as DemoCard).id}`);
    } catch {
      setUpload(null);
      setError("上传没有完成。确认这是 .dem，并且服务还开着。");
    }
  }

  async function importFiveE() {
    if (importing || upload) return;
    setError(null);
    setImporting(true);
    try {
      const response = await api("/api/demos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: fiveELink }),
      });
      const body = await response.json() as { demo?: DemoCard; message?: string };
      if (!response.ok || !body.demo) {
        setError(body.message ?? "没有开始导入，请稍后重试。");
        return;
      }
      router.push(`/demos/${body.demo.id}`);
    } catch {
      setError("无法连接录像服务，请检查连接后重新导入。");
    } finally {
      setImporting(false);
    }
  }

  async function remove(demo: DemoCard) {
    const response = await api(`/api/demos/${demo.id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "没有删掉。");
      return;
    }
    setDemos((current) => current.filter((item) => item.id !== demo.id));
    setPendingDelete(null);
  }

  return (
    <div className="min-h-full">
      <SiteHeader ready={recorderReady} />
      <main className="page-width home-page">
        {!library && <section
          aria-labelledby="import-heading"
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            void uploadFile(event.dataTransfer.files[0]);
          }}
          className={cn(
            "import-surface",
            dragOver && "is-dragging",
            upload && "pointer-events-none",
          )}
        >
          {upload ? (
            <div className="relative z-10 min-w-0">
              <h1 id="import-heading" className="import-title">{upload.percent === 100 ? "正在保存录像" : "正在导入录像"}</h1>
              <p className="mt-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{upload.name}</p>
              <p className="mt-4 font-mono text-sm text-foreground">{upload.percent}%</p>
              <span
                className="analysis-track block max-w-md"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={upload.percent}
                aria-label="上传进度"
              >
                <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${upload.percent}%` }} />
              </span>
            </div>
          ) : (
            <div className="relative z-10 min-w-0">
              <div className="import-icon"><Film size={23} aria-hidden /></div>
              <h1 id="import-heading" className="import-title">从 5E 导入</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">粘贴比赛链接或完整分享文案，自动下载录像并找出高光。</p>
              <form className="mt-5 max-w-2xl" onSubmit={(event) => { event.preventDefault(); void importFiveE(); }}>
                <div className="import-form">
                  <Input id="five-e-link" value={fiveELink} onChange={(event) => setFiveELink(event.target.value)}
                    placeholder="粘贴 5E 比赛分享链接" aria-label="5E 比赛分享链接" disabled={importing} required className="min-w-0 flex-1" />
                  <Button type="submit" disabled={importing || !fiveELink.trim()}>
                    <Download size={17} aria-hidden />{importing ? "正在导入…" : "导入比赛"}
                  </Button>
                </div>
              </form>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button variant="ghost" size="sm" type="button" className="-ml-2" disabled={importing} onClick={() => fileInput.current?.click()}>
                  <Upload size={16} aria-hidden />上传本地录像
                </Button>
                <span className="text-sm text-muted-foreground">可拖入 .dem，最大 1 GB</span>
              </div>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".dem,application/octet-stream"
            hidden
            disabled={Boolean(upload) || importing}
            aria-label="选择 .dem 录像"
            onChange={(event) => {
              void uploadFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </section>}
        {error ? (
          <p className="text-base text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <section className={library ? "library-section subpage-list" : "library-section"} aria-labelledby="library-heading">
          <div className="flex items-baseline justify-between gap-4">
            {library ? <h1 id="library-heading" className="subpage-title">录像库</h1> : <h2 id="library-heading" className="text-xl font-semibold">最近导入</h2>}
            {library && loaded && <p className="text-sm text-muted-foreground">{demos.length} 场录像</p>}
          </div>
          {!loaded ? <LibrarySkeleton /> : null}
          {loaded && demos.length === 0 ? (
            <div className="empty-state"><Film size={22} aria-hidden /><p>暂无录像。导入后可在这里重新打开比赛。</p></div>
          ) : null}
          {loaded && demos.length > 0 ? (
            <ul className="mt-3 border-t border-border">
              {demos.map((demo) => (
                <DemoRow key={demo.id} demo={demo} onDelete={library ? () => setPendingDelete(demo) : undefined} />
              ))}
            </ul>
          ) : null}
        </section>
      </main>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="移除这场录像"
        description={pendingDelete ? `${pendingDelete.mapName ?? pendingDelete.originalName}将从你的录像库中移除。已导出的成片仍可在导出历史下载。` : undefined}
      >
        <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
          取消
        </Button>
        <Button type="button" variant="destructive" onClick={() => pendingDelete && void remove(pendingDelete)}>
          移除
        </Button>
      </Dialog>
    </div>
  );
}

function DemoRow({ demo, onDelete }: { demo: DemoCard; onDelete?: () => void }) {
  const titled = Boolean(demo.teamAName && demo.teamBName);
  return (
    <li className="border-b border-border last:border-b-0">
      <div className="library-row">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-lg font-semibold [overflow-wrap:anywhere]">{demo.mapName ?? demo.originalName}</h3>
          {titled && (
            <p className="mt-1 text-sm text-muted-foreground">
              {demo.teamAName} <span className="font-mono text-ct">{demo.teamAScore ?? 0}</span>
              {" : "}<span className="font-mono text-t">{demo.teamBScore ?? 0}</span> {demo.teamBName}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {demo.status === "analyzing" || demo.status === "downloading" || demo.status === "extracting" ? (
              <span>
                {demo.status === "downloading" ? "下载中" : demo.status === "extracting" ? "解压中" : "解析中"}
                {typeof demo.progress?.percent === "number" ? ` · ${demo.progress.percent}%` : ""}
                {demo.progress?.message ? ` · ${demo.progress.message}` : ""}
              </span>
            ) : demo.status === "error" ? (
              <span className="text-destructive">{demo.progress?.message || "录像解析失败。"}</span>
            ) : (
              <span>
                <span className="text-ct">已解析</span> · {demo.highlightCount ?? 0} 条高光
              </span>
            )}
          </p>
          <p className="mt-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {demo.mapName && <>{demo.originalName} · </>}
            {formatBytes(demo.bytes)}
            {" · "}
            {formatWhen(demo.createdAt)}
          </p>
          {demo.error && demo.status !== "error" ? <p className="mt-2 text-sm text-destructive">{plainError(demo.error)}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/demos/${demo.id}`} aria-label={`打开 ${demo.mapName ?? demo.originalName}，${formatWhen(demo.createdAt)}`}>
              打开 <ArrowUpRight size={15} aria-hidden />
            </Link>
          </Button>
          {onDelete && <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-11 items-center px-3 text-base text-muted-foreground transition-colors duration-200 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            移除
          </button>}
        </div>
      </div>
    </li>
  );
}

function plainError(message: string): string {
  if (/csdm|hlae|victimsteam|video\.json/i.test(message)) return "解析没有完成。";
  return message;
}

function LibrarySkeleton() {
  return (
    <div className="mt-3 border-t border-border" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex h-24 items-center border-b border-border px-4 last:border-b-0">
          <div className="h-4 w-2/3 max-w-sm rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
