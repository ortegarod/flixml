import { useEffect, useRef, useState, useCallback } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { X, ChevronDown, ChevronLeft, ChevronRight, Trash2, Copy, Check, Download, Plus, Pencil } from "lucide-react";
import type { GraphSettings, MediaItem, MediaMetadataPatch, SamplerPass } from "../types";
import { assetReference, copyText } from "../lib/agentContext";

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

// Frames and frame rate are arithmetic homework, so they become a duration.
function durationLabel(settings: GraphSettings | null | undefined): string | null {
  if (!settings?.frames || !settings?.fps) return null;
  const seconds = settings.frames / settings.fps;
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
// Fields the submitted graph reports, so the call is never asked about them. Deleted
// from the metadata blob before the groups below are built — one row per fact, and the
// graph is the one that saw what happened.
//
// Measured over 600 assets on 2026-09-21: requested and actual disagreed zero times on
// every one of these, and the graph knew the value far more often than the call did —
// steps on 464 assets the call never mentioned, sampler on 466, checkpoint on 411. The
// only thing a second "as requested" column ever added was a `none` next to a fact.
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

// Every field the record can carry, grouped in reading order. This is the union of
// every key present across the whole library — metadata and workflow_params both,
// surveyed 2026-09-21 over all 1,284 assets — so the same rows appear on every
// asset and two panels can be read side by side. A field with nothing in it still
// gets a row saying `none`: that proves it was read and empty, where a missing row
// proves nothing at all, and a list whose length changes per asset can't be compared.
//
// Adding a param to a workflow means adding its key here. Anything missed still
// shows up, under Other at the bottom — that section being non-empty is the signal
// this list has fallen behind.
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
  onDelete: (item: MediaItem) => Promise<void>;
  // Open the profile of the account that submitted this job. The lightbox stays
  // router-free; App closes it and navigates, the same way the sidebar does.
  onOpenOwner: (ownerId: string) => void;
}

export function Lightbox({ items, selectedUrl, onClose, onSelect, onUpdateMetadata, onDelete, onOpenOwner }: LightboxProps) {
  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tagsDraft, setTagsDraft] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [sourceThumbFailed, setSourceThumbFailed] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
  const hasNext = currentIndex < items.length - 1;

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

  if (!selectedUrl) return null;

  const isVideo = current?.type === "video" || selectedUrl.endsWith(".mp4") || selectedUrl.endsWith(".webm");

  const identifier = current?.filename || current?.name;
  const displayName = identifier ? identifier.split("/").pop() : null;

  async function deleteCurrent() {
    if (!current || deleting) return;
    setDeleting(true);
    const nextUrl = hasNext ? items[currentIndex + 1]?.url : hasPrev ? items[currentIndex - 1]?.url : null;
    try {
      await onDelete(current);
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
  const eligibleTasks = isVideo ? VIDEO_TASKS : IMAGE_TASKS;
  const remixActions = !current
    ? []
    : workflows
        .filter((w) => eligibleTasks.includes(w.task))
        .filter((w) => vramCeiling === null || !w.requirements?.vram_gb || w.requirements.vram_gb <= vramCeiling)
        .map((w) => ({
          key: w.id,
          label: w.name,
          instruction: `Use this ${isVideo ? "video" : "image"} as the input to the "${w.name}" workflow (${w.task}). ${REMIX_INTENT[w.task]}`,
        }));

  const ownerId: string | null = (detail?.meta?.owner_id as string) || null;
  // The image this job started from. Video jobs record it at the top level;
  // image-to-image workflows pass it through as a graph param, so both places
  // have to be read or an edit looks like it came from nothing.
  const sourcePath: string | null =
    (detail?.meta?.image as string) ||
    ((detail?.meta?.workflow_params as Record<string, any>)?.image as string) ||
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

      <div className="mt-1.5 mb-4 flex flex-wrap items-center gap-1">
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
      </div>

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
          <Fact label="Type" value={isVideo ? "Video" : "Image"} />
          <Fact label="Size" value={sizeLabel(current.settings, current)} />
          <Fact label="Duration" value={durationLabel(current.settings)} />
          <Fact label="Submitted" value={formatStamp(current.submitted_at)} />
          <Fact label="Completed" value={formatStamp(current.finished_at)} />
          <Fact label="Time taken" value={elapsedLabel(current)} />
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
      {!detailLoading && !detail && <p className="text-xs text-gray-600">No metadata available</p>}
      {detail && (() => {
        const promptText = detail.meta?.prompt || current?.prompt || null;
        const groups = buildRecordGroups(detail, current);
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
                <MetaRow label="ID" value={current?.prompt_id || "none"} />
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
      <a
        href={selectedUrl}
        download={displayName || undefined}
        className="p-1 rounded text-gray-500 hover:bg-gray-800 hover:text-white transition"
        title="Download"
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
          <span className="text-xs text-gray-400 font-medium">{currentIndex + 1} / {items.length}</span>
          <div className="flex items-center gap-1.5">
            {headerActions}
          </div>
        </div>

        {/* Image — natural size. Swipe left/right to navigate. */}
        <div className="w-full bg-black" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {isVideo ? (
            <video src={selectedUrl} controls autoPlay loop playsInline className="w-full max-h-[68vh]" />
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
          {isVideo ? (
            <video src={selectedUrl} controls autoPlay loop playsInline className="max-w-full max-h-[90vh] rounded-xl shadow-2xl" />
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
            <span className="text-xs font-medium text-white">{currentIndex + 1} / {items.length}</span>
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
      <AlertDialog.Root open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
          <AlertDialog.Content
            onClick={(event) => event.stopPropagation()}
            className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-800 bg-gray-950 p-5 shadow-2xl shadow-black/60 focus:outline-none"
          >
            <AlertDialog.Title className="text-base font-semibold text-white">
              {deleting ? "Deleting…" : `Delete this ${isVideo ? "video" : "image"}?`}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-gray-400 leading-relaxed">
              Permanently delete <span className="text-gray-200">{displayName || "this file"}</span>?
              This cannot be undone.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <button
                  disabled={deleting}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-900 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  onClick={(event) => { event.preventDefault(); deleteCurrent(); }}
                  disabled={deleting}
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

    </div>
  );
}
