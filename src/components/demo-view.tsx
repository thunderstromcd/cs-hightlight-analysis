"use client";

import Link from "next/link";
import { ArrowLeft, Film, ListVideo, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useExportMonitor } from "@/components/export-monitor";
import { ExportResults } from "@/components/export-results";
import { PlayerPicker } from "@/components/player-picker";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client";
import { exportDurationSeconds, type ExportPerspective, type ExportRequestBody } from "@/lib/export-options";
import type { PublicExportJob } from "@/lib/export-queue";
import { formatClock, formatWhen, sideName } from "@/lib/format";
import type { FrequentPlayer } from "@/lib/frequent-players";
import type { DemoPhase } from "@/lib/demo-progress";
import type { DemoMeta, DemoStatus } from "@/lib/store";
import { highlightDetail, highlightGroup, highlightLabel, type Highlight } from "@/lib/highlights";
import type { PlayerSummary } from "@/lib/match";
import { VICTIM_PERSPECTIVE_NEEDS_REANALYZE, type PublicHighlight } from "@/lib/perspective";
import { cn } from "@/lib/utils";

type ProgressInfo = {
  phase?: DemoPhase;
  percent?: number | null;
  message?: string | null;
};

type VictimPerspective = {
  available?: boolean;
  message?: string | null;
};

type Reanalysis = {
  inProgress?: boolean;
  highlightsPreserved?: boolean;
  highlightIdsChanged?: boolean;
  droppedHighlightIds?: string[];
  message?: string | null;
};

type DemoPayload = {
  demo: {
    id: string;
    originalName: string;
    status: DemoStatus;
    importedFrom?: DemoMeta["importedFrom"];
    error: string | null;
    createdAt: string;
    progress?: ProgressInfo;
    victimPerspective?: VictimPerspective;
  };
  match: {
    mapName: string;
    game: string;
    source: string;
    date: string;
    durationSeconds: number | null;
    tickrate: number;
    teamA: { name: string; score: number; letter: string };
    teamB: { name: string; score: number; letter: string };
    players: PlayerSummary[];
  } | null;
  highlights: PublicHighlight[];
  frequentPlayers: FrequentPlayer[];
  binding: { state: "pending" | "selected" | "skipped"; steamId: string | null };
  reanalysis?: Reanalysis;
};

type Filter = "all" | "multi" | "clutch" | "special";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "multi", label: "多杀" },
  { id: "clutch", label: "残局" },
  { id: "special", label: "特殊" },
];

