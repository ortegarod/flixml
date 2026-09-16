import { useEffect, useRef, useState, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Trash2, Copy, Check, Download } from "lucide-react";
import type { CharacterSummary, MediaItem } from "../types";
import { assetReference, copyText } from "../lib/agentContext";

// Minimal shape of the /api/workflows entries we surface as agent-guidance options.
interface WorkflowMeta {
  id: string;
  name: string;
  task: string;
  output_type: string;
  requirements?: Record<string, any>;
}

// Per-task, plain-English intent phrasing for the "do more with this" options.
// Studio is agent-driven: these hand the agent this asset + a clear next step,
// they do NOT execute a render from the frontend.
const IMAGE_OPTION_INTENT: Record<string, string> = {
  "image-to-video": "Animate this image into a short video clip with this workflow. Suggest a natural motion (I'll give you a voice line if it needs one).",
  "image-to-image": "Make a variation/edit of this image using this workflow.",
  "face-reference-to-image": "Generate new images of this subject using it as a face/character reference, with this workflow.",
  "first-last-frame-to-video": "Use this image as a keyframe for a short video with this workflow.",
};

// Raw metadata blob straight off the API — we surface every field it exposes
// rather than a hand-picked subset, so per-workflow params (guidance, denoise,
// source image, provider, node counts, …) never get silently dropped.
interface ImageDetail {
  meta: Record<string, any>;
  completed_at: string | null;
}

function MetaRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-gray-800/50">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className="text-[11px] text-gray-300 text-right font-mono break-all">{String(value)}</span>
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
    .replace(/\bCfg\b/g, "CFG")
    .replace(/\bLora\b/g, "LoRA")
    .replace(/\bUrl\b/g, "URL");
}

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

// Preferred ordering so the common knobs read first; everything else follows alphabetically.
const META_ORDER = [
  "workflow", "provider", "checkpoint", "model", "output_type",
  "lora_name", "loras", "lora_strength", "seed", "steps", "cfg", "guidance",
  "denoise", "denoise_strength", "shift", "sampler", "scheduler",
  "dimensions", "width", "height", "image", "audio", "video",
  "progress_percent", "nodes_finished", "nodes_total", "current_node",
  "step_value", "step_max", "nodes_running",
  "filename_prefix", "session_id", "owner_id", "completed_at",
];

// Flatten metadata + workflow_params into an ordered, deduped list of rows.
// Prompt/negative are rendered as their own text blocks, so they're excluded here.
function buildMetaRows(detail: ImageDetail, item: MediaItem | null): Array<{ label: string; value: string }> {
  const meta = detail.meta || {};
  const wp = (meta.workflow_params as Record<string, any>) || {};
  // workflow_params first, top-level metadata wins on key collisions.
  const merged: Record<string, any> = { ...wp, ...meta };
  delete merged.prompt;
  delete merged.negative_prompt;
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
  if (merged.completed_at) {
    const d = new Date(merged.completed_at);
    if (!Number.isNaN(d.getTime())) merged.completed_at = d.toLocaleString();
  }

  const rows: Array<{ label: string; value: string }> = [];
  const emit = (key: string) => {
    const val = formatMetaValue(merged[key]);
    if (val === null) return;
    rows.push({ label: humanizeKey(key), value: val });
    delete merged[key];
  };
  for (const key of META_ORDER) if (key in merged) emit(key);
  for (const key of Object.keys(merged).sort()) emit(key);
  return rows;
}

interface LightboxProps {
  items: MediaItem[];
  selectedUrl: string | null;
  onClose: () => void;
  onSelect: (url: string | null) => void;
  characters: CharacterSummary[];
  onUpdateMetadata: (item: MediaItem, patch: { character_ids?: string[]; tags?: string[]; included_in_training_dataset?: boolean }) => Promise<void>;
  onDelete: (item: MediaItem) => Promise<void>;
}

