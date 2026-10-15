import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { X, ChevronDown, ChevronLeft, ChevronRight, Trash2, Copy, Check, Download, Plus, Pencil, AudioLines } from "lucide-react";
import type { GraphSettings, JobItem, MediaItem, MediaMetadataPatch, SamplerPass } from "../types";
import { assetReference, copyText } from "../lib/agentContext";
import { DeleteDialog } from "./DeleteDialog";
import { PendingMediaTile } from "./PendingMediaTile";
import { selectedJobId } from "../lib/jobSelection";

// Minimal shape of the /api/workflows entries we surface as remix options.
interface WorkflowMeta {
  id: string;
  name: string;
  task: string;
  output_type: string;
  requirements?: Record<string, any>;
}

// What this asset can feed, by the task each workflow takes as input. An image
// can start eight different jobs; a clip can start one. Anything not listed here
// starts from text, so it has nothing to do with the asset you're looking at.
const REMIX_INTENT: Record<string, string> = {
  "image-to-video": "Animate this image into a short video clip with this workflow. Suggest a natural motion (I'll give you a voice line if it needs one).",
  "image-to-image": "Make a variation/edit of this image using this workflow.",
  "face-reference-to-image": "Generate new images of this subject using it as a face/character reference, with this workflow.",
  "first-last-frame-to-video": "Use this image as a keyframe for a short video with this workflow.",
  "video-to-video": "Use this clip as the input to this workflow, keeping its motion. I'll give you the voice line.",
};
const IMAGE_TASKS = ["image-to-image", "image-to-video", "face-reference-to-image", "first-last-frame-to-video"];
const VIDEO_TASKS = ["video-to-video"];

// Raw metadata blob straight off the API — we surface every field it exposes
// rather than a hand-picked subset, so per-workflow params (guidance, denoise,
// source image, provider, node counts, …) never get silently dropped.
interface ImageDetail {
  meta: Record<string, any>;
  completed_at: string | null;
}

// One row of the record. A value long enough to fight the label — a prompt, a
// path, a filename — gets the full width underneath it instead.
function MetaRow({ label, value }: { label: string; value: string }) {
  if (value.length > 42) {
    return (
      <div className="py-1.5 border-b border-gray-800/50">
        <span className="block text-[11px] text-gray-500">{label}</span>
        <span className="block text-[11px] text-gray-300 font-mono break-all leading-relaxed">{value}</span>
      </div>
    );
  }
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-gray-800/50">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className="text-[11px] text-gray-300 text-right font-mono break-all">{value}</span>
    </div>
  );
}

// A fact about the asset itself — what it is, when it ran. Reads as a sentence,
// not as a database field, so it stays out of the mono record styling. Always
// renders, empty or not: this block is the first thing compared between two assets
// and a row that disappears takes the alignment with it.
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3 py-[3px]">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className={`text-[11px] text-right ${value ? "text-gray-200" : "text-gray-600"}`}>{value || "none"}</span>
    </div>
  );
}

// snake_case / camelCase → readable label, with a few domain acronyms fixed up.
function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words
    .join(" ")
    .replace(/\bId\b/g, "ID")
    .replace(/\bIds\b/g, "IDs")
    .replace(/\bCfg\b/g, "CFG")
    .replace(/\bLora\b/g, "LoRA")
    .replace(/\bUrl\b/g, "URL")
    .replace(/\bVae\b/g, "VAE")
    .replace(/\bFps\b/g, "FPS")
    .replace(/\bBg\b/g, "Background");
}

// Keys whose humanized form reads wrong or says too little on its own.
const LABEL_OVERRIDE: Record<string, string> = {
  loras: "LoRAs",
  lora_name: "LoRA file",
  lora_strength: "LoRA strength",
  high_lora_strength: "LoRA 1 strength (high)",
  low_lora_strength: "LoRA 1 strength (low)",
  high_lora_2: "LoRA 2 (high)",
  low_lora_2: "LoRA 2 (low)",
  high_lora_2_strength: "LoRA 2 strength (high)",
  low_lora_2_strength: "LoRA 2 strength (low)",
  image: "Source image",
  dimensions: "Dimensions",
  unet: "UNet",
  submit: "Submitted to node",
  length: "Length (frames)",
};

// Collapse any value (scalar / array / object) into a display string, or null to skip.
function formatMetaValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  }
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    return json === "{}" ? null : json;
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

// A sampling pass as one line: "6 steps · CFG 3.5 · euler". Wan's second pass reads
// the same way, so two passes stack into two lines rather than a merged fiction.
function passSummary(pass: SamplerPass): string {
  const parts: string[] = [];
  if (pass.steps !== undefined) parts.push(`${pass.steps} steps`);
  if (pass.cfg !== undefined) parts.push(`CFG ${pass.cfg}`);
  if (pass.denoise !== undefined && pass.denoise !== 1) parts.push(`denoise ${pass.denoise}`);
  if (pass.shift !== undefined) parts.push(`shift ${pass.shift}`);
  if (pass.sampler) parts.push(pass.sampler);
  if (pass.scheduler) parts.push(pass.scheduler);
  return parts.join(" · ");
}

