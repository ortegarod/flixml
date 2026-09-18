import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useApp } from "../App";
import type { JobItem } from "../types";
import type { WorkflowMeta } from "./sidebar/GenerateTab";
import { clock, secondsBetween, timeAgo } from "../lib/duration";
import { isActive, useJobProgress, useWorkflowRunTimes } from "../lib/jobProgress";

const RECENT_LIMIT = 25;

function StatusIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />;
  if (status === "pending") return <Clock className="h-4 w-4 text-gray-400" aria-hidden />;
  if (status === "failed") return <AlertTriangle className="h-4 w-4 text-red-400" aria-hidden />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />;
}

/** A job in flight: how long it's been running, against how long this workflow usually takes. */
function ActiveJob({ job, workflows, now }: { job: JobItem; workflows: WorkflowMeta[]; now: number }) {
  const { rendering, elapsed, typical, overdue, percent } = useJobProgress(job, now, workflows);

  return (
    <li className="rounded-2xl border border-gray-800/60 bg-gray-950/50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-gray-100">
            <StatusIcon status={rendering ? "running" : job.status} />
            {job.workflow ?? job.job_type ?? "job"}
            <span className="font-mono text-xs text-gray-500">{job.provider}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${rendering ? "bg-brand-faint text-brand" : "bg-gray-800 text-gray-400"}`}>
              {rendering ? "Rendering" : "Queued"}
            </span>
          </p>
          {job.prompt && <p className="mt-1 line-clamp-2 text-sm text-gray-400">{job.prompt}</p>}
        </div>
        <p className="shrink-0 text-right">
          {/* No clock while queued: the run time hasn't started. */}
          <span className={`font-mono text-lg tabular-nums ${elapsed === null ? "text-gray-500" : "text-gray-100"}`}>
            {elapsed !== null ? clock(elapsed) : "—"}
          </span>
          <span className="mt-0.5 block text-xs text-gray-500">
            {elapsed === null
              ? "waiting for a node"
              : typical
                ? `usually ${clock(typical.seconds)}`
                : "on the node"}
          </span>
        </p>
      </div>

      {elapsed !== null && (
        <div className="mt-3 space-y-1">
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Estimated progress, ${percent}% of the usual run time`}
            className="h-1.5 overflow-hidden rounded-full bg-gray-800"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${overdue ? "bg-red-400/70" : "bg-brand"}`}
              style={{ width: `${Math.max(2, percent)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {typical
              ? overdue
                ? `Past the median of the last ${typical.samples} run${typical.samples === 1 ? "" : "s"} on this node`
                : `Time against the median of the last ${typical.samples} run${typical.samples === 1 ? "" : "s"} on this node — an estimate, not sampler progress`
              : "No run history for this workflow on this node yet"}
          </p>
        </div>
      )}
    </li>
  );
}

function FinishedJob({ job, now }: { job: JobItem; now: number }) {
  const ran = secondsBetween(job.started_at, job.finished_at);
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <StatusIcon status={job.status} />
        <span className="truncate text-gray-200">{job.workflow ?? job.job_type ?? "job"}</span>
        <span className="hidden shrink-0 font-mono text-xs text-gray-600 sm:inline">{job.provider}</span>
        {job.status === "failed" && job.error && (
          <span className="truncate text-xs text-red-300/80" title={job.error}>
            {job.error}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-3 text-xs text-gray-500">
        {ran !== null && <span className="font-mono tabular-nums text-gray-400">{clock(ran)}</span>}
        <span>{timeAgo(job.finished_at ?? job.created_at, now)}</span>
      </span>
    </li>
  );
}

export function JobsPage() {
  const { jobs } = useApp();
  const [now, setNow] = useState(() => Date.now());

  const active = useMemo(() => jobs.filter(isActive), [jobs]);
  const finished = useMemo(
    () =>
      jobs
        .filter((job) => !isActive(job))
        .sort((a, b) => Date.parse(b.finished_at ?? b.created_at ?? "") - Date.parse(a.finished_at ?? a.created_at ?? ""))
        .slice(0, RECENT_LIMIT),
    [jobs]
  );

  // The clock only needs to tick while something is running.
  useEffect(() => {
    if (active.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active.length]);

  const { data: workflows = [] } = useWorkflowRunTimes();

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-white">Jobs</h1>
        <p className="text-sm text-gray-400">
          What your GPUs are working on, and what they just finished.
        </p>
      </header>

      <section className="space-y-3">
        {/* Queued and rendering both live here, so the heading can't claim they're all running. */}
        <h2 className="text-sm font-semibold text-gray-300">
          In flight {active.length > 0 && <span className="text-gray-500">· {active.length}</span>}
        </h2>
        {active.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-800 px-4 py-8 text-center text-sm text-gray-500">
            Nothing rendering right now.
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((job) => (
              <ActiveJob key={job.prompt_id} job={job} workflows={workflows} now={now} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-300">Recent</h2>
        {finished.length === 0 ? (
          <p className="text-sm text-gray-500">No finished jobs yet.</p>
        ) : (
          <ul className="divide-y divide-gray-800/60 rounded-2xl border border-gray-800/60 bg-gray-950/50">
            {finished.map((job) => (
              <FinishedJob key={job.prompt_id} job={job} now={now} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
