import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { ArrowRight, Film, Image, Search, SlidersHorizontal, Upload, Video } from "lucide-react";
import { PendingMediaTile } from "./PendingMediaTile";
import { MediaTile } from "./MediaTile";
import { generateVideo } from "../api";
import type { CharacterSummary, JobItem, MediaItem } from "../types";

type Filter = "all" | "images" | "videos";
type ViewSize = "compact" | "comfortable" | "large";

interface StudioViewProps {
  items: MediaItem[];
  jobs: JobItem[];
  loading: boolean;
  error: string | null;
  onOpen: (url: string) => void;
  onDelete: (item: MediaItem) => Promise<void> | void;
  onOpenProjects?: () => void;
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  filteredTotal: number;
  counts: { total: number; images: number; videos: number };
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  characters: CharacterSummary[];
  characterFilter: string;
  onCharacterFilterChange: (characterId: string) => void;
  tagFilter: string;
  onTagFilterChange: (tag: string) => void;
  trainingDatasetOnly: boolean;
  onTrainingDatasetOnlyChange: (enabled: boolean) => void;
  onBulkDelete: (items: MediaItem[]) => Promise<void>;
  onBulkUpdateMetadata: (items: MediaItem[], patcher: (item: MediaItem) => { character_ids?: string[]; tags?: string[]; included_in_training_dataset?: boolean }) => Promise<void>;
  onImported?: () => Promise<void> | void;
}

function isVideo(item: MediaItem) {
  return item.type === "video" || item.url.endsWith(".mp4") || item.url.endsWith(".webm");
}

