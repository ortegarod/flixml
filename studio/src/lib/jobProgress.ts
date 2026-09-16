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
 * The jobs list reports "pending" until a job is reconciled, so whether a node is
 * actually rendering only comes from the single-job route. `started_at` is written
 * by the same reconcile, so the clock falls back to submission time — which is what
 * a queued job's elapsed time means anyway.
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

  const rendering =
    job.status === "running" || live?.status === "running" || live?.status === "in_progress";
  const since = job.started_at ?? job.created_at ?? null;
  const elapsed = since ? Math.max(0, (now - Date.parse(since)) / 1000) : null;
  const typical = typicalSeconds(job, workflows);
  const ratio = elapsed !== null && typical ? elapsed / typical.seconds : null;

  return {
    rendering,
    elapsed,
    typical,
    overdue: ratio !== null && ratio > 1,
    /** Share of the usual run time spent, capped at 100. Time-based, not sampler progress. */
    percent: ratio === null ? 0 : Math.min(100, Math.round(ratio * 100)),
  };
}
