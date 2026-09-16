import { useQuery } from "@tanstack/react-query";
import type { JobItem } from "../types";
import type { WorkflowMeta } from "../components/sidebar/GenerateTab";

/** Statuses that mean the job hasn't produced its output yet. */
export const ACTIVE_STATUSES = new Set(["pending", "queued", "running", "in_progress"]);

export function isActive(job: JobItem): boolean {
  return ACTIVE_STATUSES.has(job.status);
}

/** The installed workflow registry, fetched once and shared by every consumer. */
export function useWorkflowRunTimes() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: async (): Promise<WorkflowMeta[]> => {
      const res = await fetch("/api/workflows");
      if (!res.ok) throw new Error(`Workflows request failed (${res.status})`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60_000,
  });
}

/** How long this workflow usually takes on the node this job is running on. */
export function typicalSeconds(
  job: JobItem,
  workflows: WorkflowMeta[]
): { seconds: number; samples: number } | null {
  const meta = workflows.find((w) => w.id === (job.workflow ?? job.job_type));
  const stats = job.provider ? meta?.run_time?.by_provider?.[job.provider] : undefined;
  return stats ? { seconds: stats.median_seconds, samples: stats.samples } : null;
}

/**
 * Live state for one job in flight.
 *
 * The clock runs from `started_at` and nothing else. A job sitting behind another on
 * the same node hasn't spent any of its run time yet, so counting from submission
 * would show it a minute in and "overdue" against a workflow it never started —
 * a number the node never earned. Queue wait is reported separately as `waiting`.
 *
 * The jobs list reports "pending" until a job is reconciled, and `started_at` is
 * written by that same reconcile, so the single-job route below is what turns the
 * clock on.
 */
export function useJobProgress(job: JobItem, now: number, workflows: WorkflowMeta[]) {
  const { data: live } = useQuery({
    queryKey: ["job", job.prompt_id],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${job.prompt_id}`);
      if (!res.ok) throw new Error(`Job request failed (${res.status})`);
      const data = await res.json();
      return (data.job ?? data) as JobItem;
    },
    refetchInterval: 5000,
    enabled: isActive(job),
  });

  const startedAt = live?.started_at ?? job.started_at ?? null;
  const rendering =
    !!startedAt ||
    job.status === "running" ||
    live?.status === "running" ||
    live?.status === "in_progress";

  const elapsed = startedAt ? Math.max(0, (now - Date.parse(startedAt)) / 1000) : null;
  const submittedAt = job.created_at ?? null;
  const waiting =
    !startedAt && submittedAt ? Math.max(0, (now - Date.parse(submittedAt)) / 1000) : null;

  const typical = typicalSeconds(job, workflows);
  const ratio = elapsed !== null && typical ? elapsed / typical.seconds : null;

  return {
    rendering,
    /** Seconds on the node. Null until it starts — a queued job has none. */
    elapsed,
    /** Seconds spent waiting for a free node, once submitted and before it starts. */
    waiting,
    typical,
    overdue: ratio !== null && ratio > 1,
    /** Share of the usual run time spent, capped at 100. Time-based, not sampler progress. */
    percent: ratio === null ? 0 : Math.min(100, Math.round(ratio * 100)),
  };
}