export function StudioView({
  items,
  jobs,
  loading,
  error,
  onOpen,
  onDelete,
  onOpenProjects,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  filteredTotal,
  counts,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  characters,
  characterFilter,
  onCharacterFilterChange,
  tagFilter,
  onTagFilterChange,
  trainingDatasetOnly,
  onTrainingDatasetOnlyChange,
  onBulkDelete,
  onBulkUpdateMetadata,
  onImported,
}: StudioViewProps) {
  const [generatingVideo, setGeneratingVideo] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [viewSize, setViewSize] = useState<ViewSize>("comfortable");
  const [importOpen, setImportOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importCharacter, setImportCharacter] = useState("");
  const [importTags, setImportTags] = useState("reference");
  const [importing, setImporting] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const handleGenerateVideo = useCallback(async (item: MediaItem, motionPrompt: string) => {
    const key = item.filename || item.url;
    setGeneratingVideo((prev) => new Set(prev).add(key));
    try {
      await generateVideo({
        image: item.filename || item.url.split("/").pop() || "",
        prompt: motionPrompt || undefined,
      });
    } catch (err) {
      console.error("I2V failed:", err);
    } finally {
      setGeneratingVideo((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);


  const itemKey = useCallback((item: MediaItem) => item.filename || item.url, []);

  const selectedItems = useMemo(() => {
    const byKey = new Map(items.map((item) => [itemKey(item), item]));
    return Array.from(selectedKeys).map((key) => byKey.get(key)).filter(Boolean) as MediaItem[];
  }, [items, itemKey, selectedKeys]);

  const toggleSelected = useCallback((item: MediaItem) => {
    const key = itemKey(item);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [itemKey]);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
    setSelectionMode(false);
  }, []);

  const selectVisible = useCallback(() => {
    setSelectedKeys(new Set(items.map(itemKey)));
    setSelectionMode(true);
  }, [items, itemKey]);

  async function bulkDeleteSelected() {
    if (selectedItems.length === 0 || bulkBusy) return;
    if (!window.confirm(`Delete ${selectedItems.length} selected item${selectedItems.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      await onBulkDelete(selectedItems);
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAssignCharacter(characterId: string) {
    if (selectedItems.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onBulkUpdateMetadata(selectedItems, () => ({ character_ids: characterId ? [characterId] : [] }));
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAddTags() {
    if (selectedItems.length === 0 || bulkBusy) return;
    const raw = window.prompt("Add tags to selected items, comma-separated:");
    if (raw === null) return;
    const tags = raw.split(",").map((tag) => tag.trim()).filter(Boolean);
    if (tags.length === 0) return;
    setBulkBusy(true);
    try {
      await onBulkUpdateMetadata(selectedItems, (item) => ({
        tags: Array.from(new Set([...(item.tags || []), ...tags])),
      }));
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkSetTrainingDataset(included: boolean) {
    if (selectedItems.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onBulkUpdateMetadata(selectedItems, () => ({ included_in_training_dataset: included }));
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  }

  const gridClass = {
    compact: "grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3",
    comfortable: "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4",
    large: "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6",
  }[viewSize];


  async function importSelectedFiles() {
    if (importFiles.length === 0 || importing) return;
    setImporting(true);
    try {
      const form = new FormData();
      for (const file of importFiles) form.append("files", file);
      const params = new URLSearchParams();
      if (importCharacter) params.set("character_id", importCharacter);
      if (importTags.trim()) params.set("tags", importTags.trim());
      params.set("purpose", "import");
      const response = await fetch(`/api/media/import?${params.toString()}`, { method: "POST", body: form });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.detail || "Import failed");
      }
      setImportFiles([]);
      setImportOpen(false);
      await onImported?.();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const imageCount = counts.images;
  const videoCount = counts.videos;

  const isJobVideo = (job: JobItem) =>
    job.mode === "video" ||
    (job.prompt_id && (job.prompt_id.startsWith("wan22") || job.prompt_id.includes("video")));

  const isJobImage = (job: JobItem) => !isJobVideo(job);

  const merged = useMemo(() => {
    const q = query.trim().toLowerCase();

    // Only show active jobs (pending/running/failed) — completed jobs appear as items via /api/listing
    const activeJobs = jobs.filter(
      (job) => job.status === "pending" || job.status === "running" || job.status === "failed"
    );

    // Items are already filtered/search-paged by the backend. Keeping this as-is
    // prevents the old bug where filters only applied to the visible page.
    const filteredItems = items;

    // Filter jobs by type
    const filteredJobs = activeJobs.filter((job) => {
      if (filter === "images" && !isJobImage(job)) return false;
      if (filter === "videos" && !isJobVideo(job)) return false;
      if (!q) return true;
      return String(job.prompt || "").toLowerCase().includes(q);
    });

    // Build unified entries: jobs first (newest), then items
    const entries: ({ kind: "job"; job: JobItem } | { kind: "item"; item: MediaItem })[] = [];

    for (const job of filteredJobs) {
      entries.push({ kind: "job", job });
    }
    for (const item of filteredItems) {
      entries.push({ kind: "item", item });
    }

    // Sort by recency: active jobs always float to top, then items by mtime
    entries.sort((a, b) => {
      const aTime = a.kind === "job" ? Date.parse(a.job.created_at || "0") || 0 : a.item.mtime * 1000;
      const bTime = b.kind === "job" ? Date.parse(b.job.created_at || "0") || 0 : b.item.mtime * 1000;
      return bTime - aTime;
    });

    return entries;
  }, [jobs, items, filter, query]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <div className="p-5 lg:p-7 space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-rose-400/70">Workspace</p>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Studio</h1>
          <p className="text-sm text-gray-500 mt-2">Your gallery for quick image and video generation — freeform, no structure. Generate, browse, iterate.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs min-w-[260px]">
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-3 py-2">
            <p className="text-gray-600">Total</p>
            <p className="text-lg font-semibold text-gray-200">{counts.total}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-3 py-2">
            <p className="text-gray-600">Images</p>
            <p className="text-lg font-semibold text-gray-200">{imageCount}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-3 py-2">
            <p className="text-gray-600">Videos</p>
            <p className="text-lg font-semibold text-gray-200">{videoCount}</p>
          </div>
        </div>
      </section>

      <button
        onClick={onOpenProjects}
        className="group w-full rounded-2xl border border-violet-600/30 bg-gradient-to-r from-violet-950/30 via-indigo-950/20 to-gray-900/30 hover:border-violet-500/50 hover:from-violet-950/50 transition flex items-center gap-4 px-5 py-4 text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20 ring-1 ring-white/10 flex-shrink-0">
          <Film className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-violet-100">Got a specific idea? Turn it into a Project.</p>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            Studio is great for quick shots. <span className="text-gray-300">Projects</span> are for finished pieces — outline scenes, plan shots, generate, animate, and stitch together a real video.
          </p>
        </div>
        <ArrowRight className="w-5 h-5 text-violet-400 group-hover:translate-x-1 transition flex-shrink-0" />
      </button>

      <section className="rounded-2xl border border-gray-800/60 bg-gray-950/50 p-3 flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2">
          {[
            ["all", "All", SlidersHorizontal],
            ["images", "Images", Image],
            ["videos", "Videos", Video],
          ].map(([id, label, Icon]) => (
            <button
              key={id as string}
              onClick={() => onFilterChange(id as Filter)}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${
                filter === id ? "bg-rose-600 text-white" : "bg-gray-900 text-gray-500 hover:text-gray-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label as string}
            </button>
          ))}
          </div>
          <label className="relative w-full lg:w-80">
          <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search studio"
            className="w-full rounded-xl bg-black/40 border border-gray-800 pl-9 pr-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-rose-600 placeholder:text-gray-700"
          />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[220px_1fr_auto]">
          <select
            value={characterFilter}
            onChange={(event) => onCharacterFilterChange(event.target.value)}
            className="rounded-xl bg-black/40 border border-gray-800 px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-rose-600"
          >
            <option value="">All characters</option>
            <option value="__unassigned__">Unassigned</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>{character.name}</option>
            ))}
          </select>
          <label className="relative">
            <input
              value={tagFilter}
              onChange={(event) => onTagFilterChange(event.target.value)}
              placeholder="Filter by tag, e.g. keeper, portrait, reference"
              className="w-full rounded-xl bg-black/40 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-rose-600 placeholder:text-gray-700"
            />
          </label>
          <button
            onClick={() => onTrainingDatasetOnlyChange(!trainingDatasetOnly)}
            className={`rounded-xl px-3 py-2 text-xs font-medium transition ${trainingDatasetOnly ? "bg-fuchsia-600 text-white" : "bg-gray-900 text-gray-500 hover:text-gray-200"}`}
            title="Show only images marked for LoRA training dataset"
          >
            Dataset only
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-800/60 bg-gray-950/40 p-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setImportOpen((value) => !value)}
            className={`rounded-xl px-3 py-2 text-xs font-medium transition ${importOpen ? "bg-violet-600 text-white" : "bg-gray-900 text-gray-500 hover:text-gray-200"}`}
          >
            <Upload className="inline mr-1.5 h-3.5 w-3.5" />
            Import
          </button>
          <button
            onClick={() => { setSelectionMode((value) => !value); if (selectionMode) setSelectedKeys(new Set()); }}
            className={`rounded-xl px-3 py-2 text-xs font-medium transition ${selectionMode ? "bg-rose-600 text-white" : "bg-gray-900 text-gray-500 hover:text-gray-200"}`}
          >
            {selectionMode ? "Selecting" : "Select"}
          </button>
          {selectionMode && (
            <>
              <button onClick={selectVisible} className="rounded-xl bg-gray-900 px-3 py-2 text-xs text-gray-300 hover:text-white transition">Select visible</button>
              <button onClick={clearSelection} className="rounded-xl bg-gray-900 px-3 py-2 text-xs text-gray-500 hover:text-white transition">Clear</button>
              <span className="text-xs text-gray-500">{selectedItems.length} selected</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectionMode && selectedItems.length > 0 && (
            <>
              <select
                disabled={bulkBusy}
                defaultValue=""
                onChange={(event) => { const value = event.target.value; event.target.value = ""; bulkAssignCharacter(value === "__none__" ? "" : value); }}
                className="rounded-xl bg-black/40 border border-gray-800 px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-rose-600 disabled:opacity-50"
              >
                <option value="">Assign character…</option>
                <option value="__none__">No character</option>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>{character.name}</option>
                ))}
              </select>
              <button disabled={bulkBusy} onClick={() => bulkSetTrainingDataset(true)} className="rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-medium text-white hover:bg-fuchsia-500 disabled:bg-gray-800 disabled:text-gray-500 transition">Include in dataset</button>
              <button disabled={bulkBusy} onClick={() => bulkSetTrainingDataset(false)} className="rounded-xl bg-gray-900 px-3 py-2 text-xs text-gray-300 hover:text-white disabled:opacity-50 transition">Remove from dataset</button>
              <button disabled={bulkBusy} onClick={bulkAddTags} className="rounded-xl bg-gray-900 px-3 py-2 text-xs text-gray-300 hover:text-white disabled:opacity-50 transition">Add tags</button>
              <button disabled={bulkBusy} onClick={bulkDeleteSelected} className="rounded-xl bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-500 transition">Delete selected</button>
            </>
          )}
          <div className="flex rounded-xl border border-gray-800 bg-black/30 p-1">
            {(["compact", "comfortable", "large"] as ViewSize[]).map((size) => (
              <button
                key={size}
                onClick={() => setViewSize(size)}
                className={`rounded-lg px-3 py-1.5 text-xs capitalize transition ${viewSize === size ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-200"}`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      </section>

      {importOpen && (
        <section className="rounded-2xl border border-violet-700/40 bg-violet-950/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-violet-100">Import media into gallery</p>
              <p className="text-xs text-gray-500 mt-1">Files are stored under images/imports and indexed with character/tags.</p>
            </div>
            <span className="text-xs text-gray-500">{importFiles.length} selected</span>
          </div>
          <div className="grid gap-2 lg:grid-cols-[1fr_180px_1fr_auto]">
            <input
              type="file"
              multiple
              accept="image/*,video/mp4,video/webm"
              onChange={(event) => setImportFiles(Array.from(event.target.files || []))}
              className="rounded-xl border border-gray-800 bg-black/40 px-3 py-2 text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-800 file:px-3 file:py-1.5 file:text-xs file:text-gray-200"
            />
            <select
              value={importCharacter}
              onChange={(event) => setImportCharacter(event.target.value)}
              className="rounded-xl bg-black/40 border border-gray-800 px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-violet-500"
            >
              <option value="">No character</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>{character.name}</option>
              ))}
            </select>
            <input
              value={importTags}
              onChange={(event) => setImportTags(event.target.value)}
              placeholder="tags: reference, training-candidate"
              className="rounded-xl bg-black/40 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-500 placeholder:text-gray-700"
            />
            <button
              onClick={importSelectedFiles}
              disabled={importing || importFiles.length === 0}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-500 transition"
            >
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        </section>
      )}

      {loading && items.length === 0 && jobs.length === 0 ? (
        <p className="text-gray-500">Loading...</p>
      ) : error ? (
        <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-300">{error}</div>
      ) : merged.length === 0 ? (
        <div className="rounded-2xl border border-gray-800/60 bg-gray-900/20 p-10 text-center">
          <Image className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No media found.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>Showing {items.length} of {filteredTotal}</span>
            {isFetchingNextPage && <span>Loading more…</span>}
          </div>
          <div className={gridClass}>
          {merged.map((entry) => {
            if (entry.kind === "job") {
              return <PendingMediaTile key={entry.job.prompt_id} job={entry.job} />;
            }
            const item = entry.item;
            return (
              <MediaTile
                key={item.filename || item.url}
                item={item}
                onOpen={() => onOpen(item.url)}
                onDelete={onDelete}
                onGenerateVideo={handleGenerateVideo}
                onRemoveFromDataset={async (target) => {
                  await onBulkUpdateMetadata([target], () => ({ included_in_training_dataset: false }));
                }}
                selectionMode={selectionMode}
                selected={selectedKeys.has(itemKey(item))}
                onToggleSelected={toggleSelected}
              />
            );
          })}
          </div>
          <div ref={loadMoreRef} className="h-8 flex items-center justify-center text-xs text-gray-600">
            {hasNextPage ? (isFetchingNextPage ? "Loading more…" : "Scroll for more") : items.length > 0 ? "End of gallery" : null}
          </div>
        </>
      )}
    </div>
  );
}
