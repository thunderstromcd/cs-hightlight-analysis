"use client";

import { Check, Download } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { isExportActive } from "@/components/export-monitor";
import { Button } from "@/components/ui/button";
import { fileHref } from "@/lib/client";
import { EXPORT_STAGES } from "@/lib/export-progress";
import type { PublicExportJob } from "@/lib/export-queue";
import { formatClock } from "@/lib/format";

const PHASE_NAMES = ["排队", "准备", "启动", "录制", "编码", "完成"] as const;

export function ExportResults({ jobs, reconnecting }: { jobs: PublicExportJob[]; reconnecting: boolean }) {
  const current = jobs.find(isExportActive) ?? jobs[0];
  const finished = jobs.find((job) => job.status === "done");
  const active = current && isExportActive(current);
  const waiting = jobs.filter((job) => job.status === "queued").length;

  if (!current && !reconnecting) return null;

  return (
    <section className="results-panel" aria-labelledby="results-heading">
      <div className="results-heading">
        <div className="min-w-0">
            <h2 id="results-heading" className="font-semibold">成片</h2>
            <p className="text-sm text-muted-foreground" role="status">
              {reconnecting ? "正在重新连接导出服务…" : current?.stageLabel ?? "导出的 MP4 会出现在这里。"}
            </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-2">
          {finished && <DownloadButton key={finished.id} job={finished} previous={finished.id !== current?.id} />}
          <Button asChild size="sm" variant="ghost"><Link href="/exports">导出历史</Link></Button>
        </div>
      </div>
      {current && (
        <>
          {active && <PhaseTrack job={current} />}
          {active && <ExportTiming job={current} waiting={waiting} />}
          {current.status === "failed" && current.error && (
            <p className="result-error mt-1 break-words text-sm text-destructive" title={current.error}>{current.error}</p>
          )}
        </>
      )}
    </section>
  );
}

export function DownloadButton({ job, previous = false }: { job: PublicExportJob; previous?: boolean }) {
  return (
    <Button asChild className={previous ? "" : "finish-appearance"} size="sm" variant={previous ? "outline" : "default"}>
      <a href={fileHref(job.id)}><Download size={17} aria-hidden />{previous ? "下载上一份成片" : "下载成片"}</a>
    </Button>
  );
}

export function PhaseTrack({ job }: { job: PublicExportJob }) {
  return (
    <ol className="phase-track" aria-label="导出阶段">
      {EXPORT_STAGES.map((stage, index) => {
        const current = stage === job.stage;
        const seen = job.observedStages.includes(stage) || current;
        return (
          <li key={stage} data-current={current} data-seen={seen} aria-current={current ? "step" : undefined}>
            <span className="phase-dot" aria-hidden>{seen && (!current || stage === "done") && <Check size={11} />}</span>
            {PHASE_NAMES[index]}
          </li>
        );
      })}
    </ol>
  );
}

export function ExportTiming({ job, waiting = 1 }: { job: PublicExportJob; waiting?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const queued = job.stage === "queued";
  const elapsed = (now - Date.parse(job.startedAt ?? job.createdAt)) / 1000;
  const eta = job.estimatedRemaining;
  return (
    <div className="export-timing flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <span>{queued ? "已等待" : "已耗时"} <span className="font-mono text-foreground">{formatClock(elapsed)}</span></span>
      {queued && waiting > 1 && <span>本场 {waiting} 个任务排队</span>}
      {eta && (
        <span>
          {eta.maxSeconds === 0 ? "比预计久，仍在处理" : (
            <>
              {eta.source === "rough" ? "粗估剩余" : "预计剩余"}{" "}
              <span className="font-mono text-foreground">{formatClock(eta.minSeconds)}–{formatClock(eta.maxSeconds)}</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
