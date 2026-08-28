import type { JobItem } from "../types";

interface PendingMediaTileProps {
  job: JobItem;
}

function getProgress(job: JobItem): number {
  if (typeof job.progress_percent === "number") return Math.round(job.progress_percent);
  if (job.step_max && job.step_max > 0) {
    return Math.round(((job.step_value || 0) / job.step_max) * 100);
  }
  return 0;
}

function statusLabel(status: string) {
  if (status === "pending") return "Queued";
  if (status === "running") return "Generating";
  if (status === "failed") return "Failed";
  if (status === "completed") return "Done";
  return status;
}

// Strip a staged path down to its filename for compact display.
function baseName(path?: string | null): string | null {
  if (!path) return null;
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function MetaChip({ icon, value, title }: { icon: string; value: string; title?: string }) {
  return (
    <span
      title={title || value}
      className="inline-flex items-center gap-1 max-w-full rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-mono text-white/45"
    >
      <span className="opacity-60">{icon}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}

export function PendingMediaTile({ job }: PendingMediaTileProps) {
  const progress = getProgress(job);
  const isRunning = job.status === "running";
  const isFailed = job.status === "failed";
  const isCompleted = job.status === "completed";

  const workflow = job.workflow || job.job_type;
  const inputVideo = baseName(job.video);
  const inputImage = baseName(job.image);
  const inputAudio = baseName(job.audio);
  const outPrefix = baseName(job.filename_prefix);
  const hasRes = !!(job.width && job.height && job.width > 0 && job.height > 0);
  const nodeStep =
    job.nodes_total && job.nodes_total > 0
      ? `node ${job.nodes_finished ?? 0}/${job.nodes_total}`
      : null;
  const sampleStep = job.step_max && job.step_max > 0 ? `step ${job.step_value ?? 0}/${job.step_max}` : null;

  return (
    <div
      className={`
        relative aspect-[3/4] rounded-xl overflow-hidden border flex flex-col
        transition-all duration-300
        ${isFailed ? "border-red-800/40 bg-red-950/20" : "border-gray-800/60 bg-[#0d0d0d]"}
      `}
    >
      {/* Animated shimmer background */}
      {!isFailed && !isCompleted && (
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#0d0d0d] to-[#1a1a2e] animate-pulse" />
      )}
      {isCompleted && (
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/30 via-[#0d0d0d] to-emerald-950/20" />
      )}
      {!isFailed && !isCompleted && (
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)",
          }}
        />
      )}

      {/* Top row — status + workflow + ID */}
      <div className="relative z-10 flex items-start justify-between px-3 pt-2.5 gap-2">
        <div className="min-w-0">
          <span
            className={`flex items-center text-[10px] font-mono uppercase tracking-widest ${
              isFailed ? "text-red-400/80" : isCompleted ? "text-emerald-400/80" : "text-primary/70"
            }`}
          >
            {isRunning && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 animate-pulse" />}
            {isCompleted && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5" />}
            {statusLabel(job.status)}
            {job.queue_position ? ` · #${job.queue_position}` : ""}
          </span>
          {workflow && (
            <span className="block mt-1 text-[11px] font-semibold text-white/70 truncate" title={workflow}>
              {workflow}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[9px] font-mono text-white/20 pt-0.5">{job.prompt_id?.slice(-6)}</span>
      </div>

      {/* Center — spinner + percent + live node/step */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-1.5 min-h-0">
        {isCompleted ? (
          <>
            <svg className="w-8 h-8 text-emerald-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-emerald-400/60 font-mono text-xs">Done</span>
          </>
        ) : isFailed ? (
          <span className="text-red-400/60 font-mono text-xs">Failed</span>
        ) : (
          <>
            <span className="loading loading-ring loading-md text-primary opacity-60" />
            {progress > 0 && (
              <span className="text-white/60 font-mono text-lg font-bold tracking-widest leading-none">{progress}%</span>
            )}
            {(nodeStep || sampleStep) && (
              <span className="text-[9px] font-mono text-white/30">
                {[nodeStep, sampleStep].filter(Boolean).join(" · ")}
              </span>
            )}
          </>
        )}
      </div>

      {/* Bottom — config + inputs + prompt */}
      <div className="relative z-10 px-3 pb-2 space-y-1.5">
        {/* Config chips */}
        <div className="flex flex-wrap gap-1">
          {job.mode && <MetaChip icon="⚙" value={job.mode} title={`mode: ${job.mode}`} />}
          {job.provider && <MetaChip icon="🖥" value={job.provider} title={`provider: ${job.provider}`} />}
          {hasRes && <MetaChip icon="▦" value={`${job.width}×${job.height}`} title="resolution" />}
          {job.steps ? <MetaChip icon="◔" value={`${job.steps} steps`} /> : null}
          {job.length ? <MetaChip icon="⏱" value={`${job.length}f`} title="output frames" /> : null}
        </div>

        {/* Inputs */}
        {(inputImage || inputVideo || inputAudio) && (
          <div className="flex flex-wrap gap-1">
            {inputImage && <MetaChip icon="🖼" value={inputImage} title={`image: ${job.image}`} />}
            {inputVideo && <MetaChip icon="🎬" value={inputVideo} title={`driving video: ${job.video}`} />}
            {inputAudio && <MetaChip icon="🔊" value={inputAudio} title={`audio: ${job.audio}`} />}
          </div>
        )}

        {/* Prompt */}
        <p className="text-[11px] text-white/35 italic leading-snug line-clamp-2" title={job.prompt || undefined}>
          {job.prompt || "Generation job"}
        </p>

        {/* Output prefix */}
        {outPrefix && (
          <p className="text-[9px] font-mono text-white/20 truncate" title={`output: ${job.filename_prefix}`}>
            → {outPrefix}
          </p>
        )}
      </div>

      {/* Progress bar */}
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
