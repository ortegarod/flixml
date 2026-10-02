import React, { useEffect, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useApp } from "../App";
import { captionBody, TrainingDatasetSection } from "./TrainingDataset";

interface Sample {
  name: string;
  step: number | null;
  index: number | null;
}

interface PreviewSource {
  index: number;
  prompt: string;
  name: string | null;
  image: string | null;
}

interface Checkpoint {
  name: string;
  step: number | null;
  path: string;
  size_bytes: number;
  modified_at: string;
}

// Preview tiles: one size on one grid, whatever the screen width.
const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2";
const TILE_IMG = "aspect-[2/3] w-full rounded-md object-cover bg-gray-900";

function formatDate(iso: string | undefined | null): string {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function LoraTrainingPage() {
  const ctx = useApp();

  // App loads training state once at startup; while this page is open it asks
  // the API again every 5 s so the step count, time left and samples move.
  const [polledJobs, setPolledJobs] = useState<any[] | null>(null);
  const [polledLive, setPolledLive] = useState<any>(undefined);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [jobsRes, statusRes] = await Promise.all([
          fetch("/api/lora-training/jobs"),
          fetch("/api/lora-training/status"),
        ]);
        if (cancelled) return;
        if (jobsRes.ok) setPolledJobs((await jobsRes.json()).jobs || []);
        if (statusRes.ok) {
          const status = await statusRes.json();
          setPolledLive(status.ok ? status : null);
        }
      } catch {
        // keep the last state shown
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  const jobs = polledJobs ?? ctx.trainingJobs ?? [];
  const live = polledLive === undefined ? ctx.training : polledLive;

  // Live status of the latest job, polled by App from /api/lora-training/status.
  const effectiveLive = live;

  const mergedJobs = jobs.map((job: any) => {
    // The jobs list already carries the trainer's status for active jobs
    // (server-side). The polled status adds total_steps for the latest one.
    if (effectiveLive && effectiveLive.job_name === job.job_name && (effectiveLive.status === "running" || effectiveLive.status === "training")) {
      return { ...job, ...effectiveLive, _live: true };
    }
    return job;
  });

  // ?job=<name> opens that run, so other pages can link straight to it.
  const [searchParams] = useSearchParams();
  const [openJob, setOpenJob] = useState<string | null>(searchParams.get("job"));

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-white">LoRA Training</h1>
          <p className="mt-1 text-sm text-gray-400">Live progress of every LoRA your agents train on your GPUs.</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-300">
            Training runs <span className="ml-1 text-gray-500 tabular-nums">{jobs.length}</span>
          </h2>

          {polledJobs === null ? null : jobs.length === 0 ? (
            <p className="text-sm text-gray-500 py-12 text-center">No training runs yet.</p>
          ) : (
            <div className="rounded-xl border border-gray-800/70 bg-gray-950 divide-y divide-gray-800/70">
              {mergedJobs.map((job: any) => {
                const hasProgress = job.current_step > 0 && job.total_steps > 0;
                const inFlight = job.status === "training" || job.status === "running";
                const progress = hasProgress ? Math.round((job.current_step / job.total_steps) * 100) : 0;
                const isActive = ["running", "training", "pending", "queued", "stopping"].includes(job.status);
                const isOpen = openJob === job.job_name;

                return (
                  <div key={job.job_name}>
                    <button
                      type="button"
                      onClick={() => setOpenJob(isOpen ? null : job.job_name)}
                      className="w-full px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-left hover:bg-gray-900/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="text-sm font-medium text-white truncate">{job.job_name}</p>
                        <p className="text-xs text-gray-500">{formatDate(job.created_at)}</p>
                      </div>
                      <StatusChip status={job.status} />
                      <div className="flex items-center gap-3 basis-64 flex-1 sm:flex-none sm:w-64">
                        <div className="h-1.5 flex-1 rounded-full bg-gray-800 overflow-hidden">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${job.status === "completed" ? 100 : progress}%` }} />
                        </div>
                        <span className="w-9 text-right text-xs text-gray-400 tabular-nums">{job.status === "completed" ? 100 : progress}%</span>
                      </div>
                      <div className="w-40 text-right text-xs text-gray-400 tabular-nums hidden md:block">
                        {hasProgress && <p>Step {job.current_step.toLocaleString()} / {job.total_steps.toLocaleString()}</p>}
                        {inFlight && job.eta && <p>{formatEta(job.eta)} left</p>}
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-5 pt-1 space-y-5">
                        {job.status === "unreachable" && job.error && <p className="text-sm text-amber-400/80">{job.error}</p>}
                        {(job.status === "failed" || job.status === "error") && (job.error || job.info) && (
                          <p className="text-sm text-red-400/80">{job.error || job.info}</p>
                        )}
                        <RunFacts job={job} active={isActive} />
                        {job.dataset && <TrainingImages dataset={job.dataset} />}
                        <JobOutputs jobName={job.job_name} active={isActive} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Where the run's training images and their captions live: the page of the character
// the dataset is named for, or right here when no character has that name.
function TrainingImages({ dataset }: { dataset: string }) {
  const ctx = useApp();
  const character = (ctx.characters ?? []).find((c: any) => c.id === dataset);
  if (!character) return <TrainingDatasetSection dataset={dataset} />;
  return (
    <Link to={`/studio/characters/${encodeURIComponent(dataset)}#training-dataset`} className="inline-block text-sm text-gray-400 hover:text-white">
      Training dataset: {character.name ?? dataset} →
    </Link>
  );
}

function PreviewTile({ sample }: { sample: Sample }) {
  const src = `/api/lora-training/sample-image?path=${encodeURIComponent(sample.name)}`;
  const step = sample.step ?? -1;
  const label = step === 0 ? "Start" : step < 0 ? "Preview" : `Step ${step.toLocaleString()}`;
  return (
    <a href={src} target="_blank" rel="noreferrer" title={`${label}: open full size`} className="relative block">
      <img src={src} alt={label} loading="lazy" className={TILE_IMG} />
      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums text-gray-200">{label}</span>
    </a>
  );
}

function StatusChip({ status }: { status: string }) {
  const label: Record<string, string> = {
    running: "Training", training: "Training", pending: "Queued", queued: "Queued", stopping: "Stopping",
    completed: "Done", failed: "Failed", error: "Failed", unreachable: "Trainer offline", stopped: "Stopped",
  };
  const tone =
    status === "running" || status === "training"
      ? "bg-brand-faint text-brand border-brand-soft"
      : status === "completed"
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
        : status === "failed" || status === "error"
          ? "bg-red-500/10 text-red-400 border-red-500/30"
          : "bg-gray-800/60 text-gray-300 border-gray-700";
  return (
    <span className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${tone}`}>
      {label[status] ?? status}
    </span>
  );
}

// "20:58" or "1:04:10" (the API's eta) -> "21 min" / "1 h 4 min".
function formatEta(eta: string): string {
  const parts = eta.split(":").map(Number);
  const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + (parts[1] || 0);
  return formatDuration(seconds);
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

// Everything the trainer reports about one run, as plain facts: where it is,
// how fast, how well it's learning, what it's training and how, and on what.
function RunFacts({ job, active }: { job: any; active: boolean }) {
  const [status, setStatus] = useState<any>(null);
  const [gpu, setGpu] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [sRes, tRes] = await Promise.all([
          fetch(`/api/lora-training/status?job_name=${encodeURIComponent(job.job_name)}`),
          fetch("/api/lora-training/trainer"),
        ]);
        if (cancelled) return;
        if (sRes.ok) setStatus(await sRes.json());
        if (tRes.ok) setGpu(((await tRes.json()).gpus || [])[0] ?? null);
      } catch {
        // keep the last facts shown
      }
    };
    load();
    const timer = active ? setInterval(load, 10000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [job.job_name, active]);

  if (!status) return null;
  const st = status.settings || {};
  const started = status.started_at ? new Date(status.started_at).getTime() : null;
  const end = status.finished_at ? new Date(status.finished_at).getTime() : Date.now();
  const nextPreview = st.sample_every && status.current_step < status.total_steps
    ? Math.ceil((status.current_step + 1) / st.sample_every) * st.sample_every
    : null;

  const facts: [string, React.ReactNode][] = [
    ["Doing now", status.info || status.status],
    ["Running for", started ? formatDuration((end - started) / 1000) : null],
    ["Time left", active && status.eta ? formatEta(status.eta) : null],
    ["Speed", status.seconds_per_step ? `${status.seconds_per_step} s per step` : null],
    ["Loss", status.loss != null ? <LossValue history={status.loss_history || []} latest={status.loss} /> : null],
    ["Next preview", nextPreview ? `step ${nextPreview.toLocaleString()}` : null],
    ["Base model", st.base_model ? `${st.base_model}${st.arch ? ` (${String(st.arch).toUpperCase()})` : ""}` : null],
    ["Dataset", job.dataset],
    ["Settings", [
      st.steps && `${Number(st.steps).toLocaleString()} steps`,
      st.rank && `rank ${st.rank}`,
      st.learning_rate && `learning rate ${st.learning_rate}`,
      st.batch_size && `batch ${st.batch_size}`,
      st.resolution && `${[].concat(st.resolution).join("/")} px`,
      st.optimizer,
    ].filter(Boolean).join(" · ") || null],
    ["Trainer GPU", gpu ? `${gpu.name} · ${(gpu.memory.used / 1024).toFixed(1)} / ${(gpu.memory.total / 1024).toFixed(1)} GB · ${gpu.temperature}°C` : null],
    ["LoRA files", (status.files || []).length
      ? (status.files as { name: string; size_bytes: number }[]).map((f) => {
          const m = f.name.match(/_(\d+)\.safetensors$/);
          return m ? `step ${Number(m[1]).toLocaleString()}` : f.name;
        }).join(", ") + ` · ${Math.round(status.files[0].size_bytes / 1024 / 1024)} MB each`
      : "none saved yet"],
  ];

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-3">
      {facts.filter(([, v]) => v != null && v !== "").map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-gray-500">{label}</dt>
          <dd className="text-sm text-gray-200 tabular-nums truncate">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Latest loss with a small line of its history: falling means it's learning.
function LossValue({ history, latest }: { history: { step: number; value: number }[]; latest: number }) {
  const w = 80, h = 16;
  const values = history.map((p) => p.value);
  const max = Math.max(...values), min = Math.min(...values);
  const points = values.length > 1
    ? values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ")
    : null;
  return (
    <span className="inline-flex items-center gap-2">
      {latest.toFixed(4)}
      {points && (
        <svg width={w} height={h} className="text-brand" aria-hidden>
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </span>
  );
}

// Everything the trainer has produced for a job: sample sets, newest step
// first, so the user sees the LoRA improve, then the saved checkpoints.
// Refreshed every 30 s while the job is active.
function JobOutputs({ jobName, active }: { jobName: string; active: boolean }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [sources, setSources] = useState<PreviewSource[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/lora-training/jobs/${encodeURIComponent(jobName)}/preview-sources`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (!cancelled && body) setSources(body.sources || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [jobName]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const name = encodeURIComponent(jobName);
        const [sRes, cRes] = await Promise.all([
          fetch(`/api/lora-training/samples?job_name=${name}`),
          fetch(`/api/lora-training/checkpoints?job_name=${name}`),
        ]);
        if (cancelled) return;
        if (sRes.ok) {
          // ai-toolkit names samples ...__000000250_0.jpg; the step is in the name.
          // ...__000000250_1.jpg: step 250, preview prompt 1.
          const parsed: Sample[] = ((await sRes.json()).samples || []).map((path: string) => {
            const match = (path.split(/[\\/]/).pop() ?? path).match(/__([0-9]+)_([0-9]+)\./);
            return { name: path, step: match ? Number(match[1]) : null, index: match ? Number(match[2]) : null };
          });
          setSamples(parsed);
        }
        if (cRes.ok) setCheckpoints((await cRes.json()).checkpoints || []);
      } catch {
        // keep the last set shown
      }
    };
    load();
    const timer = active ? setInterval(load, 30000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [jobName, active]);

  // Newest first, so the latest previews are in view without scrolling (390 px too).
  const steps = [...new Set(samples.map((s) => s.step ?? -1))].sort((a, b) => b - a);
  if (steps.length === 0 && checkpoints.length === 0) return null;

  return (
    <div className="space-y-6">
      {steps.length > 0 && sources.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-sm font-medium text-white">Previews</h3>
          {sources.map((src) => {
            const shots = samples.filter((s) => s.index === src.index).sort((a, b) => (b.step ?? -1) - (a.step ?? -1));
            return (
              <figure key={src.index}>
                <div className="flex gap-2 overflow-x-auto snap-x pb-1">
                  {src.image && (
                    <a href={`${src.image}&full=true`} target="_blank" rel="noreferrer" title="Original training image" className="relative block w-28 shrink-0 snap-start">
                      <img src={src.image} alt="Original" loading="lazy" className={TILE_IMG} />
                      <span className="absolute bottom-1 left-1 rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-black">Original</span>
                    </a>
                  )}
                  {shots.map((s) => (
                    <div key={s.name} className="w-28 shrink-0 snap-start"><PreviewTile sample={s} /></div>
                  ))}
                </div>
                <figcaption className="mt-1 truncate text-[11px] text-gray-500" title={src.prompt}>{captionBody(src.prompt)}</figcaption>
              </figure>
            );
          })}
        </section>
      )}

      {steps.length > 0 && sources.length === 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-white">Previews</h3>
          <div className={TILE_GRID}>
            {steps.flatMap((step) => samples.filter((s) => (s.step ?? -1) === step).map((s) => <PreviewTile key={s.name} sample={s} />))}
          </div>
        </section>
      )}

      {checkpoints.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-white mb-2">LoRA files</h3>
          <div className="space-y-1">
            {checkpoints.map((ck) => (
              <div key={ck.name} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/50 transition-colors">
                <span className="text-xs font-mono text-brand w-12 flex-shrink-0">{ck.step ?? "final"}</span>
                <span className="text-xs font-mono text-gray-400 flex-1 min-w-0 truncate">{ck.name}</span>
                <span className="text-xs text-gray-500 flex-shrink-0">{(ck.size_bytes / 1024 / 1024).toFixed(0)} MB</span>
                <a
                  href={`/api/lora-training/checkpoints/download?name=${encodeURIComponent(ck.name)}`}
                  download={ck.name}
                  className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-gray-700 text-gray-500 hover:text-white transition flex-shrink-0"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
