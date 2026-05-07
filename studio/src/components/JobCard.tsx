import type { JobItem } from "../types";

interface JobCardProps {
  job: JobItem;
}

function getProgress(job: JobItem): number | null {
  if (typeof job.progress_percent === "number") return job.progress_percent;
  if (job.step_max && job.step_max > 0) {
    return Math.round(((job.step_value || 0) / job.step_max) * 100);
  }
  return null;
}

function statusLabel(status: string) {
  if (status === "pending") return "Queued";
  if (status === "running") return "Generating";
  if (status === "failed") return "Failed";
  return status;
}

export function JobCard({ job }: JobCardProps) {
  const progress = getProgress(job);
  const isRunning = job.status === "running";
  const isFailed = job.status === "failed";

  return (
    <div className={`
      rounded-xl overflow-hidden border aspect-video relative p-4 flex flex-col justify-between
      transition-all duration-300
      ${isFailed
        ? "border-red-800/40 bg-red-950/10"
        : "border-amber-800/30 bg-gray-950/80 hover:border-amber-700/60 hover:shadow-lg hover:shadow-amber-900/10"
      }
    `}>
      {/* Ambient gradient */}
      <div className={`absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-rose-600/5 transition-opacity ${isFailed ? "opacity-20" : "opacity-100"}`} />

      {/* Status header */}
      <div className={`relative flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide ${isFailed ? "text-red-400" : "text-amber-400"}`}>
        <span className="flex items-center gap-2">
          {isRunning && <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
          {statusLabel(job.status)}
          {job.queue_position ? ` · Queue ${job.queue_position}` : ""}
        </span>
        {progress !== null && !isFailed && <span className="tabular-nums">{progress}%</span>}
      </div>

      {/* Content */}
      <div className="relative space-y-2.5">
        <p className="text-sm font-medium line-clamp-2 text-gray-200 leading-relaxed">
          {job.prompt || "Generation job"}
        </p>

        <div className="space-y-1.5">
          <div className={`h-1.5 rounded-full overflow-hidden ${isFailed ? "bg-red-950" : "bg-gray-800"}`}>
            <div
              className={`h-full rounded-full transition-all duration-700 ${isFailed ? "bg-red-500/60" : "bg-gradient-to-r from-amber-400 to-amber-300"}`}
              style={{ width: `${isFailed ? 100 : Math.max(3, progress ?? 3)}%` }}
            />
          </div>

          <p className="text-[11px] text-gray-500 truncate">
            {job.current_node
              ? `Node: ${job.current_node}`
              : isRunning
                ? "Starting..."
                : job.status === "pending"
                  ? "Waiting for GPU..."
                  : ""}
            {job.step_max ? ` · step ${job.step_value || 0}/${job.step_max}` : ""}
          </p>
        </div>
      </div>

      {/* ID */}
      <p className="relative text-[10px] text-gray-600 font-mono truncate">{job.prompt_id}</p>
    </div>
  );
}
