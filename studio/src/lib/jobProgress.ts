import { useQuery } from "@tanstack/react-query";
import type { JobItem } from "../types";
import type { WorkflowMeta } from "../components/sidebar/WorkflowsTab";

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
 * `started_at` is the only thing that decides whether a job is rendering, and the
 * clock runs from it. A job sitting behind another on the same node has spent none
 * of its run time yet, so it gets no clock at all — an elapsed number next to a job
 * the node hasn't touched is a number it never earned, whatever the label says.
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
  const rendering = startedAt !== null;
  const elapsed = startedAt ? Math.max(0, (now - Date.parse(startedAt)) / 1000) : null;

  const typical = typicalSeconds(job, workflows);
  const ratio = elapsed !== null && typical ? elapsed / typical.seconds : null;

  return {
    rendering,
    /** Seconds on the node. Null until it starts — a queued job has none. */
    elapsed,
    typical,
    overdue: ratio !== null && ratio > 1,
    /** Share of the usual run time spent, capped at 100. Time-based, not sampler progress. */
    percent: ratio === null ? 0 : Math.min(100, Math.round(ratio * 100)),
  };
}