export function DemoView({ id }: { id: string }) {
  const [payload, setPayload] = useState<DemoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<{ ready: boolean; exportWarning?: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [viewPlayer, setPlayerId] = useState<string | null>(null);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => readSelection(id));
  const { jobs, reconnecting, watch, track } = useExportMonitor();
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showXRay, setShowXRay] = useState(false);
  const [victimPerspective, setVictimPerspective] = useState(false);
  const [exportConfirm, setExportConfirm] = useState(false);
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const reanalyzeTrigger = useRef<HTMLElement>(null);

  function openReanalysis(trigger: HTMLElement) {
    reanalyzeTrigger.current = trigger;
    setReanalyzeOpen(true);
  }

  function updateSelected(next: Set<string>) {
    setSelected(next);
    sessionStorage.setItem(`chaipian-selection:${id}`, JSON.stringify([...next]));
  }

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    async function load() {
      try {
        const response = await api(`/api/demos/${id}`);
        if (stop) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          if (!stop) setError(plainText(body?.message, "读不到这场录像。"));
          return;
        }
        const body = (await response.json()) as DemoPayload;
        if (stop) return;
        setPayload(body);
        setError(null);
        if (body.reanalysis?.droppedHighlightIds?.length) {
          const next = readSelection(id);
          for (const dropped of body.reanalysis.droppedHighlightIds) next.delete(dropped);
          sessionStorage.setItem(`chaipian-selection:${id}`, JSON.stringify([...next]));
          setSelected(next);
        }
        if (body.demo.status === "downloading" || body.demo.status === "extracting" || body.demo.status === "analyzing" || body.reanalysis?.inProgress) timer = window.setTimeout(load, 2000);
      } catch {
        if (!stop) {
          setError("正在重新连接录像服务…");
          timer = window.setTimeout(load, 2000);
        }
      }
    }
    void load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [id, analysisRevision]);

  useEffect(() => {
    void api("/api/recorder").then(async (response) => {
      if (response.ok) setRecorder((await response.json()) as { ready: boolean; exportWarning?: string });
    }).catch(() => {});
  }, []);

  useEffect(() => watch(id), [id, watch]);

  const highlights = useMemo(() => payload?.highlights ?? [], [payload]);
  const mySteamId = payload?.match?.players.find((player) => player.steamId === payload.binding.steamId)?.steamId ?? null;
  const playerId = viewPlayer ?? mySteamId ?? "all";
  const victimReady = payload ? Boolean(payload.demo.victimPerspective?.available) : false;
  const victimUnavailableText = payload?.demo.victimPerspective?.message || VICTIM_PERSPECTIVE_NEEDS_REANALYZE;
  const filtered = useMemo(() => {
    return highlights.filter((item) => {
      if (playerId !== "all" && item.steamId !== playerId) return false;
      if (filter === "all") return true;
      return highlightGroup(item.kind) === filter;
    });
  }, [filter, highlights, playerId]);
  const counts = useMemo(() => {
    const inPlayer = highlights.filter((item) => playerId === "all" || item.steamId === playerId);
    return {
      all: inPlayer.length,
      multi: inPlayer.filter((item) => highlightGroup(item.kind) === "multi").length,
      clutch: inPlayer.filter((item) => highlightGroup(item.kind) === "clutch").length,
      special: inPlayer.filter((item) => highlightGroup(item.kind) === "special").length,
    };
  }, [highlights, playerId]);

  const selectedHighlights = highlights.filter((item) => selected.has(item.id));
  const selectedSeconds = selectedHighlights.reduce((sum, item) => sum + item.durationSeconds, 0);
  const selectedCanReplay = victimReady && selectedHighlights.some((item) => item.victimPerspectiveAvailable);
  const exportPerspective: ExportPerspective = selectedCanReplay && victimPerspective ? "enemy" : "player";
  const videoSeconds = exportDurationSeconds(selectedHighlights, exportPerspective, (item) => item.victimPerspectiveAvailable);
  const visibleAllSelected = filtered.length > 0 && filtered.every((item) => selected.has(item.id));
  const rounds = Map.groupBy(filtered, (item) => item.roundNumber);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [filter, playerId]);

  async function setIdentity(steamId: string | null, makePreferred = false) {
    setBindingBusy(true);
    try {
      const response = await api(`/api/demos/${id}/binding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId, makePreferred }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setPayload((previous) => previous && { ...previous, binding: body.binding });
      setPlayerId(null);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "身份更新失败，请重试。");
    } finally {
      setBindingBusy(false);
    }
  }

  function toggle(highlightId: string) {
    const next = new Set(selected);
    if (next.has(highlightId)) next.delete(highlightId);
    else next.add(highlightId);
    updateSelected(next);
  }

  function toggleVisible() {
    const ids = filtered.map((item) => item.id);
    const allOn = ids.length > 0 && ids.every((item) => selected.has(item));
    const next = new Set(selected);
    for (const item of ids) {
      if (allOn) next.delete(item);
      else next.add(item);
    }
    updateSelected(next);
  }

  async function reanalyze() {
    setReanalyzeOpen(false);
    setError(null);
    const response = await api(`/api/demos/${id}/analyze`, { method: "POST" });
    const body = (await response.json().catch(() => null)) as
      | (DemoPayload & { message?: string; error?: string })
      | null;
    if (!response.ok || !body) {
      setError(plainText(body?.message, "没有重新开始解析。"));
      return;
    }
    setPayload((current) => current ? { ...current, demo: body.demo, reanalysis: body.reanalysis, highlights: body.highlights } : current);
    setAnalysisRevision((current) => current + 1);
    if (body.reanalysis?.droppedHighlightIds?.length) {
      const dropped = new Set(body.reanalysis.droppedHighlightIds);
      updateSelected(new Set([...selected].filter((item) => !dropped.has(item))));
    }
    if (body.reanalysis?.message) {
      toast(plainText(body.reanalysis.message, "重新分析已开始。"));
    } else if (body.message) {
      toast(plainText(body.message, "重新分析已开始。"));
    }
  }

  async function requestExport() {
    if (selectedHighlights.length === 0) return;
    setExportConfirm(false);
    setExporting(true);
    try {
      const body: ExportRequestBody = {
        demoId: id,
        highlightIds: selectedHighlights.map((item) => item.id),
        options: {
          showXRay,
          perspective: exportPerspective,
        },
      };
      const response = await api("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { job?: PublicExportJob; error?: string; message?: string };
      if (response.status === 409 && result.error === "recorder_not_ready") {
        setBlockedOpen(true);
        return;
      }
      if (!response.ok || !result.job) {
        toast(plainText(result.message, "导出没有排上队"));
        return;
      }
      track(result.job);
      document.getElementById("results-heading")?.scrollIntoView({ block: "nearest" });
    } catch {
      toast.error("导出请求未确认，请先查看该场导出历史。");
    } finally {
      setExporting(false);
    }
  }

  async function retryFiveEImport() {
    const matchId = payload?.demo.importedFrom?.matchId;
    if (!matchId || importing) return;
    setImporting(true);
    try {
      const response = await api("/api/demos/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: matchId }),
      });
      const body = await response.json() as { message?: string };
      if (!response.ok) { setError(body.message ?? "重新导入失败。"); return; }
      setAnalysisRevision((value) => value + 1);
    } catch {
      setError("无法连接录像服务，请稍后重新导入。");
    } finally {
      setImporting(false);
    }
  }

  const match = payload?.match;
  const reanalyzing = Boolean(payload?.reanalysis?.inProgress || (payload?.demo.status === "analyzing" && match));
  const firstParse = Boolean(payload && !match && (payload.demo.status === "downloading" || payload.demo.status === "extracting" || payload.demo.status === "analyzing"));
  const progressLabel = payload?.demo.status === "downloading" ? "下载中" : payload?.demo.status === "extracting" ? "解压中" : "解析中";
  const ready = Boolean(match) && (payload?.demo.status === "ready" || reanalyzing);
  const matchJobs = jobs.filter((job) => job.demoId === id);

  return (
    <div className="review-shell">
      <SiteHeader ready={recorder?.ready ?? null} reanalysis={ready ? { pending: reanalyzing, open: openReanalysis } : undefined} />
      <main className="review-layout" data-ready={ready}>
        <div className="review-content">
          <div className="review-nav flex items-center justify-between gap-x-3">
            <Button asChild size="sm" variant="ghost" className="-ml-3">
              <Link href="/library"><ArrowLeft size={16} aria-hidden />录像库</Link>
            </Button>
            {ready && (
              <Button type="button" variant="ghost" size="sm" disabled={reanalyzing}
                onClick={(event) => openReanalysis(event.currentTarget)}>
                <RotateCcw size={15} aria-hidden />重新分析
              </Button>
            )}
          </div>

        {!payload && !error ? <DemoSkeleton /> : null}
        {error ? (
          <p className="mt-4 text-base text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {firstParse && payload ? (
          <section className="state-surface" aria-busy="true">
            <p className="text-sm text-accent">{progressLabel}</p>
            <h1 className="mt-2 break-words text-2xl font-semibold [overflow-wrap:anywhere]">{payload.demo.originalName}</h1>
            <p className="mt-3 max-w-xl text-sm leading-normal text-muted-foreground" role="status">
              {payload.demo.progress?.message || "正在读这场录像里的击杀、残局和下包。大文件会更久。"}
            </p>
            {typeof payload.demo.progress?.percent === "number" ? (
              <p className="mt-2 font-mono text-sm">{payload.demo.progress.percent}%</p>
            ) : null}
            <div className="analysis-track" role="progressbar" aria-label={`录像${progressLabel}进度`} aria-valuenow={payload.demo.progress?.percent ?? undefined}>
              <div
                className={cn("h-full rounded-full bg-accent transition-[width]", payload.demo.progress?.percent == null && "analysis-indeterminate")}
                style={{ width: `${payload.demo.progress?.percent ?? 28}%` }}
              />
            </div>
          </section>
        ) : null}
        {reanalyzing && match ? (
          <p className="reanalyze-notice mt-3 border-l-2 border-accent py-2 pl-3 text-sm text-muted-foreground" aria-live="polite">
            {payload?.reanalysis?.message || payload?.demo.progress?.message || "正在重新分析。已勾选的片段编号会尽量保持不变。"}
          </p>
        ) : null}

        {payload?.demo.status === "error" ? (
          <section className="state-surface">
            <h1 className="text-2xl font-semibold">录像处理失败</h1>
            <p className="mt-3 text-base leading-normal text-destructive">{plainText(payload.demo.error, "解析没有完成。")}</p>
            {payload.demo.importedFrom ? (
              <Button className="mt-6" type="button" variant="outline" disabled={importing} onClick={() => void retryFiveEImport()}>
                {importing ? "正在导入…" : "重新导入"}
              </Button>
            ) : <Button className="mt-6" type="button" variant="outline" onClick={(event) => openReanalysis(event.currentTarget)}>
              重新分析
            </Button>}
          </section>
        ) : null}

        {ready && match ? (
          <>
            <section className="match-banner" aria-label="比赛信息">
              <div className="match-scoreline">
                <TeamScore name={match.teamA.name} score={match.teamA.score} tone="a" />
                <h1 className="match-map">{match.mapName}</h1>
                <TeamScore name={match.teamB.name} score={match.teamB.score} tone="b" />
              </div>
              <p className="match-meta">
                {[match.game, match.source].filter(Boolean).join(" · ")}
                <span className="font-mono">{formatClock(match.durationSeconds)}</span>
                <span>{formatWhen(match.date)}</span>
              </p>
            </section>

            <ExportResults jobs={matchJobs} reconnecting={reconnecting} />

            <section className="review-workspace" aria-labelledby="highlights-heading">
              <div className="workspace-title">
                <h2 id="highlights-heading" className="workspace-heading text-xl font-semibold">高光片段</h2>
              <div className="identity-strip">
                {payload?.binding.state === "pending" ? <p className="identity-prompt text-sm text-muted-foreground">绑定本场选手</p> : mySteamId ? (
                  <p className="min-w-0 truncate text-sm text-muted-foreground" title={match.players.find((player) => player.steamId === mySteamId)?.name}>
                    我是 <span className="text-foreground">{match.players.find((player) => player.steamId === mySteamId)?.name}</span>
                  </p>
                ) : null}
                <PlayerPicker players={match.players} teams={[match.teamA, match.teamB]} selected={mySteamId ?? ""}
                  identity={{ label: payload?.binding.state === "pending" ? "这是我" : mySteamId ? "更改身份" : "绑定身份", busy: bindingBusy || reanalyzing }}
                  onSelect={(steamId, makePreferred) => void setIdentity(steamId, makePreferred)} />
                {payload?.binding.state === "pending" && <Button type="button" size="sm" variant="ghost" disabled={bindingBusy}
                  onClick={() => void setIdentity(null)}>跳过</Button>}
              </div>
                <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={toggleVisible} disabled={filtered.length === 0}>
                  {visibleAllSelected ? "取消当前列表" : "勾选当前列表"}
                </Button>
              </div>
              <div className="workspace-filters">
                <PlayerPicker players={match.players} frequent={payload?.frequentPlayers ?? []} teams={[match.teamA, match.teamB]}
                  mySteamId={mySteamId} selected={playerId} onSelect={setPlayerId} />

                <div className="clip-filters" role="group" aria-label="高光类型">
                {FILTERS.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    size="sm"
                    variant={filter === item.id ? "soft" : "ghost"}
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label} <span className="font-mono text-xs">{counts[item.id]}</span>
                  </Button>
                ))}
                </div>
              </div>

              <div className="highlight-scroll" ref={scroll} tabIndex={0} role="region" aria-label="高光列表">
              {filtered.length === 0 ? (
                <div className="empty-state">
                  <ListVideo size={22} aria-hidden />
                  <p>
                  {highlights.length === 0
                    ? "这场比赛没有符合条件的高光。"
                    : "当前筛选没有片段。"}
                  </p>
                  {highlights.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setPlayerId("all"); setFilter("all"); }}>查看全部高光</Button>
                  )}
                </div>
              ) : (
                <>
                  {[...rounds].map(([round, items]) => (
                    <section className="round-group" key={round} aria-label={`第 ${round} 回合`}>
                      <h3 className="round-heading">第 <span className="font-mono">{round}</span> 回合</h3>
                      <ul>
                        {items.map((item) => (
                          <li key={item.id}>
                            <HighlightRow item={item} checked={selected.has(item.id)} onToggle={() => toggle(item.id)} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </>
              )}
              </div>
            </section>
          </>
        ) : null}
        </div>
        {ready && (
          <aside className="review-dock" aria-label="已选片段">
            <div className="selection-summary">
              <Film size={19} className="hidden shrink-0 text-accent lg:block" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold">已选 <span className="font-mono">{selectedHighlights.length}</span> 段</p>
                <p className="text-sm text-muted-foreground">片段时长 <span className="font-mono">{formatClock(selectedSeconds)}</span></p>
              </div>
            </div>
            {selectedHighlights.length > 0 && (
              <ul className="selection-reel" aria-label="已选片段清单" tabIndex={0}>
                {selectedHighlights.map((item) => (
                  <li key={item.id}>
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{highlightLabel(item)} · {item.playerName}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatClock(item.durationSeconds)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button ref={exportTrigger} className="lg:w-full" type="button" disabled={selectedHighlights.length === 0 || exporting || reanalyzing}
              aria-busy={exporting} onClick={() => setExportConfirm(true)}>
              {exporting ? "正在提交" : "导出成片"}
            </Button>
          </aside>
        )}
      </main>

      <Dialog
        open={exportConfirm}
        onOpenChange={setExportConfirm}
        title="导出成片"
        returnFocus={exportTrigger}
        description={recorder?.ready === false ? "录像机暂未就绪。已选片段会保留。" : plainText(recorder?.exportWarning, "导出会打开本机 CS2，录制过程中请不要操作游戏。")}
        body={
          <>
            <div className="mb-3 flex flex-wrap justify-between gap-2 rounded-xl bg-background px-3 py-2.5 text-sm">
              <span>预计成片 <span className="font-mono">{formatClock(videoSeconds)}</span></span>
              <span className="text-muted-foreground">720p · 30 帧 · 一条 MP4</span>
            </div>
            <div className="space-y-2">
              <Switch checked={showXRay} onCheckedChange={setShowXRay} label="X 光" />
              <Switch checked={exportPerspective === "enemy"} onCheckedChange={setVictimPerspective} label="追加受害者视角回放" disabled={!selectedCanReplay} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {selectedCanReplay
                ? "每段先播击杀者视角。有受害者视角的片段会紧接着回放一遍。"
                : victimReady ? "已选片段没有可回放的受害者视角。" : victimUnavailableText}
            </p>
          </>
        }
      >
        <Button type="button" variant="outline" onClick={() => setExportConfirm(false)}>
          取消
        </Button>
        <Button type="button" disabled={recorder?.ready === false || selectedHighlights.length === 0 || reanalyzing}
          onClick={() => void requestExport()}>
          开始导出
        </Button>
      </Dialog>
      <Dialog
        open={reanalyzeOpen}
        onOpenChange={setReanalyzeOpen}
        title="重新分析"
        returnFocus={reanalyzeTrigger}
        description="会再读一遍这场录像。已经勾选的片段先留着：编号对得上就继续勾着；对不上的勾选会丢掉，需要再勾一次。"
      >
        <Button type="button" variant="outline" onClick={() => setReanalyzeOpen(false)}>
          取消
        </Button>
        <Button type="button" variant="outline" onClick={() => void reanalyze()}>
          重新分析
        </Button>
      </Dialog>
      <Dialog
        open={blockedOpen}
        onOpenChange={setBlockedOpen}
        title="暂时不能导出"
        returnFocus={exportTrigger}
        description="这台电脑现在还不能把片段录成片。勾选不受影响。"
      >
        <Button type="button" variant="outline" onClick={() => setBlockedOpen(false)}>
          知道了
        </Button>
      </Dialog>
    </div>
  );
}

function TeamScore({ name, score, tone }: { name: string; score: number; tone: "a" | "b" }) {
  return (
    <div className="team-score" data-tone={tone}>
      <p className="team-name">{name}</p>
      <p className="team-value">{score}</p>
    </div>
  );
}

function HighlightRow({ item, checked, onToggle }: { item: Highlight; checked: boolean; onToggle: () => void }) {
  const side = sideName(item.side);
  const detail = highlightDetail(item);
  const label = highlightLabel(item);
  return (
    <div
      className="highlight-row"
      data-selected={checked}
      onClick={onToggle}
    >
      <Checkbox
        checked={checked}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={onToggle}
        aria-label={`勾选 ${item.playerName} 的${label}`}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn("min-w-0 break-words font-semibold [overflow-wrap:anywhere]", item.side === 3 ? "text-ct" : item.side === 2 ? "text-t" : "text-foreground")}>
            {item.playerName}
          </p>
          <span className="shrink-0 font-mono text-sm text-muted-foreground">{formatClock(item.durationSeconds)}</span>
        </div>
        <div className="highlight-badges mt-2 flex flex-wrap gap-1.5">
          <Badge>{label}</Badge>
          {side ? <Badge>{side}</Badge> : null}
          {item.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
        {detail !== label ? <p className="highlight-detail mt-2 break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{detail}</p> : null}
      </div>
    </div>
  );
}

function DemoSkeleton() {
  return (
    <div className="mt-4" aria-hidden>
      <div className="h-28 rounded-xl bg-card" />
      <div className="mt-3 h-11 w-2/5 rounded-lg bg-muted" />
      <div className="mt-3">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-20 border-b border-border last:border-b-0" />
        ))}
      </div>
    </div>
  );
}

function readSelection(demoId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  const raw = sessionStorage.getItem(`chaipian-selection:${demoId}`);
  if (!raw) return new Set();
  try {
    const ids = JSON.parse(raw) as string[];
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function plainText(message: string | null | undefined, fallback: string): string {
  if (!message) return fallback;
  if (/csdm|hlae|victimsteam|video\.json|缺字段/i.test(message)) return fallback;
  return message;
}
