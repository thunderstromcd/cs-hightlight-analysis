"use client";

import { Film } from "lucide-react";
import { useEffect } from "react";
import { isExportActive, useExportMonitor } from "@/components/export-monitor";
import { DownloadButton, ExportTiming, PhaseTrack } from "@/components/export-results";
import { SiteHeader } from "@/components/site-header";
import { formatClock, formatWhen } from "@/lib/format";

export default function Page() {
  const { watch, jobs, loaded, reconnecting } = useExportMonitor();
  useEffect(() => watch(), [watch]);

  return (
    <>
      <SiteHeader />
      <main className="page-width subpage-list">
        <h1 className="subpage-title">导出历史</h1>
        {reconnecting ? <p className="mt-3 text-sm text-muted-foreground" role="status">正在重新连接导出服务…</p> : null}
        {!loaded && !reconnecting ? <p className="mt-3 text-sm text-muted-foreground" role="status">正在读取成片…</p> : null}
        {loaded && !jobs.length ? <div className="empty-state"><Film size={22} aria-hidden /><p>暂无成片。提交导出后，可在此查看进度并下载。</p></div> : null}
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {jobs.map((job) => (
            <li className="history-row" key={job.id}>
              <div className="min-w-0">
                <h2 className="break-words font-semibold">{job.mapName || job.originalName || job.outputName}</h2>
                {job.originalName && job.originalName !== job.mapName && <p className="mt-1 break-words text-sm text-muted-foreground">{job.originalName}</p>}
                <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                  <time dateTime={job.createdAt}>{formatWhen(job.createdAt)}</time>
                  <span>{job.highlightIds.length} 个片段</span>
                  {job.clipDurationSeconds > 0 && <span className="font-mono">{formatClock(job.clipDurationSeconds)}</span>}
                </p>
                {job.status === "failed" && job.error && <p className="mt-2 break-words text-sm text-destructive">{job.error}</p>}
                {isExportActive(job) && <div className="max-w-lg"><PhaseTrack job={job} /><ExportTiming job={job} /></div>}
              </div>
              <div className="flex items-center gap-3">
                <span data-status={job.status} className="history-status">{job.stageLabel}</span>
                {job.status === "done" && <DownloadButton job={job} />}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