export function Lightbox({ items, selectedUrl, onClose, onSelect, characters, onUpdateMetadata, onDelete }: LightboxProps) {
  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [characterDraft, setCharacterDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const flashCopied = useCallback((key: string) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
  }, []);

  // Available workflows, fetched live so the "do more with this" options stay in
  // sync as workflows are added — no hardcoded menu.
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([]);

  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((data: WorkflowMeta[]) => setWorkflows(Array.isArray(data) ? data : []))
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
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  useEffect(() => {
    setCharacterDraft(current?.character_ids?.[0] || "");
    setTagsDraft((current?.tags || []).join(", "));
  }, [current?.filename, current?.url]);

  useEffect(() => {
    setDetail(null);
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

  async function deleteCurrent() {
    if (!current || deleting) return;
    const label = current.name || current.filename || "this item";
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setDeleting(true);
    const nextUrl = hasNext ? items[currentIndex + 1]?.url : hasPrev ? items[currentIndex - 1]?.url : null;
    try {
      await onDelete(current);
      onSelect(nextUrl || null);
      if (!nextUrl) onClose();
    } finally {
      setDeleting(false);
    }
  }

  async function saveMetadata() {
    if (!current || savingMetadata) return;
    setSavingMetadata(true);
    try {
      const tags = tagsDraft
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      await onUpdateMetadata(current, {
        character_ids: characterDraft ? [characterDraft] : [],
        tags,
      });
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

  const characterName = (id: string) => characters.find((character) => character.id === id)?.name || id;

  // Copy this asset's reference plus what the human wants done with it. The agent
  // looks the asset up itself, so nothing technical has to be pasted by hand.
  function copyBuild(instruction: string, key: string) {
    if (!current) return;
    copyText(`${assetReference(current)} — ${instruction}`);
    flashCopied(key);
  }

  // "Build on this" quick actions, tailored to the asset type. Each hands the
  // agent this asset + a plain-English next step; the agent picks the workflow.
  const buildActions = !current
    ? []
    : isVideo
      ? [
          { key: "voice", label: "Add a voice (lip-sync)", instruction: "Add a lip-synced voice line to this clip, keeping its motion. I'll give you the line." },
        ]
      : // Every image-input workflow, live from /api/workflows, phrased as an
        // agent instruction. Tapping copies this asset's context + the intent so
        // the user just pastes it to their agent — the agent runs the workflow.
        workflows
          .filter((w) => w.task in IMAGE_OPTION_INTENT)
          .map((w) => ({
            key: w.id,
            label: w.name,
            instruction: `Use this image as the input to the "${w.name}" workflow (${w.task}). ${IMAGE_OPTION_INTENT[w.task]}`,
          }));

  const metaContent = (
    <>
      {current && (
        <button
          onClick={() => { copyText(assetReference(current)); flashCopied("__context__"); }}
          className="mb-4 w-full flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2.5 text-xs font-semibold text-brand-foreground hover:brightness-110 transition"
          title="Copy this asset's reference — paste it to your agent and say what you want; it looks up the rest"
        >
          {copiedKey === "__context__" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copiedKey === "__context__" ? "Copied — paste to your agent" : "Copy reference for agent"}
        </button>
      )}
      {current && (
        <div className="mb-4 space-y-2">
          <a
            href={selectedUrl}
            download={identifier ? identifier.split("/").pop() : undefined}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800 transition"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </a>
          {buildActions.length > 0 && (
            <>
              <p className="pt-1 text-[10px] uppercase tracking-wider text-gray-500">Build on this — paste to your agent</p>
              {buildActions.map((action) => (
                <button
                  key={action.key}
                  onClick={() => copyBuild(action.instruction, action.key)}
                  className="w-full text-left rounded-lg border border-gray-800 bg-black/30 px-2.5 py-1.5 text-[11px] text-gray-300 hover:border-brand transition"
                  title="Copy this asset + instruction to give your agent"
                >
                  {copiedKey === action.key ? "Copied ✓ — paste to your agent" : action.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {(identifier || current?.prompt_id) && (
        <div className="mb-4 pb-3 border-b border-gray-800 space-y-2">
          {identifier && <MetaRow label="File" value={identifier} />}
          {current?.prompt_id && <MetaRow label="ID" value={current.prompt_id} />}
          {current && !isVideo && (
            <button
              onClick={toggleTrainingDataset}
              disabled={savingMetadata}
              className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition ${current.included_in_training_dataset ? "bg-brand text-brand-foreground hover:brightness-110" : "bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white"} disabled:opacity-50`}
            >
              {current.included_in_training_dataset ? "Included in training dataset" : "Include in training dataset"}
            </button>
          )}
        </div>
      )}
      {current && (
        <details className="mb-3 border-b border-gray-800 pb-2 group">
          <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-300">
            <span>Organize</span>
            <span className="normal-case tracking-normal text-gray-600 group-open:hidden">
              {[
                ...(current.character_ids || []).map(characterName),
                current.included_in_training_dataset ? "dataset" : "",
                ...(current.tags || []),
              ].filter(Boolean).slice(0, 2).join(" · ") || "Edit"}
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5">
            <select
              value={characterDraft}
              onChange={(event) => setCharacterDraft(event.target.value)}
              className="min-w-0 rounded-md bg-black/30 border border-gray-800 px-2 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-brand"
            >
              <option value="">No character</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>{character.name}</option>
              ))}
            </select>
            <button
              onClick={saveMetadata}
              disabled={savingMetadata}
              className="rounded-md bg-gray-800 px-2 py-1 text-[11px] font-medium text-gray-200 hover:bg-brand hover:text-brand-foreground disabled:text-gray-600 transition"
            >
              {savingMetadata ? "…" : "Save"}
            </button>
            <input
              value={tagsDraft}
              onChange={(event) => setTagsDraft(event.target.value)}
              placeholder="tags: keeper, portrait"
              className="col-span-2 min-w-0 rounded-md bg-black/30 border border-gray-800 px-2 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-brand placeholder:text-gray-700"
            />
            <button
              onClick={toggleTrainingDataset}
              disabled={savingMetadata}
              className={`col-span-2 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${current.included_in_training_dataset ? "bg-brand text-brand-foreground hover:brightness-110" : "bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white"} disabled:opacity-50`}
            >
              {current.included_in_training_dataset ? "Included in training dataset" : "Include in training dataset"}
            </button>
          </div>
        </details>
      )}
      {detailLoading && <p className="text-xs text-gray-600 animate-pulse">Loading...</p>}
      {!detailLoading && !detail && <p className="text-xs text-gray-600">No metadata available</p>}
      {detail && (() => {
        const meta = detail.meta || {};
        const wp = (meta.workflow_params as Record<string, any>) || {};
        const promptText = meta.prompt || current?.prompt || null;
        const negativeText = meta.negative_prompt || wp.negative_prompt || null;
        const rows = buildMetaRows(detail, current);
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
            {negativeText && (
              <div className="mb-4">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Negative</p>
                <p className="text-[11px] text-gray-400 leading-relaxed">{negativeText}</p>
              </div>
            )}
            {rows.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Parameters</p>
                {rows.map((row) => (
                  <MetaRow key={row.label} label={row.label} value={row.value} />
                ))}
              </div>
            )}
          </>
        );
      })()}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/95" onClick={onClose}>

      {/* ── MOBILE: scrollable sheet ── */}
      <div className="md:hidden h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Sticky nav bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 bg-black/80 backdrop-blur-sm border-b border-gray-800">
          <button onClick={goPrev} disabled={!hasPrev} className="w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-25 text-white active:bg-gray-800">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-xs text-gray-400 font-medium">{currentIndex + 1} / {items.length}</span>
          <div className="flex gap-1">
            <button onClick={goNext} disabled={!hasNext} className="w-9 h-9 flex items-center justify-center rounded-full disabled:opacity-25 text-white active:bg-gray-800">
              <ChevronRight className="w-5 h-5" />
            </button>
            <button onClick={deleteCurrent} disabled={!current || deleting} className="w-9 h-9 flex items-center justify-center rounded-full text-red-300 active:bg-red-950/50 disabled:opacity-30">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full text-white active:bg-gray-800">
              <X className="w-4 h-4" />
            </button>
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
              <button onClick={deleteCurrent} disabled={!current || deleting} className="p-1 rounded hover:bg-red-950/70 text-red-400 hover:text-red-200 disabled:opacity-30 transition" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
              <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-white transition">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {metaContent}
          </div>
        </div>
      </div>

    </div>
  );
}