// "Sep 20, 2026 · 4:18 PM" in the reader's own timezone. A stamp beats "5 min ago"
// here: this rail is the record of a job, and a record that changes as you read it
// can't be compared with the one next to it.
function formatStamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

// How long the node actually held this job. Falls back to submit time for rows
// from before run times were recorded.
function elapsedLabel(item: MediaItem): string | null {
  const start = item.started_at || item.submitted_at;
  if (!start || !item.finished_at) return null;
  const ms = new Date(item.finished_at).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function sizeLabel(settings: GraphSettings | null | undefined, item: MediaItem): string | null {
  const width = settings?.width ?? item.width;
  const height = settings?.height ?? item.height;
  if (!width || !height) return null;
  return `${width}×${height}`;
}

// The file's own length when the player has read it. The graph's frames ÷ fps is only
// a fallback: an audio-driven clip (InfiniteTalk) gets its length from the voice line
// inside ComfyUI, so its graph carries no frame count at all.
function durationLabel(settings: GraphSettings | null | undefined, fileSeconds: number | null): string | null {
  const seconds = fileSeconds ?? (settings?.frames && settings?.fps ? settings.frames / settings.fps : null);
  if (!seconds) return null;
  return `${seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10} seconds`;
}

// The agent id that submitted the job, as a name. Ids are lowercase handles;
// nothing in the record carries a display name for them yet.
function ownerLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// The graph's own settings, read back off what the node actually ran — including
// params the caller never passed. Always the same five rows in the same order so
// two assets line up: a one-pass image reads `none` under Pass (low), and an asset
// with four LoRAs still spends one row on them rather than four.
const GRAPH_COVERED = ["checkpoint", "seed", "steps", "cfg", "sampler", "scheduler", "fps", "loras"];

// What made this asset. The graph first; the call fills a row only where the graph is
// silent, which over those 600 assets happened for `seed` on three and nothing else.
function settingsRows(
  settings: GraphSettings | null | undefined,
  models: string[] | undefined,
  requested: Record<string, any>,
): Array<{ label: string; value: string }> {
  const passes = settings?.passes || [];
  const seed = passes.find((pass) => pass.seed !== undefined && pass.seed !== 0)?.seed;
  const loras = settings?.loras || [];
  const or = (value: string | null, fallback: any) => value ?? formatMetaValue(fallback) ?? "none";
  return [
    { label: "Model", value: or(models?.length ? models.join(", ") : null, requested.checkpoint) },
    { label: "Pass (high)", value: (passes[0] && passSummary(passes[0])) || "none" },
    { label: "Pass (low)", value: (passes[1] && passSummary(passes[1])) || "none" },
    { label: "Seed", value: or(seed !== undefined ? String(seed) : null, requested.seed) },
    {
      label: "Frames",
      value: settings?.frames ? `${settings.frames}${settings.fps ? ` @ ${settings.fps}fps` : ""}` : "none",
    },
    {
      label: "LoRAs",
      value: or(
        loras.length
          ? loras.map((l) => (l.strength === undefined ? l.name : `${l.name} @ ${l.strength}`)).join(", ")
          : null,
        requested.loras,
      ),
    },
  ];
}

const RECORD_GROUPS: Array<{ title: string; keys: string[] }> = [
  // Everything GRAPH_COVERED names is gone from these lists — it is already answered
  // once, above, by the graph. What is left is what the graph cannot see: where the job
  // was routed, and the params that shape a pass without appearing on a sampler node.
  { title: "Routing", keys: ["workflow", "provider", "output_type", "mode", "unet", "vae", "clip"] },
  { title: "Subject", keys: ["character", "characters", "character_ids"] },
  {
    title: "Sampling",
    keys: [
      "steps_high", "steps_low", "total_steps",
      "cfg_high", "cfg_low", "guidance",
      "denoise", "denoise_strength", "shift",
    ],
  },
  {
    title: "LoRA",
    keys: [
      "lora_name", "lora_strength",
      "high_lora_strength", "low_lora_strength",
      "high_lora_2", "high_lora_2_strength", "low_lora_2", "low_lora_2_strength",
    ],
  },
  { title: "Geometry", keys: ["dimensions", "length", "reference_megapixels"] },
  {
    title: "Context window",
    keys: ["context_length", "context_overlap", "context_schedule", "cond_retain_index_list", "fuse_method", "blocks_to_swap"],
  },
  { title: "Text overlay", keys: ["text", "text_x", "text_y", "font", "font_size", "font_color", "bg_color"] },
  { title: "Inputs", keys: ["image", "resolved_image", "audio", "video", "last_frame_of", "stitched_from"] },
  {
    title: "Run",
    keys: ["progress_percent", "nodes_finished", "nodes_total", "nodes_running", "current_node", "step_value", "step_max"],
  },
  { title: "Bookkeeping", keys: ["filename_prefix", "session_id", "owner_id", "submit", "completed_at"] },
];

const RECORD_FIELDS = RECORD_GROUPS.flatMap((group) => group.keys);

interface RecordGroup {
  title: string;
  rows: Array<{ label: string; value: string }>;
}

// The whole record as fixed, titled groups, each fact appearing exactly once. The graph
// answers everything it saw; the call answers only what the graph cannot see. An earlier
// version printed both side by side — see GRAPH_COVERED for the survey that killed it.
function buildRecordGroups(detail: ImageDetail, item: MediaItem | null): RecordGroup[] {
  const meta = detail.meta || {};
  const wp = (meta.workflow_params as Record<string, any>) || {};
  // workflow_params first, top-level metadata wins on key collisions.
  const merged: Record<string, any> = { ...wp, ...meta };
  const negative = merged.negative_prompt ?? wp.negative_prompt ?? null;
  delete merged.prompt;
  delete merged.negative_prompt;
  // A caption passed at generate time echoes into metadata, but it already has its
  // own line at the top of the rail — printing it again under Other reads as a field
  // that fell through the schema when it didn't.
  delete merged.description;
  delete merged.workflow_params;
  if (detail.completed_at && !merged.completed_at) merged.completed_at = detail.completed_at;

  // Prefer a combined dimensions row when we have both.
  const w = merged.width ?? item?.width;
  const h = merged.height ?? item?.height;
  if (w && h) {
    merged.dimensions = `${w}x${h}`;
    delete merged.width;
    delete merged.height;
  }
  // The graph answers these; keep a copy for the rows it leaves empty, then take them
  // out of the blob so they can't print a second time under a group or under Other.
  const requested: Record<string, any> = {};
  for (const key of GRAPH_COVERED) {
    if (key in merged) requested[key] = merged[key];
    delete merged[key];
  }

  if (merged.completed_at) {
    const d = new Date(merged.completed_at);
    if (!Number.isNaN(d.getTime())) merged.completed_at = d.toLocaleString();
  }

  const emit = (key: string) => {
    const val = formatMetaValue(merged[key]);
    delete merged[key];
    return { label: LABEL_OVERRIDE[key] || humanizeKey(key), value: val ?? "none" };
  };

  const groups: RecordGroup[] = [
    { title: "How it was made", rows: settingsRows(item?.settings, item?.models, requested) },
    {
      title: "Prompt",
      rows: [{ label: "Negative", value: formatMetaValue(negative) ?? "none" }],
    },
    ...RECORD_GROUPS.map((group) => ({ title: group.title, rows: group.keys.map(emit) })),
  ];

  // Anything the schema above doesn't name. Normally empty; when it isn't, the key
  // it shows is one RECORD_GROUPS needs.
  const leftover = Object.keys(merged)
    .sort()
    .map((key) => ({ key, value: formatMetaValue(merged[key]) }))
    .filter((entry) => entry.value !== null)
    .map((entry) => ({ label: LABEL_OVERRIDE[entry.key] || humanizeKey(entry.key), value: entry.value as string }));
  if (leftover.length) groups.push({ title: "Other", rows: leftover });

  return groups;
}

interface LightboxProps {
  items: MediaItem[];
  selectedUrl: string | null;
  onClose: () => void;
  onSelect: (url: string | null) => void;
  onUpdateMetadata: (item: MediaItem, patch: MediaMetadataPatch) => Promise<void>;
  onDelete: (item: MediaItem, reason?: string) => Promise<void>;
  // Open the profile of the account that submitted this job. The lightbox stays
  // router-free; App closes it and navigates, the same way the sidebar does.
  onOpenOwner: (ownerId: string) => void;
  // Jobs that may have no file yet. Selecting `job:<prompt_id>` opens one of these.
  jobs?: JobItem[];
}

// A job row's saved metadata. /api/jobs sends it as a JSON string.
function jobMeta(job: JobItem): Record<string, any> {
  const raw = job.metadata;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through to the flattened row
    }
  }
  return job as Record<string, any>;
}

