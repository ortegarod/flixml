import type { JobItem } from "../types";

interface PendingMediaTileProps {
  job: JobItem;
}

function getProgress(job: JobItem): number {
  if (typeof job.progress_percent === "number") return job.progress_percent;
  if (job.step_max && job.step_max > 0) {
    return Math.round(((job.step_value || 0) / job.step_max) * 100);
  }
  return 0;
}

function statusLabel(status: string) {
  if (status === "pending") return "Queued";
  if (status === "running") return "Generating";
  if (status === "failed") return "Failed";
  return status;
}

export function PendingMediaTile({ job }: PendingMediaTileProps) {
  const progress = getProgress(job);
  const isRunning = job.status === "running";
  const isFailed = job.status === "failed";
  const isPending = job.status === "pending";
  const isCompleted = job.status === "completed";

  return (
    <div
      className={`
        relative aspect-[3/4] rounded-xl overflow-hidden border
        transition-all duration-300
        ${isFailed
          ? "border-red-800/40 bg-red-950/20"
          : "border-gray-800/60 bg-[#0d0d0d]"
        }
      `}
    >
      {/* Animated shimmer background */}
      {!isFailed && !isCompleted && (
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#0d0d0d] to-[#1a1a2e] animate-pulse" />
      )}

      {/* Completed glow */}
      {isCompleted && (
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/30 via-[#0d0d0d] to-emerald-950/20" />
      )}

      {/* Subtle scanline texture */}
      {!isFailed && !isCompleted && (
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)",
          }}
        />
      )}

      {/* Top row — status + ID */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 pt-2.5 z-10">
        <span
          className={`text-[10px] font-mono uppercase tracking-widest ${
            isFailed ? "text-red-400/80" : isCompleted ? "text-emerald-400/80" : "text-primary/60"
          }`}
        >
          {isRunning && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 animate-pulse" />
          )}
          {isCompleted && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5" />
          )}
          {statusLabel(job.status)}
          {job.queue_position ? ` · ${job.queue_position}` : ""}
        </span>
        <span className="text-[9px] font-mono text-white/15">
          {job.prompt_id?.slice(-6)}
        </span>
      </div>

      {/* Center — spinner + percent */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10">
        {isCompleted && (
          <>
            <svg className="w-8 h-8 text-emerald-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-emerald-400/60 font-mono text-xs">Done</span>
          </>
        )}
        {!isFailed && !isCompleted && (
          <>
            <span className="loading loading-ring loading-md text-primary opacity-60" />
            {progress > 0 && (
              <span className="text-white/50 font-mono text-sm font-bold tracking-widest">
                {progress}%
              </span>
            )}
          </>
        )}
        {isFailed && (
          <span className="text-red-400/60 font-mono text-xs">Failed</span>
        )}
      </div>

      {/* Bottom — prompt text */}
      <div className="absolute bottom-[6px] left-0 right-0 px-3 pb-1 z-10">
        <p className="text-[11px] text-white/25 italic leading-snug line-clamp-3">
          {job.prompt || "Generation job"}
        </p>
        {job.current_node && (
          <p className="text-[9px] text-white/15 font-mono mt-1 truncate">
            {job.current_node}
            {job.step_max ? ` · ${job.step_value || 0}/${job.step_max}` : ""}
          </p>
        )}
      </div>

      {/* Progress bar at bottom */}
      {!isFailed && !isCompleted && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/5 z-20">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      )}

      {isCompleted && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-emerald-950 z-20">
          <div className="h-full bg-emerald-500/60 transition-all duration-500" style={{ width: "100%" }} />
        </div>
      )}

      {isFailed && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-red-950 z-20">
          <div className="h-full bg-red-500/40" style={{ width: "100%" }} />
        </div>
      )}
    </div>
  );
}
