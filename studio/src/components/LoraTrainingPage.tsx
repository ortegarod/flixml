import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Database, Download, FolderPlus, X } from "lucide-react";
import { useApp } from "../App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Dataset {
  id: string;
  name: string;
  description: string | null;
  image_count: number | null;
  created_at: string;
}

interface Sample {
  name: string;
  step: number | null;
}

interface Checkpoint {
  name: string;
  step: number | null;
  path: string;
  size_bytes: number;
  modified_at: string;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "training" || status === "running") return "default";
  if (status === "completed") return "secondary";
  if (status === "failed" || status === "error") return "destructive";
  return "outline";
}

function formatDate(iso: string | undefined | null): string {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function LoraTrainingPage() {
  const ctx = useApp();
  const jobs = ctx.trainingJobs ?? [];
  const live = ctx.training;

  // Live status of the latest job, polled by App from /api/lora-training/status.
  const effectiveLive = live;

  // Datasets
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [showAddDataset, setShowAddDataset] = useState(false);
  const [addDatasetId, setAddDatasetId] = useState("");
  const [addDatasetName, setAddDatasetName] = useState("");
  const [addDatasetDesc, setAddDatasetDesc] = useState("");
  const [addDatasetCount, setAddDatasetCount] = useState("");
  const [addDatasetSubmitting, setAddDatasetSubmitting] = useState(false);
  const [addDatasetError, setAddDatasetError] = useState<string | null>(null);

  const loadDatasets = useCallback(async () => {
    try {
      const res = await fetch("/api/lora-training/datasets");
      const data = await res.json();
      setDatasets(data.datasets || []);
    } catch {
      // ignore — non-critical
    } finally {
      setDatasetsLoading(false);
    }
  }, []);

  useEffect(() => { loadDatasets(); }, [loadDatasets]);

  const submitAddDataset = async () => {
    setAddDatasetError(null);
    setAddDatasetSubmitting(true);
    try {
      const res = await fetch("/api/lora-training/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: addDatasetId,
          name: addDatasetName || addDatasetId,
          description: addDatasetDesc || undefined,
          image_count: addDatasetCount ? parseInt(addDatasetCount, 10) : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Failed to register dataset");
      }
      setAddDatasetId("");
      setAddDatasetName("");
      setAddDatasetDesc("");
      setAddDatasetCount("");
      setShowAddDataset(false);
      loadDatasets();
    } catch (e: any) {
      setAddDatasetError(e.message);
    } finally {
      setAddDatasetSubmitting(false);
    }
  };

  const mergedJobs = jobs.map((job: any) => {
    // The jobs list already carries the trainer's status for active jobs
    // (server-side). The polled status adds total_steps / eta / speed for the
    // latest one.
    if (effectiveLive && effectiveLive.job_name === job.job_name && (effectiveLive.status === "running" || effectiveLive.status === "training")) {
      return { ...job, ...effectiveLive, _live: true };
    }
    return job;
  });

  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  // Cache samples + checkpoints per job so expanding one doesn't overwrite another.
  const [expandedData, setExpandedData] = useState<Map<string, { samples: Sample[]; checkpoints: Checkpoint[] }>>(new Map());
  const [loadingExpanded, setLoadingExpanded] = useState(false);

  const loadExpanded = useCallback(async (jobName: string) => {
    if (expandedData.has(jobName)) return; // already cached
    setLoadingExpanded(true);
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`/api/lora-training/samples?job_name=${jobName}`),
        fetch(`/api/lora-training/checkpoints?job_name=${jobName}`),
      ]);
      const sData = await sRes.json();
      const cData = await cRes.json();
      // ai-toolkit returns samples as flat file paths. Parse step number
      // from the filename pattern: ...__000000250_0.jpg
      const rawSamples: string[] = sData.samples || [];
      const parsedSamples: Sample[] = rawSamples.map((path) => {
        const basename = path.split("/").pop() ?? path;
        const match = basename.match(/__([0-9]+)_/);
        return { name: path, step: match ? Number(match[1]) : null };
      });
      setExpandedData(prev => {
        const next = new Map(prev);
        next.set(jobName, { samples: parsedSamples, checkpoints: cData.checkpoints || [] });
        return next;
      });
    } catch {
      setExpandedData(prev => {
        const next = new Map(prev);
        next.set(jobName, { samples: [], checkpoints: [] });
        return next;
      });
    } finally {
      setLoadingExpanded(false);
    }
  }, [expandedData]);

  const toggleJob = (jobName: string) => {
    if (expandedJob === jobName) {
      setExpandedJob(null);
    } else {
      setExpandedJob(jobName);
      loadExpanded(jobName);
    }
  };

  const completed = mergedJobs.filter((j: any) => j.status === "completed").length;
  const running = mergedJobs.filter((j: any) => j.status === "training" || j.status === "running").length;
  const failed = mergedJobs.filter((j: any) => j.status === "failed").length;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Characters &amp; LoRA Training</h1>
          <p className="text-sm text-gray-500 mt-1">
            Agents start training through the API. This page shows what the trainer reports.
          </p>
        </div>
      </div>

      <TrainerPanel studioJobNames={jobs.map((j: any) => j.job_name)} />

      {/* Datasets */}
      <section className="rounded-xl border border-gray-800/60 bg-gray-950 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-brand" />
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
              Training Datasets
              <span className="ml-2 text-xs font-mono text-gray-500">{datasets.length}</span>
            </h2>
          </div>
          <button
            onClick={() => setShowAddDataset(!showAddDataset)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-brand transition"
          >
            {showAddDataset ? <X className="w-3.5 h-3.5" /> : <FolderPlus className="w-3.5 h-3.5" />}
            {showAddDataset ? "Cancel" : "Add Dataset"}
          </button>
        </div>

        {showAddDataset && (
          <div className="px-5 py-4 border-b border-gray-800/40 bg-gray-900/20 space-y-3">
            <p className="text-xs text-gray-500">
              Register a remote dataset folder name. Start Training now fills it from gallery images marked for the selected character at{" "}
              <code className="text-gray-400 bg-black/40 px-1 rounded">/root/flixml/training/datasets/&lt;id&gt;/</code>.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide">Folder ID *</label>
                <Input
                  placeholder="e.g. atlas_v2_photos"
                  value={addDatasetId}
                  onChange={e => setAddDatasetId(e.target.value)}
                  className="bg-black/40 border-gray-700 text-white text-sm placeholder:text-gray-600"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide">Display Name</label>
                <Input
                  placeholder="Optional display name"
                  value={addDatasetName}
                  onChange={e => setAddDatasetName(e.target.value)}
                  className="bg-black/40 border-gray-700 text-white text-sm placeholder:text-gray-600"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide">Description</label>
                <Input
                  placeholder="e.g. Atlas reference photos v2"
                  value={addDatasetDesc}
                  onChange={e => setAddDatasetDesc(e.target.value)}
                  className="bg-black/40 border-gray-700 text-white text-sm placeholder:text-gray-600"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide">Image Count</label>
                <Input
                  type="number"
                  placeholder="e.g. 25"
                  value={addDatasetCount}
                  onChange={e => setAddDatasetCount(e.target.value)}
                  className="bg-black/40 border-gray-700 text-white text-sm placeholder:text-gray-600"
                />
              </div>
            </div>
            {addDatasetError && <p className="text-sm text-red-400">{addDatasetError}</p>}
            <Button
              onClick={submitAddDataset}
              disabled={addDatasetSubmitting || !addDatasetId}
              className="bg-brand hover:brightness-110 text-white text-sm"
            >
              {addDatasetSubmitting ? "Registering…" : "Register Dataset"}
            </Button>
          </div>
        )}

        {datasetsLoading ? (
          <p className="text-xs text-gray-500 px-5 py-6">Loading…</p>
        ) : datasets.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">
            No datasets registered. Add one above, then reference it when starting a training job.
          </p>
        ) : (
          <div className="divide-y divide-gray-800/40">
            {datasets.map(ds => (
              <div
                key={ds.id}
                className="px-5 py-3 flex items-center gap-4 hover:bg-gray-900/30 transition cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-brand-faint border border-brand-soft flex items-center justify-center flex-shrink-0">
                  <Database className="w-4 h-4 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{ds.name}</p>
                  <p className="text-[11px] text-gray-500 font-mono">{ds.id}{ds.description ? ` · ${ds.description}` : ""}</p>
                </div>
                {ds.image_count != null && (
                  <span className="text-[11px] text-gray-500 flex-shrink-0">{ds.image_count} images</span>
                )}
                <span className="text-[10px] text-gray-600 flex-shrink-0">{new Date(ds.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Total Jobs" value={jobs.length} />
        <StatBox label="Running" value={running} color="text-brand" />
        <StatBox label="Completed" value={completed} color="text-emerald-400" />
        <StatBox label="Failed" value={failed} color="text-red-400" />
      </div>

      {/* Jobs */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide px-1">
          Training Jobs
          <span className="ml-2 text-xs font-mono text-gray-500">{jobs.length}</span>
        </h2>

        {jobs.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">No training jobs yet.</p>
        ) : (
          mergedJobs.map((job: any) => {
            const hasLiveProgress = job.current_step > 0 && job.total_steps > 0;
            const isTraining = (job.status === "training" || job.status === "running") && hasLiveProgress;
            const isInitializing = (job.status === "running" || job.status === "training") && !hasLiveProgress && job._live && job.info;
            const progress = hasLiveProgress ? Math.round((job.current_step / job.total_steps) * 100) : 0;
            const isExpanded = expandedJob === job.job_name;
            const isLoading = isExpanded && loadingExpanded && !expandedData.has(job.job_name);
            const jobData = expandedData.get(job.job_name);
            const samples = jobData?.samples ?? [];
            const checkpoints = jobData?.checkpoints ?? [];

            return (
              <div key={job.job_name} className="rounded-xl border border-gray-800/60 bg-gray-950 overflow-hidden">
                {/* Card header — clickable */}
                <div
                  className="p-4 cursor-pointer hover:bg-gray-900/30 transition-colors"
                  onClick={() => toggleJob(job.job_name)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-white">{job.job_name}</span>
                        <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                        {job.model && <span className="text-[11px] text-gray-600">{job.model}</span>}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">
                        {[job.trigger_word && `trigger: ${job.trigger_word}`, job.dataset].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] text-gray-600 hidden sm:block">{formatDate(job.created_at)}</span>
                      <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </div>

                  {/* Progress / status */}
                  {isTraining && (
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Progress value={progress} className="h-1.5 flex-1 bg-gray-800 [&>div]:bg-brand" />
                        <span className="text-[11px] font-mono text-brand tabular-nums w-8 text-right">{progress}%</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 font-mono">
                        <span>Step {job.current_step}/{job.total_steps}</span>
                        {job.seconds_per_step ? <span>{job.seconds_per_step.toFixed(1)}s/step</span> : null}
                        {job.lr != null ? <span>lr {Number(job.lr).toExponential(1)}</span> : null}
                        {job.eta ? <span>{job.eta} left</span> : null}
                      </div>
                      {job.info && <p className="text-[10px] text-gray-500">ai-toolkit: {job.info}</p>}
                    </div>
                  )}

                  {isInitializing && (
                    <div className="flex items-center gap-2 mt-2 text-sm text-brand">
                      <span className="inline-block w-2 h-2 rounded-full bg-brand animate-pulse flex-shrink-0" />
                      ai-toolkit: {job.info}
                    </div>
                  )}

                  {job.status === "completed" && job.total_steps > 0 && (
                    <p className="text-[11px] text-gray-500 font-mono mt-1.5">
                      {job.total_steps} steps
                      {job.elapsed ? ` · ${job.elapsed}` : ""}
                      {job.loss != null ? ` · final loss ${job.loss.toFixed(4)}` : ""}
                    </p>
                  )}

                  {job.status === "unreachable" && job.error && (
                    <p className="text-[11px] text-amber-400/70 mt-1.5 line-clamp-2">{job.error}</p>
                  )}

                  {(job.status === "failed" || job.status === "error") && (job.error || job.info) && (
                    <p className="text-[11px] text-red-400/70 mt-1.5 line-clamp-2">{job.error || job.info}</p>
                  )}
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-gray-800/60 px-4 py-4 space-y-5 bg-gray-900/30">
                    {isLoading ? (
                      <p className="text-sm text-gray-500">Loading…</p>
                    ) : (
                      <>
                        <TrainerLog jobName={job.job_name} active={["running", "training", "pending", "queued", "stopping"].includes(job.status)} />

                        {/* Training samples */}
                        {samples.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                              Training Samples ({samples.length})
                            </h4>
                            <div className="flex gap-3 overflow-x-auto pb-2">
                              {samples.map((s) => (
                                <div key={s.name} className="flex-shrink-0 w-24 rounded-lg border border-gray-800 bg-black/40 overflow-hidden">
                                  <img
                                    src={`/api/lora-training/sample-image?path=${encodeURIComponent(s.name)}`}
                                    alt={`Sample step ${s.step}`}
                                    className="w-full aspect-square object-cover"
                                  />
                                  <div className="px-1.5 py-1 text-[10px] text-gray-500 font-mono text-center">
                                    Step {s.step ?? "?"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Checkpoints */}
                        {checkpoints.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                              Checkpoints ({checkpoints.length})
                            </h4>
                            <div className="space-y-1">
                              {checkpoints.map((ck) => (
                                <div key={ck.name} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/50 transition-colors">
                                  <span className="text-xs font-mono text-brand w-10 flex-shrink-0">{ck.step ?? "final"}</span>
                                  <span className="text-xs font-mono text-gray-400 flex-1 min-w-0 truncate">{ck.name}</span>
                                  <span className="text-xs text-gray-500 flex-shrink-0">{(ck.size_bytes / 1024 / 1024).toFixed(0)} MB</span>
                                  <span className="text-xs text-gray-600 flex-shrink-0 hidden sm:block">{new Date(ck.modified_at).toLocaleDateString()}</span>
                                  <a
                                    href={`/api/lora-training/checkpoints/download?name=${encodeURIComponent(ck.name)}`}
                                    download={ck.name}
                                    onClick={e => e.stopPropagation()}
                                    className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-gray-700 text-gray-500 hover:text-white transition flex-shrink-0"
                                    title="Download checkpoint"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {samples.length === 0 && checkpoints.length === 0 && (
                          <p className="text-sm text-gray-600">No samples or checkpoints for this job.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Live view of the trainer itself — what ai-toolkit reports, nothing inferred.
function TrainerPanel({ studioJobNames }: { studioJobNames: string[] }) {
  const [trainer, setTrainer] = useState<any>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/lora-training/trainer");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        setTrainer(data);
        setFetchError(null);
      } catch (e: any) {
        if (!cancelled) setFetchError(e.message);
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const reachable = trainer?.reachable === true;
  // Jobs Studio started are listed under Training Jobs; only show the rest here.
  const otherJobs = (trainer?.jobs || []).filter((job: any) => !studioJobNames.includes(job.job_ref) && !studioJobNames.includes(job.name));
  const dot = reachable ? "bg-emerald-400" : "bg-red-400";

  return (
    <section className="rounded-xl border border-gray-800/60 bg-gray-950 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${trainer ? dot : "bg-gray-600"}`} />
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Trainer</h2>
          {trainer && (
            <span className={`text-xs ${reachable ? "text-emerald-400" : "text-red-400"}`}>
              {reachable ? "connected" : trainer.error}
            </span>
          )}
        </div>
        {trainer?.url && <span className="text-[11px] font-mono text-gray-500">ai-toolkit · {trainer.url}</span>}
      </div>

      {fetchError && <p className="text-xs text-red-400">Studio API: {fetchError}</p>}
      {trainer && !trainer.configured && <p className="text-xs text-gray-400">{trainer.error}</p>}

      {reachable && (
        <>
          <div className="space-y-1.5">
            {(trainer.gpus || []).map((gpu: any) => (
              <div key={gpu.index} className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-gray-400">
                <span className="text-gray-200">GPU {gpu.index}: {gpu.name}</span>
                <span>{gpu.memory?.used} / {gpu.memory?.total} MB</span>
                <span>{gpu.utilization?.gpu}% util</span>
                <span>{gpu.temperature}°C</span>
                <span>{gpu.power?.draw?.toFixed?.(0)} / {gpu.power?.limit} W</span>
              </div>
            ))}
            {(trainer.queues || []).map((q: any) => (
              <p key={q.gpu_ids} className="text-xs font-mono text-gray-400">
                Queue GPU {q.gpu_ids}: <span className={q.is_running ? "text-emerald-400" : "text-gray-500"}>{q.is_running ? "running" : "stopped"}</span>
              </p>
            ))}
          </div>

          {otherJobs.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">On the trainer, not started by Studio ({otherJobs.length})</h3>
              <div className="space-y-1.5">
                {otherJobs.map((job: any) => (
                  <div key={job.id} className="rounded-lg border border-gray-800 bg-black/40 px-3 py-2 text-xs font-mono">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-gray-200">{job.name}</span>
                      <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                      {job.total_steps ? <span className="text-gray-400">step {job.step}/{job.total_steps}</span> : job.step ? <span className="text-gray-400">step {job.step}</span> : null}
                      {job.speed_string && <span className="text-gray-500">{job.speed_string}</span>}
                      {job.updated_at && <span className="text-gray-600">updated {formatDate(job.updated_at)}</span>}
                    </div>
                    {job.info && <p className="mt-1 text-gray-500">ai-toolkit: {job.info}</p>}
                  </div>
                ))}
              </div>
          </div>
          )}

          {trainer.folders && (
            <p className="text-[11px] font-mono text-gray-600">
              datasets: {trainer.folders.datasets} · output: {trainer.folders.training}
            </p>
          )}
        </>
      )}

      {trainer?.checked_at && <p className="text-[10px] text-gray-600">Checked {formatDate(trainer.checked_at)} · every 5 s</p>}
    </section>
  );
}

// The trainer's own log, passed through from ai-toolkit. Polled while the job
// is active; a progress bar rewrites its line with \r, so only the last
// rewrite of each line is shown.
function TrainerLog({ jobName, active }: { jobName: string; active: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const offsetRef = React.useRef<number | null>(null);
  const boxRef = React.useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    offsetRef.current = null;
    setText("");
    const poll = async () => {
      const q = offsetRef.current == null ? "" : `&offset=${offsetRef.current}`;
      try {
        const res = await fetch(`/api/lora-training/log?job_name=${encodeURIComponent(jobName)}${q}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.detail || `HTTP ${res.status}`);
          return;
        }
        setError(null);
        offsetRef.current = data.offset;
        setText((prev) => (data.reset ? data.log : prev + data.log));
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    };
    poll();
    const timer = active ? setInterval(poll, 3000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [jobName, active]);

  const shown = React.useMemo(
    () => text.split("\n").map((line) => line.split("\r").filter(Boolean).pop() ?? "").slice(-400).join("\n"),
    [text],
  );

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown]);

  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Trainer log</h4>
      {error ? (
        <p className="text-[11px] text-amber-400/70">{error}</p>
      ) : (
        <pre ref={boxRef} className="max-h-72 overflow-auto rounded-lg border border-gray-800 bg-black/60 p-3 text-[11px] leading-relaxed text-gray-300 font-mono whitespace-pre-wrap">
          {shown || "The trainer has written no log for this job."}
        </pre>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-black/40 p-3 text-center">
      <p className={`text-lg font-bold ${color || "text-white"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
    </div>
  );
}