function fileExt(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toUpperCase() : "";
}

export function Lightbox({ items, selectedUrl, onClose, onSelect, onUpdateMetadata, onDelete, onOpenOwner, jobs = [] }: LightboxProps) {
  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Files the asset's job wrote alongside it (an FBX, a GLB): downloads, never shown.
  const [jobFiles, setJobFiles] = useState<{ filename: string; url: string }[]>([]);
  const [tagsDraft, setTagsDraft] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [sourceThumbFailed, setSourceThumbFailed] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // The phone and desktop layouts are both in the DOM, one hidden by CSS. A hidden
  // <video autoPlay> still plays its sound, so a clip with audio played twice, a beat
  // apart. Only the layout on screen gets the media element.
  const desktopQuery = "(min-width: 768px)"; // Tailwind `md`, the breakpoint the layouts switch on
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(desktopQuery).matches);
  useEffect(() => {
    const mq = window.matchMedia(desktopQuery);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Read off the playing <video> once its metadata loads; cleared when the asset changes.
  const [videoSeconds, setVideoSeconds] = useState<number | null>(null);
  useEffect(() => setVideoSeconds(null), [selectedUrl]);
  const onVideoMetadata = (e: React.SyntheticEvent<HTMLMediaElement>) => {
    const d = e.currentTarget.duration;
    setVideoSeconds(Number.isFinite(d) && d > 0 ? d : null);
  };

  const flashCopied = useCallback((key: string) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
  }, []);

  // Available workflows, fetched live so remix stays in sync as workflows are
  // added — no hardcoded menu. Node VRAM comes with it: a workflow this install
  // has no card big enough for isn't something you can remix into.
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([]);
  const [vramCeiling, setVramCeiling] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((data: WorkflowMeta[]) => setWorkflows(Array.isArray(data) ? data : []))
      .catch(() => {});
    fetch("/api/nodes")
      .then((r) => r.json())
      .then((data: { nodes?: Array<{ vram_gb?: number | null }> }) => {
        const ceiling = (data?.nodes || []).reduce((max, node) => Math.max(max, node.vram_gb || 0), 0);
        if (ceiling > 0) setVramCeiling(ceiling);
      })
      .catch(() => {});
  }, []);

  const currentIndex = items.findIndex((i) => i.url === selectedUrl || i.thumb === selectedUrl);
  const current = currentIndex >= 0 ? items[currentIndex] : null;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;

  // A job opened before its file exists. The jobs list is refetched on every server
  // push, so this record stays live; the last copy is kept if the job drops off it.
  const pendingId = selectedJobId(selectedUrl);
  const liveJob = pendingId ? jobs.find((job) => job.prompt_id === pendingId) ?? null : null;
  const lastJob = useRef<JobItem | null>(null);
  if (liveJob) lastJob.current = liveJob;
  const pendingJob = liveJob ?? (pendingId && lastJob.current?.prompt_id === pendingId ? lastJob.current : null);
  const pendingDetail = useMemo<ImageDetail | null>(
    () => (pendingJob ? { meta: jobMeta(pendingJob), completed_at: null } : null),
    [pendingJob],
  );
  // The graph read-back a finished asset carries on the item, taken from the job row.
  const pendingAsItem = pendingJob
    ? ({ settings: pendingJob.settings, models: pendingJob.models, width: 0, height: 0 } as unknown as MediaItem)
    : null;

  // When the render lands, show the file in the same lightbox.
  useEffect(() => {
    if (!pendingId) return;
    const output = items.find((item) => item.prompt_id === pendingId);
    if (output) onSelect(output.url);
  }, [pendingId, items, onSelect]);

  const goTo = useCallback((index: number) => {
    const target = items[index];
    if (target) onSelect(target.url);
  }, [items, onSelect]);

  const goPrev = useCallback(() => { if (hasPrev) goTo(currentIndex - 1); }, [hasPrev, currentIndex, goTo]);
  const goNext = useCallback(() => { if (hasNext) goTo(currentIndex + 1); }, [hasNext, currentIndex, goTo]);

  // Horizontal-swipe navigation for touch (mobile). Tracked on the image only so
  // it never fights the vertical scroll of the metadata sheet below it.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }, []);
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return; // ignore taps / vertical scrolls
    if (dx > 0) goPrev();
    else goNext();
  }, [goPrev, goNext]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (deleteOpen) return; // the confirm dialog owns the keyboard while it's up
      // While a field has focus the arrows belong to the text, not the gallery:
      // moving the caret through a caption must not jump to the next asset.
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) {
        if (e.key === "Escape") (target as HTMLInputElement).blur();
        return;
      }
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext, deleteOpen]);

  useEffect(() => {
    setTagsDraft((current?.tags || []).join(", "));
    setEditingTags(false);
    setDescriptionDraft(current?.description || "");
    setEditingDescription(false);
  }, [current?.filename, current?.url, current?.description]);

  useEffect(() => {
    setDetail(null);
    setSourceThumbFailed(false);
    // Use metadata from the listing item if available (avoids extra fetch)
    if (current?.metadata && Object.keys(current.metadata).length > 0) {
      setDetail({ meta: current.metadata, completed_at: null });
      setDetailLoading(false);
      return;
    }
    // Fallback: fetch from API (legacy path for items without metadata)
    const mediaPath = current?.filename || current?.name;
    const detailUrl = current?.prompt_id
      ? `/api/jobs/${current.prompt_id}`
      : mediaPath
        ? `/api/media/${mediaPath.split("/").map(encodeURIComponent).join("/")}`
        : null;
    if (!detailUrl) return;
    setDetailLoading(true);
    fetch(detailUrl)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return null;
        // Prefer the nested metadata blob; fall back to the raw response for
        // legacy rows that expose fields at the top level.
        const meta =
          data.metadata && Object.keys(data.metadata).length > 0 ? data.metadata : data;
        return { meta, completed_at: data.completed_at || null } as ImageDetail;
      })
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [current?.prompt_id, current?.filename, current?.name, current?.metadata]);

  useEffect(() => {
    setJobFiles([]);
    if (!current?.prompt_id) return;
    let cancelled = false;
    fetch(`/api/jobs/${current.prompt_id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const outputs: { type: string; filename: string; url: string }[] = data.outputs || [];
        setJobFiles(outputs.filter((o) => o.type === "file"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current?.prompt_id]);

  if (!selectedUrl) return null;

  const isVideo = pendingId
    ? pendingJob?.output_type === "video"
    : current?.type === "video" || selectedUrl.endsWith(".mp4") || selectedUrl.endsWith(".webm");
  const isAudio = pendingId ? pendingJob?.output_type === "audio" : current?.type === "audio";
  const kind = isVideo ? "video" : isAudio ? "audio" : "image";
  const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
  const shownDetail = pendingId ? pendingDetail : detail;
  const pendingStatus = !pendingJob
    ? null
    : pendingJob.status === "failed"
      ? "Failed"
      : pendingJob.status === "completed"
        ? "Done"
        : pendingJob.started_at
          ? "Rendering"
          : "Queued";

  const identifier = current?.filename || current?.name;
  const displayName = identifier ? identifier.split("/").pop() : null;

  async function deleteCurrent(reason: string) {
    if (!current || deleting) return;
    setDeleting(true);
    const nextUrl = hasNext ? items[currentIndex + 1]?.url : hasPrev ? items[currentIndex - 1]?.url : null;
    try {
      await onDelete(current, reason);
      setDeleteOpen(false);
      onSelect(nextUrl || null);
      if (!nextUrl) onClose();
    } finally {
      setDeleting(false);
    }
  }

  async function saveTags() {
    if (!current || savingMetadata) return;
    setSavingMetadata(true);
    try {
      const tags = tagsDraft
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      await onUpdateMetadata(current, { tags });
      setEditingTags(false);
    } finally {
      setSavingMetadata(false);
    }
  }

  async function saveDescription() {
    if (!current || savingMetadata) return;
    setSavingMetadata(true);
    try {
      // Send the draft even when it is empty — that is how a caption gets removed.
      await onUpdateMetadata(current, { description: descriptionDraft.trim() });
      setEditingDescription(false);
    } finally {
      setSavingMetadata(false);
    }
  }

  async function toggleTrainingDataset() {
    if (!current || savingMetadata) return;
    setSavingMetadata(true);
    try {
      await onUpdateMetadata(current, {
        included_in_training_dataset: !current.included_in_training_dataset,
      });
    } finally {
      setSavingMetadata(false);
    }
  }

  // Jump to the image a clip was generated from. It is usually a few rows further
  // down the same gallery page; when it isn't loaded, open the file itself.
  function openSource(path: string) {
    const match = items.find((candidate) => candidate.filename === path || candidate.name === path.split("/").pop());
    if (match) onSelect(match.url);
    else window.open(`/media/${path}`, "_blank");
  }

  // Copy this asset's reference plus what the human wants done with it. The agent
  // looks the asset up itself, so nothing technical has to be pasted by hand.
  function copyRemix(instruction: string, key: string) {
    if (!current) return;
    copyText(`${assetReference(current)} — ${instruction}`);
    flashCopied(key);
  }

  // What this asset can actually feed: workflows that take its output type as
  // input, minus any needing more VRAM than the biggest node here has. Each one
  // hands the agent this asset + a plain-English next step — Studio is
  // agent-driven, the frontend never fires a render itself.
  const eligibleTasks = isAudio ? [] : isVideo ? VIDEO_TASKS : IMAGE_TASKS;
  const remixActions = !current
    ? []
    : workflows
        .filter((w) => eligibleTasks.includes(w.task))
        .filter((w) => vramCeiling === null || !w.requirements?.vram_gb || w.requirements.vram_gb <= vramCeiling)
        .map((w) => ({
          key: w.id,
          label: w.name,
          instruction: `Use this ${kind} as the input to the "${w.name}" workflow (${w.task}). ${REMIX_INTENT[w.task]}`,
        }));

  const ownerId: string | null = (shownDetail?.meta?.owner_id as string) || null;
  // The image this job started from. Video jobs record it at the top level;
  // image-to-image workflows pass it through as a graph param, so both places
  // have to be read or an edit looks like it came from nothing.
  const sourcePath: string | null =
    (shownDetail?.meta?.image as string) ||
    ((shownDetail?.meta?.workflow_params as Record<string, any>)?.image as string) ||
    null;
  // An edit's input is a reference; a clip's input is the frame it starts on.
  const sourceLabel = isVideo ? "From this image" : "Reference image";
  const tags = current?.tags || [];

  const metaContent = (
    <>
      {/* Who made it. The rail reads like a post: author first, then the thing —
          and the author is a link to everything else that account made. */}
      {ownerId && (
        <button
          onClick={() => onOpenOwner(ownerId)}
          title={`See everything ${ownerLabel(ownerId)} made`}
          className="group mb-3 flex items-center gap-2 text-left"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-800 text-[11px] font-semibold uppercase text-gray-300 transition group-hover:bg-brand group-hover:text-brand-foreground">
            {ownerId.charAt(0)}
          </span>
          <span className="truncate text-sm font-medium text-white transition group-hover:text-brand">
            {ownerLabel(ownerId)}
          </span>
        </button>
      )}

      {/* The caption. Nothing renders here until someone writes one, so an asset
          without a description looks exactly as it did before this existed — the
          way in is the pencil on the filename row below. */}
      {editingDescription ? (
        <div className="mb-2">
          <textarea
            autoFocus
            rows={3}
            value={descriptionDraft}
            onChange={(event) => setDescriptionDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) saveDescription();
            }}
            placeholder="What is this?"
            className="w-full resize-y rounded-md border border-gray-800 bg-black/30 px-2 py-1.5 text-[13px] leading-relaxed text-gray-200 placeholder:text-gray-700 focus:border-brand focus:outline-none"
          />
          <div className="mt-1 flex items-center gap-1.5">
            <button
              onClick={saveDescription}
              disabled={savingMetadata}
              className="rounded-md bg-gray-800 px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:bg-brand hover:text-brand-foreground disabled:text-gray-600"
            >
              {savingMetadata ? "…" : "Save"}
            </button>
            <button
              onClick={() => { setDescriptionDraft(current?.description || ""); setEditingDescription(false); }}
              disabled={savingMetadata}
              className="rounded-md px-2 py-1 text-[11px] text-gray-500 transition hover:text-gray-300 disabled:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : current?.description ? (
        <p
          onClick={() => setEditingDescription(true)}
          title="Edit description"
          className="mb-2 cursor-text whitespace-pre-wrap text-[13px] leading-relaxed text-gray-200 transition hover:text-white"
        >
          {current.description}
        </p>
      ) : null}

      {displayName && (
        <div className="group/name flex items-start gap-1.5">
          <p className="min-w-0 break-all text-[11px] text-gray-400" title={identifier}>{displayName}</p>
          {!editingDescription && !current?.description && (
            <button
              onClick={() => setEditingDescription(true)}
              title="Add a description"
              className="mt-px shrink-0 text-gray-700 opacity-0 transition hover:text-gray-300 focus:opacity-100 group-hover/name:opacity-100"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {current && <div className="mt-1.5 mb-4 flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span key={tag} className="rounded-full border border-gray-800 bg-black/30 px-2 py-0.5 text-[10px] text-gray-300">
            {tag}
          </span>
        ))}
        <button
          onClick={() => setEditingTags((open) => !open)}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-800 text-gray-500 transition hover:border-brand hover:text-gray-200"
          title={tags.length ? "Edit tags" : "Add tags"}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>}

      {editingTags && (
        <div className="mb-4 grid grid-cols-[1fr_auto] gap-1.5">
          <input
            value={tagsDraft}
            onChange={(event) => setTagsDraft(event.target.value)}
            placeholder="keeper, portrait"
            className="min-w-0 rounded-md border border-gray-800 bg-black/30 px-2 py-1 text-[11px] text-gray-300 placeholder:text-gray-700 focus:border-brand focus:outline-none"
          />
          <button
            onClick={saveTags}
            disabled={savingMetadata}
            className="rounded-md bg-gray-800 px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:bg-brand hover:text-brand-foreground disabled:text-gray-600"
          >
            {savingMetadata ? "…" : "Save"}
          </button>
        </div>
      )}

      {/* What it is and when it ran — the lines someone points at to ask for another. */}
      {current && (
        <div className="mb-4 space-y-0">
          <Fact label="Workflow" value={(detail?.meta?.workflow as string) || null} />
          <Fact label="Type" value={kindLabel} />
          <Fact label="Size" value={sizeLabel(current.settings, current)} />
          <Fact label="Duration" value={durationLabel(current.settings, videoSeconds)} />
          <Fact label="Submitted" value={formatStamp(current.submitted_at)} />
          <Fact label="Completed" value={formatStamp(current.finished_at)} />
          <Fact label="Time taken" value={elapsedLabel(current)} />
        </div>
      )}
      {pendingJob && (
        <div className="mb-4 space-y-0">
          <Fact label="Status" value={pendingStatus} />
          <Fact label="Workflow" value={pendingJob.workflow || pendingJob.job_type || null} />
          <Fact label="Type" value={kindLabel} />
          <Fact label="Node" value={pendingJob.provider || null} />
          <Fact label="Submitted" value={formatStamp(pendingJob.created_at)} />
          <Fact label="Started" value={formatStamp(pendingJob.started_at)} />
          <Fact label="Error" value={pendingJob.error || null} />
        </div>
      )}

      {sourcePath && (
        <button
          onClick={() => openSource(sourcePath)}
          className="mb-4 flex w-full items-center gap-2.5 rounded-lg border border-gray-800 bg-black/30 p-1.5 text-left transition hover:border-brand"
          title="Open the image this started from"
        >
          {sourceThumbFailed ? (
            // The input is gone from disk. Say so where its picture was, rather
            // than leaving the browser's broken-image glyph to imply a bug.
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-black/40 text-[9px] text-gray-600">
              gone
            </span>
          ) : (
            <img
              src={`/api/thumb/${sourcePath.split("/").map(encodeURIComponent).join("/")}`}
              alt=""
              onError={() => setSourceThumbFailed(true)}
              className="h-12 w-12 shrink-0 rounded object-cover"
            />
          )}
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wider text-gray-500">{sourceLabel}</span>
            <span className="block truncate text-[11px] text-gray-300">{sourcePath.split("/").pop()}</span>
          </span>
        </button>
      )}

      {detailLoading && <p className="text-xs text-gray-600 animate-pulse">Loading...</p>}
      {!detailLoading && !shownDetail && <p className="text-xs text-gray-600">No metadata available</p>}
      {shownDetail && (() => {
        const promptText = shownDetail.meta?.prompt || current?.prompt || pendingJob?.prompt || null;
        const groups = buildRecordGroups(shownDetail, current ?? pendingAsItem);
        const fieldCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
        return (
          <>
            {promptText && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Prompt</p>
                  <button
                    onClick={() => { copyText(String(promptText)); flashCopied("__prompt__"); }}
                    className="text-gray-600 hover:text-gray-300 transition"
                    title="Copy prompt"
                  >
                    {copiedKey === "__prompt__" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                <p className="text-[11px] text-gray-200 leading-relaxed">{promptText}</p>
              </div>
            )}
            {/* The complete record, open on arrival. Every asset prints the same rows in
                the same order, empty or not, so two of these panels can be read against
                each other — a field that reads `none` proves it was read and empty. The
                chevron is the only thing that says this folds away; without it the section
                reads as a plain heading and the fold may as well not exist. */}
            <details className="mb-4 group" open>
              <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-300">
                <ChevronDown className="h-3.5 w-3.5 shrink-0 -rotate-90 text-gray-600 transition-transform duration-150 group-open:rotate-0" aria-hidden />
                <span>Additional information</span>
                <span className="ml-auto normal-case tracking-normal text-gray-600">{fieldCount} fields</span>
              </summary>
              <div className="mt-2">
                <MetaRow label="File" value={identifier || "none"} />
                <MetaRow label="ID" value={current?.prompt_id || pendingId || "none"} />
                {groups.map((group) => (
                  <div key={group.title}>
                    <p className="pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-600">{group.title}</p>
                    {group.rows.map((row, index) => (
                      <MetaRow key={`${row.label}-${index}`} label={row.label} value={row.value} />
                    ))}
                  </div>
                ))}
              </div>
            </details>
          </>
        );
      })()}

      {current && (
        <div className="mb-4">
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-500">LoRA training</p>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-gray-300">
            <input
              type="checkbox"
              checked={!!current.included_in_training_dataset}
              onChange={toggleTrainingDataset}
              disabled={savingMetadata}
              className="h-3.5 w-3.5 rounded border-gray-700 bg-black/30 text-brand accent-brand focus:ring-0 disabled:opacity-50"
            />
            Include in training dataset
          </label>
        </div>
      )}

      {remixActions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Remix</p>
          {remixActions.map((action) => (
            <button
              key={action.key}
              onClick={() => copyRemix(action.instruction, action.key)}
              className="w-full text-left rounded-lg border border-gray-800 bg-black/30 px-2.5 py-1.5 text-[11px] text-gray-300 hover:border-brand transition"
              title="Copy this asset + instruction to give your agent"
            >
              {copiedKey === action.key ? "Copied ✓ — paste to your agent" : action.label}
            </button>
          ))}
        </div>
      )}
    </>
  );

  // Copy, download, delete, close — the four things you do to an asset, as icons.
  // Shared by both layouts so the mobile sheet and the desktop rail can't drift.
  const headerActions = (
    <>
      {current && (
        <button
          onClick={() => { copyText(assetReference(current)); flashCopied("__context__"); }}
          className="p-1 rounded text-gray-500 hover:bg-gray-800 hover:text-white transition"
          title="Copy this asset's reference — paste it to your agent and say what you want"
        >
          {copiedKey === "__context__" ? <Check className="w-4 h-4 text-brand" /> : <Copy className="w-4 h-4" />}
        </button>
      )}
      {/* No file to download or delete until the job finishes. */}
      {!pendingId && (
        <>
          {/* A job that wrote a file (an FBX) made that file; the video on the card is only
              its preview, so Download gives the file. */}
          <a
            href={jobFiles[0]?.url ?? selectedUrl}
            download={(jobFiles[0] ? jobFiles[0].filename.split("/").pop() : displayName) || undefined}
            className="p-1 rounded text-gray-500 hover:bg-gray-800 hover:text-white transition"
            title={jobFiles[0] ? `Download ${fileExt(jobFiles[0].filename)}` : "Download"}
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            onClick={() => setDeleteOpen(true)}
            disabled={!current || deleting}
            className="p-1 rounded text-red-400 hover:bg-red-950/70 hover:text-red-200 disabled:opacity-30 transition"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </>
      )}
      <button onClick={onClose} className="p-1 rounded text-gray-500 hover:bg-gray-800 hover:text-white transition" title="Close">
        <X className="w-4 h-4" />
      </button>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/95" onClick={onClose}>

      {/* ── MOBILE: scrollable sheet ── */}
      <div className="md:hidden h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Sticky nav bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 bg-black/80 backdrop-blur-sm border-b border-gray-800">
          <div className="flex items-center gap-1">
            <button onClick={goPrev} disabled={!hasPrev} className="w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-25 text-white active:bg-gray-800">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={goNext} disabled={!hasNext} className="w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-25 text-white active:bg-gray-800">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <span className="text-xs text-gray-400 font-medium">{pendingId ? pendingStatus ?? "Job" : `${currentIndex + 1} / ${items.length}`}</span>
          <div className="flex items-center gap-1.5">
            {headerActions}
          </div>
        </div>

        {/* Image — natural size. Swipe left/right to navigate. */}
        <div className="w-full bg-black" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {pendingId ? (
            pendingJob && <div className="mx-auto w-full max-w-xs p-4"><PendingMediaTile job={pendingJob} /></div>
          ) : isAudio ? (
            !isDesktop && <div className="flex flex-col items-center gap-4 px-4 py-10 text-gray-500"><AudioLines className="h-16 w-16" /><audio src={selectedUrl} controls autoPlay onLoadedMetadata={onVideoMetadata} className="w-full" /></div>
          ) : isVideo ? (
            !isDesktop && <video src={selectedUrl} controls autoPlay loop playsInline onLoadedMetadata={onVideoMetadata} className="w-full max-h-[68vh]" />
          ) : (
            <img src={selectedUrl} alt="" className="w-full max-h-[68vh] object-contain" />
          )}
        </div>

        {/* Metadata below image */}
        <div className="px-4 py-4 bg-gray-950 min-h-screen">
          {metaContent}
        </div>
      </div>

      {/* ── DESKTOP: side-by-side ── */}
      <div className="hidden md:flex h-full items-stretch" onClick={(e) => e.stopPropagation()}>
        {/* Left arrow */}
        <button
          onClick={goPrev} disabled={!hasPrev}
          className="shrink-0 w-14 flex items-center justify-center text-gray-600 hover:text-white transition disabled:opacity-20"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>

        {/* Image */}
        <div className="flex-1 flex items-center justify-center py-6 min-w-0">
          {pendingId ? (
            pendingJob && <div className="w-80"><PendingMediaTile job={pendingJob} /></div>
          ) : isAudio ? (
            isDesktop && <div className="flex w-full max-w-xl flex-col items-center gap-6 text-gray-500"><AudioLines className="h-24 w-24" /><audio src={selectedUrl} controls autoPlay onLoadedMetadata={onVideoMetadata} className="w-full" /></div>
          ) : isVideo ? (
            isDesktop && <video src={selectedUrl} controls autoPlay loop playsInline onLoadedMetadata={onVideoMetadata} className="max-w-full max-h-[90vh] rounded-xl shadow-2xl" />
          ) : (
            <img src={selectedUrl} alt="" className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" />
          )}
        </div>

        {/* Right arrow */}
        <button
          onClick={goNext} disabled={!hasNext}
          className="shrink-0 w-14 flex items-center justify-center text-gray-600 hover:text-white transition disabled:opacity-20"
        >
          <ChevronRight className="w-8 h-8" />
        </button>

        {/* Metadata sidebar */}
        <div className="shrink-0 w-72 border-l border-gray-800 bg-gray-950 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <span className="text-xs font-medium text-white">{pendingId ? pendingStatus ?? "Job" : `${currentIndex + 1} / ${items.length}`}</span>
            <div className="flex items-center gap-1">
              {headerActions}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {metaContent}
          </div>
        </div>
      </div>

      {/* Delete confirmation — the same dialog the gallery tiles use, so deleting
          from the rail asks the same question it asks from the grid. */}
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deleting={deleting}
        title={`Delete this ${kind}?`}
        target={displayName || "this file"}
        onConfirm={deleteCurrent}
      />

    </div>
  );
}
