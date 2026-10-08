import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { ArrowDownUp, ArrowRight, Check, Film, Image, Layers, LayoutGrid, ListFilter, Search, SquareCheckBig, Table2, Video, X } from "lucide-react";
import { PendingMediaTile } from "./PendingMediaTile";
import { jobSelection } from "../lib/jobSelection";
import { MediaTile } from "./MediaTile";
import { DeleteDialog } from "./DeleteDialog";
import { GalleryTable, type GalleryEntry } from "./GalleryTable";
import type { CharacterSummary, JobItem, MediaItem, MediaMetadataPatch } from "../types";

type Filter = "all" | "images" | "videos";
type ViewSize = "compact" | "comfortable" | "large";
type ViewMode = "grid" | "table";
// The values are what GET /api/listing takes as `sort`; "newest" sends none.
export type GallerySort = "newest" | "match" | "match_asc";

const SORT_OPTIONS: [GallerySort, string, string?][] = [
  ["newest", "Newest"],
  ["match", "Best match", "Closest face match to the character first"],
  ["match_asc", "Lowest match", "Furthest from the character first"],
];

// Popovers live in the top layer, outside the toolbar's layout, so each is placed under
// its button by hand, right edges aligned and kept on screen.
function placeUnder(buttonId: string, width: number) {
  return (event: React.ToggleEvent<HTMLDivElement>) => {
    const rect = document.getElementById(buttonId)?.getBoundingClientRect();
    if (event.newState !== "open" || !rect) return;
    event.currentTarget.style.top = `${rect.bottom + 8}px`;
    event.currentTarget.style.left = `${Math.max(8, rect.right - width)}px`;
  };
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      aria-label={`Remove filter: ${label}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gray-800 bg-gray-900 py-1 pl-2.5 pr-1.5 text-xs text-gray-200 transition hover:border-gray-600"
    >
      {label}
      <X className="h-3 w-3 text-gray-500" aria-hidden />
    </button>
  );
}

const VIEW_MODE_KEY = "flixml.studio.viewMode";

interface StudioViewProps {
  items: MediaItem[];
  jobs: JobItem[];
  loading: boolean;
  error: string | null;
  onOpen: (url: string) => void;
  onDelete: (item: MediaItem, reason?: string) => Promise<void> | void;
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
  sort: GallerySort;
  onSortChange: (sort: GallerySort) => void;
  onBulkDelete: (items: MediaItem[], reason?: string) => Promise<void>;
  onBulkUpdateMetadata: (items: MediaItem[], patcher: (item: MediaItem) => MediaMetadataPatch) => Promise<void>;
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
  sort,
  onSortChange,
  onBulkDelete,
  onBulkUpdateMetadata,
}: StudioViewProps) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [viewSize, setViewSize] = useState<ViewSize>("large");
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_MODE_KEY) === "table" ? "table" : "grid"
  );
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);
  // Sort is not a filter: it reorders the gallery without hiding anything, so it never counts here.
  const activeFilterCount = [characterFilter, tagFilter, trainingDatasetOnly ? "1" : ""].filter(Boolean).length;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);



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

  async function bulkDeleteSelected(reason: string) {
    if (selectedItems.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onBulkDelete(selectedItems, reason);
      clearSelection();
    } finally {
      setBulkBusy(false);
      setBulkDeleteOpen(false);
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
    large: "grid grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6",
  }[viewSize];


  const imageCount = counts.images;
  const videoCount = counts.videos;

  const isJobVideo = (job: JobItem) =>
    job.output_type === "video" ||
    (job.job_type ? job.job_type.includes("video") : false) ||
    job.mode === "i2v" ||
    job.mode === "t2v" ||
    job.mode === "flf2v";

  const isJobImage = (job: JobItem) => !isJobVideo(job);

  const merged = useMemo(() => {
    const q = query.trim().toLowerCase();

    // Only show jobs still in flight — completed jobs appear as items via /api/listing.
    // Failed jobs stay out of the gallery; they live on the Jobs page.
    const activeJobs = jobs.filter((job) => job.status === "pending" || job.status === "running");

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
    const entries: GalleryEntry[] = [];

    for (const job of filteredJobs) {
      entries.push({ kind: "job", job });
    }
    for (const item of filteredItems) {
      entries.push({ kind: "item", item });
    }

    // Active jobs always float to top. Items keep the server's order when sorted by
    // match, either way; otherwise newest first.
    const newestFirst = (a: GalleryEntry, b: GalleryEntry) => {
      const aTime = a.kind === "job" ? Date.parse(a.job.created_at || "0") || 0 : a.item.mtime * 1000;
      const bTime = b.kind === "job" ? Date.parse(b.job.created_at || "0") || 0 : b.item.mtime * 1000;
      return bTime - aTime;
    };
    if (sort !== "newest") {
      return [
        ...entries.filter((entry) => entry.kind === "job").sort(newestFirst),
        ...entries.filter((entry) => entry.kind === "item"),
      ];
    }
    entries.sort(newestFirst);

    return entries;
  }, [jobs, items, filter, query, sort]);

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
    <div className="p-5 lg:p-7 space-y-4">
      {/* One line: what this is, how much of it there is, and the way out to Projects. */}
      <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {/* Studio and Workspace are the same page, set as a title and its subtitle. */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight leading-none">Studio</h1>
          <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">
            Workspace
          </p>
        </div>
        <p className="text-xs text-gray-500">
          {counts.total} in your gallery · {imageCount} {imageCount === 1 ? "image" : "images"} ·{" "}
          {videoCount} {videoCount === 1 ? "video" : "videos"}
        </p>
        <button
          onClick={onOpenProjects}
          className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-500 transition hover:text-brand"
          title="Projects are for finished pieces — scenes, shots, and a stitched render"
        >
          <Film className="h-3.5 w-3.5" aria-hidden /> Projects
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </section>

      {/* One row of what's used constantly; everything occasional sits behind Filters.
          It sticks to the top of the scroll pane: search, filters and Select have to be
          reachable a thousand tiles down, not only before the first scroll. */}
      <section className="sticky top-0 z-30 -mx-5 -mt-1 bg-black/80 px-5 pb-2 pt-1 backdrop-blur-xl lg:-mx-7 lg:px-7">
        <div className="rounded-2xl border border-gray-800/60 bg-gray-950/80 p-2.5">
        {selectionMode ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-1 text-xs font-medium text-gray-200">
              {selectedItems.length} selected
            </span>
            <button onClick={selectVisible} className="rounded-lg bg-gray-900 px-2.5 py-2 text-xs text-gray-300 transition hover:text-white">Select visible</button>
            <button onClick={clearSelection} className="rounded-lg bg-gray-900 px-2.5 py-2 text-xs text-gray-500 transition hover:text-white">Clear</button>
            {selectedItems.length > 0 && (
              <>
                <select
                  disabled={bulkBusy}
                  defaultValue=""
                  onChange={(event) => { const value = event.target.value; event.target.value = ""; bulkAssignCharacter(value === "__none__" ? "" : value); }}
                  className="rounded-lg border border-gray-800 bg-black/40 px-2.5 py-2 text-xs text-gray-300 focus:border-brand focus:outline-none disabled:opacity-50"
                >
                  <option value="">Assign character…</option>
                  <option value="__none__">No character</option>
                  {characters.map((character) => (
                    <option key={character.id} value={character.id}>{character.name}</option>
                  ))}
                </select>
                <button disabled={bulkBusy} onClick={() => bulkSetTrainingDataset(true)} className="rounded-lg bg-brand px-2.5 py-2 text-xs font-medium text-brand-foreground transition hover:brightness-110 disabled:bg-gray-800 disabled:text-gray-500">Include in dataset</button>
                <button disabled={bulkBusy} onClick={() => bulkSetTrainingDataset(false)} className="rounded-lg bg-gray-900 px-2.5 py-2 text-xs text-gray-300 transition hover:text-white disabled:opacity-50">Remove from dataset</button>
                <button disabled={bulkBusy} onClick={bulkAddTags} className="rounded-lg bg-gray-900 px-2.5 py-2 text-xs text-gray-300 transition hover:text-white disabled:opacity-50">Add tags</button>
                <button disabled={bulkBusy} onClick={() => setBulkDeleteOpen(true)} className="rounded-lg bg-red-600 px-2.5 py-2 text-xs font-medium text-white transition hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-500">Delete</button>
                <DeleteDialog
                  open={bulkDeleteOpen}
                  onOpenChange={setBulkDeleteOpen}
                  deleting={bulkBusy}
                  title={`Delete ${selectedItems.length} selected item${selectedItems.length === 1 ? "" : "s"}?`}
                  target={`${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}`}
                  onConfirm={bulkDeleteSelected}
                />
              </>
            )}
            <button
              onClick={() => { setSelectionMode(false); setSelectedKeys(new Set()); }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-gray-400 transition hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Done
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative w-full min-w-0 sm:w-auto sm:flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" aria-hidden />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search gallery"
                aria-label="Search gallery"
                className="w-full rounded-lg border border-gray-800 bg-black/40 py-2 pl-8 pr-2.5 text-xs text-gray-200 placeholder:text-gray-700 focus:border-brand focus:outline-none"
              />
            </label>

            <div className="flex shrink-0 gap-1">
              {([
                ["all", "All", Layers],
                ["images", "Images", Image],
                ["videos", "Videos", Video],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => onFilterChange(id as Filter)}
                  title={label}
                  aria-pressed={filter === id}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
                    filter === id ? "bg-brand text-brand-foreground" : "bg-gray-900 text-gray-500 hover:text-gray-200"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              popoverTarget="gallery-sort"
              id="gallery-sort-button"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
                sort !== "newest" ? "bg-gray-800 text-white" : "bg-gray-900 text-gray-400 hover:text-gray-200"
              }`}
            >
              <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
              <span><span className="hidden text-gray-500 sm:inline">Sort: </span>{SORT_OPTIONS.find(([value]) => value === sort)?.[1]}</span>
            </button>

            <button
              type="button"
              popoverTarget="gallery-filters"
              id="gallery-filters-button"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
                activeFilterCount > 0 ? "bg-gray-800 text-white" : "bg-gray-900 text-gray-500 hover:text-gray-200"
              }`}
            >
              <ListFilter className="h-3.5 w-3.5" aria-hidden />
              Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
            </button>

            <button
              type="button"
              popoverTarget="gallery-view"
              id="gallery-view-button"
              title="View"
              aria-label="View"
              className="inline-flex shrink-0 items-center rounded-lg bg-gray-900 px-2.5 py-2 text-gray-500 transition hover:text-gray-200"
            >
              {viewMode === "grid" ? <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> : <Table2 className="h-3.5 w-3.5" aria-hidden />}
            </button>

            <button
              onClick={() => setSelectionMode(true)}
              title="Select"
              aria-label="Select"
              className="inline-flex shrink-0 items-center rounded-lg bg-gray-900 px-2.5 py-2 text-xs font-medium text-gray-500 transition hover:text-gray-200"
            >
              <SquareCheckBig className="h-3.5 w-3.5 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">Select</span>
            </button>
          </div>
        )}

        {/* What's narrowing the gallery, readable and removable without opening Filters. */}
        {!selectionMode && activeFilterCount > 0 && (
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {characterFilter && (
              <FilterChip
                label={characterFilter === "__unassigned__" ? "Unassigned" : characters.find((character) => character.id === characterFilter)?.name ?? "Character"}
                onRemove={() => onCharacterFilterChange("")}
              />
            )}
            {tagFilter && <FilterChip label={`Tag: ${tagFilter}`} onRemove={() => onTagFilterChange("")} />}
            {trainingDatasetOnly && <FilterChip label="Training dataset" onRemove={() => onTrainingDatasetOnlyChange(false)} />}
            <button
              onClick={() => { onCharacterFilterChange(""); onTagFilterChange(""); onTrainingDatasetOnlyChange(false); }}
              className="shrink-0 px-1.5 py-1 text-xs text-gray-500 transition hover:text-white"
            >
              Clear all
            </button>
          </div>
        )}

        <div
          id="gallery-sort"
          popover="auto"
          onBeforeToggle={placeUnder("gallery-sort-button", 224)}
          className="fixed m-0 w-56 [inset:auto] rounded-2xl border border-gray-800 bg-gray-950 p-1.5 text-white shadow-2xl shadow-black/60"
        >
          {SORT_OPTIONS.map(([value, label, hint]) => (
            <button
              key={value}
              aria-pressed={sort === value}
              onClick={(event) => {
                onSortChange(value);
                event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
              }}
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-gray-900"
            >
              <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-brand ${sort === value ? "" : "invisible"}`} aria-hidden />
              <span>
                <span className="block text-xs text-gray-200">{label}</span>
                {hint && <span className="block text-[11px] text-gray-500">{hint}</span>}
              </span>
            </button>
          ))}
        </div>

        <div
          id="gallery-filters"
          popover="auto"
          onBeforeToggle={placeUnder("gallery-filters-button", 288)}
          className="fixed m-0 w-72 [inset:auto] space-y-3 rounded-2xl border border-gray-800 bg-gray-950 p-3 text-white shadow-2xl shadow-black/60"
        >
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-gray-400">Character</span>
            <select
              value={characterFilter}
              onChange={(event) => onCharacterFilterChange(event.target.value)}
              className="w-full rounded-lg border border-gray-800 bg-black/40 px-2.5 py-2 text-xs text-gray-200 focus:border-brand focus:outline-none"
            >
              <option value="">All characters</option>
              <option value="__unassigned__">Unassigned</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>{character.name}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-gray-400">Tag</span>
            <input
              value={tagFilter}
              onChange={(event) => onTagFilterChange(event.target.value)}
              placeholder="keeper, portrait, reference…"
              className="w-full rounded-lg border border-gray-800 bg-black/40 px-2.5 py-2 text-xs text-gray-200 placeholder:text-gray-700 focus:border-brand focus:outline-none"
            />
          </label>

          <button
            onClick={() => onTrainingDatasetOnlyChange(!trainingDatasetOnly)}
            aria-pressed={trainingDatasetOnly}
            className="flex w-full items-center justify-between rounded-lg bg-gray-900 px-2.5 py-2 text-xs text-gray-300 transition hover:text-white"
            title="Show only images marked for a LoRA training dataset"
          >
            Training dataset only
            {trainingDatasetOnly && <Check className="h-3.5 w-3.5 text-brand" aria-hidden />}
          </button>
        </div>

        <div
          id="gallery-view"
          popover="auto"
          onBeforeToggle={placeUnder("gallery-view-button", 240)}
          className="fixed m-0 w-60 [inset:auto] space-y-3 rounded-2xl border border-gray-800 bg-gray-950 p-3 text-white shadow-2xl shadow-black/60"
        >
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-gray-400">Layout</span>
            <div className="flex rounded-lg border border-gray-800 bg-black/30 p-0.5">
              {([
                ["grid", "Grid", LayoutGrid],
                ["table", "Table", Table2],
              ] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition ${viewMode === mode ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-200"}`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>

          {viewMode === "grid" && (
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-gray-400">Tile size</span>
              <div className="flex rounded-lg border border-gray-800 bg-black/30 p-0.5">
                {(["compact", "comfortable", "large"] as ViewSize[]).map((size) => (
                  <button
                    key={size}
                    onClick={() => setViewSize(size)}
                    aria-pressed={viewSize === size}
                    className={`flex-1 rounded-md px-2 py-1 text-xs capitalize transition ${viewSize === size ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-200"}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
      </section>

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
          {viewMode === "table" ? (
            <GalleryTable
              entries={merged}
              onOpen={onOpen}
              selectionMode={selectionMode}
              isSelected={(item) => selectedKeys.has(itemKey(item))}
              onToggleSelected={toggleSelected}
            />
          ) : (
          <div className={gridClass}>
          {merged.map((entry) => {
            if (entry.kind === "job") {
              return <PendingMediaTile key={entry.job.prompt_id} job={entry.job} onOpen={() => onOpen(jobSelection(entry.job.prompt_id))} />;
            }
            const item = entry.item;
            return (
              <MediaTile
                key={item.filename || item.url}
                item={item}
                onOpen={() => onOpen(item.url)}
                onDelete={onDelete}
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
          )}
          <div ref={loadMoreRef} className="h-8 flex items-center justify-center text-xs text-gray-600">
            {hasNextPage ? (isFetchingNextPage ? "Loading more…" : "Scroll for more") : items.length > 0 ? "End of gallery" : null}
          </div>
        </>
      )}
    </div>
  );
}
