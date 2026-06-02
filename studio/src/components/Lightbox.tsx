import { useEffect, useState, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { CharacterSummary, MediaItem } from "../types";

interface ImageDetail {
  workflow: string | null;
  checkpoint: string | null;
  prompt: string | null;
  negative_prompt: string | null;
  width: number | null;
  height: number | null;
  seed: number | null;
  steps: number | null;
  cfg: number | null;
  sampler: string | null;
  scheduler: string | null;
  lora_name: string | null;
  lora_strength: number | null;
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
    const mediaPath = current?.filename || current?.name;
    const detailUrl = current?.prompt_id
      ? `/api/image/${current.prompt_id}`
      : mediaPath
        ? `/api/media/${mediaPath.split("/").map(encodeURIComponent).join("/")}`
        : null;
    if (!detailUrl) return;
    setDetailLoading(true);
    fetch(detailUrl)
      .then((r) => r.ok ? r.json() : null)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [current?.prompt_id, current?.filename, current?.name]);

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

  const metaContent = (
    <>
      {(identifier || current?.prompt_id) && (
        <div className="mb-4 pb-3 border-b border-gray-800 space-y-2">
          {identifier && <MetaRow label="File" value={identifier} />}
          {current?.prompt_id && <MetaRow label="ID" value={current.prompt_id} />}
          {current && !isVideo && (
            <button
              onClick={toggleTrainingDataset}
              disabled={savingMetadata}
              className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition ${current.included_in_training_dataset ? "bg-fuchsia-600 text-white hover:bg-fuchsia-500" : "bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white"} disabled:opacity-50`}
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
              className="min-w-0 rounded-md bg-black/30 border border-gray-800 px-2 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-rose-600"
            >
              <option value="">No character</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>{character.name}</option>
              ))}
            </select>
            <button
              onClick={saveMetadata}
              disabled={savingMetadata}
              className="rounded-md bg-gray-800 px-2 py-1 text-[11px] font-medium text-gray-200 hover:bg-rose-600 hover:text-white disabled:text-gray-600 transition"
            >
              {savingMetadata ? "…" : "Save"}
            </button>
            <input
              value={tagsDraft}
              onChange={(event) => setTagsDraft(event.target.value)}
              placeholder="tags: keeper, portrait"
              className="col-span-2 min-w-0 rounded-md bg-black/30 border border-gray-800 px-2 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-rose-600 placeholder:text-gray-700"
            />
            <button
              onClick={toggleTrainingDataset}
              disabled={savingMetadata}
              className={`col-span-2 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${current.included_in_training_dataset ? "bg-fuchsia-600 text-white hover:bg-fuchsia-500" : "bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white"} disabled:opacity-50`}
            >
              {current.included_in_training_dataset ? "Included in training dataset" : "Include in training dataset"}
            </button>
          </div>
        </details>
      )}
      {detailLoading && <p className="text-xs text-gray-600 animate-pulse">Loading...</p>}
      {!detailLoading && !detail && <p className="text-xs text-gray-600">No metadata available</p>}
      {detail && (
        <>
          {detail.prompt && (
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Prompt</p>
              <p className="text-[11px] text-gray-200 leading-relaxed">{detail.prompt}</p>
            </div>
          )}
          {detail.negative_prompt && (
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Negative</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">{detail.negative_prompt}</p>
            </div>
          )}
          <MetaRow label="Workflow" value={detail.workflow} />
          <MetaRow label="Checkpoint" value={detail.checkpoint} />
          <MetaRow label="LoRA" value={detail.lora_name} />
          <MetaRow label="LoRA strength" value={detail.lora_strength} />
          <MetaRow label="Seed" value={detail.seed} />
          <MetaRow label="Steps" value={detail.steps} />
          <MetaRow label="CFG" value={detail.cfg} />
          <MetaRow label="Sampler" value={detail.sampler} />
          <MetaRow label="Scheduler" value={detail.scheduler} />
          <MetaRow label="Width" value={detail.width || undefined} />
          <MetaRow label="Height" value={detail.height || undefined} />
          {detail.completed_at && (
            <MetaRow label="Generated" value={new Date(detail.completed_at).toLocaleString()} />
          )}
        </>
      )}
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

        {/* Image — natural size */}
        <div className="w-full bg-black">
          {isVideo ? (
            <video src={selectedUrl} controls autoPlay className="w-full" />
          ) : (
            <img src={selectedUrl} alt="" className="w-full object-contain" />
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
            <video src={selectedUrl} controls autoPlay className="max-w-full max-h-[90vh] rounded-xl shadow-2xl" />
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
