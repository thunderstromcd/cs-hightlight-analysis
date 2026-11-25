"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, fileHref } from "@/lib/client";
import type { PublicExportJob } from "@/lib/export-queue";

const TRACKED_KEY = "chaipian-pending-exports";

function trackedIds(key: string): string[] {
  return JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[];
}

export function isExportActive(job: PublicExportJob) {
  return job.status === "queued" || job.status === "recording";
}

type Monitor = {
  jobs: PublicExportJob[];
  reconnecting: boolean;
  watch: (demoId?: string) => () => void;
  track: (job: PublicExportJob) => void;
  loaded: boolean;
};

const ExportMonitor = createContext<Monitor | null>(null);

export function ExportMonitorProvider({ children, userId }: { children: ReactNode; userId: string }) {
  const key = `${TRACKED_KEY}:${userId}`;
  const [jobs, setJobs] = useState<PublicExportJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const demo = useRef<string | undefined | null>(null);
  const wake = useRef<() => void>(() => {});

  const merge = useCallback((updates: PublicExportJob[]) => {
    setJobs((current) => {
      const byId = new Map(current.map((job) => [job.id, job]));
      for (const job of updates) byId.set(job.id, job);
      return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  const track = useCallback((job: PublicExportJob) => {
    sessionStorage.setItem(key, JSON.stringify([...new Set([...trackedIds(key), job.id])]));
    merge([job]);
    wake.current();
  }, [key, merge]);

  const watch = useCallback((demoId?: string) => {
    demo.current = demoId;
    wake.current();
    return () => {
      if (demo.current === demoId) demo.current = null;
      wake.current();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let fetching = false;
    let refreshRequested = false;

    async function poll() {
      const currentDemo = demo.current;
      const tracked = trackedIds(key);
      if (currentDemo === null && tracked.length === 0) {
        setReconnecting(false);
        return;
      }
      fetching = true;
      refreshRequested = false;
      let next = 2000;
      try {
        const query = currentDemo && tracked.length === 0 ? `?demoId=${encodeURIComponent(currentDemo)}` : "";
        const response = await api(`/api/exports${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error("读取导出状态失败");
        const { jobs: updates } = (await response.json()) as { jobs: PublicExportJob[] };
        if (controller.signal.aborted) return;
        merge(updates);
        if (!query) setLoaded(true);
        setReconnecting(false);
        const owned = new Set(trackedIds(key));
        for (const job of updates) {
          if (isExportActive(job) || !owned.delete(job.id)) continue;
          sessionStorage.setItem(key, JSON.stringify([...owned]));
          if (job.status === "done") {
            toast.success("导出完成", {
              id: `export-${job.id}`,
              description: job.outputName,
              duration: 12000,
              action: {
                label: "下载成片",
                onClick: () => { window.location.href = fileHref(job.id); },
              },
            });
          } else {
            toast.error("导出失败", { id: `export-${job.id}`, description: "打开导出历史查看详情。" });
          }
        }
        if (!updates.some((job) => isExportActive(job) && (currentDemo === undefined || job.demoId === currentDemo || owned.has(job.id)))) {
          next = 8000;
        }
      } catch {
        if (!controller.signal.aborted) setReconnecting(true);
      } finally {
        fetching = false;
        if (!controller.signal.aborted && (demo.current !== null || trackedIds(key).length)) {
          timer = window.setTimeout(poll, refreshRequested ? 0 : next);
        }
      }
    }

    function schedule() {
      window.clearTimeout(timer);
      if (fetching) refreshRequested = true;
      else timer = window.setTimeout(poll, 0);
    }

    wake.current = schedule;
    schedule();
    window.addEventListener("online", schedule);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.removeEventListener("online", schedule);
      wake.current = () => {};
    };
  }, [key, merge]);

  return <ExportMonitor.Provider value={{ jobs, reconnecting, watch, track, loaded }}>{children}</ExportMonitor.Provider>;
}

export function useExportMonitor() {
  const monitor = useContext(ExportMonitor);
  if (!monitor) throw new Error("ExportMonitorProvider is required");
  return monitor;
}
