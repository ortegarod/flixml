import { Fragment, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Maximize2, Video } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { copyText } from "../lib/agentContext";
import type { JobItem, MediaItem } from "../types";

export type GalleryEntry = { kind: "job"; job: JobItem } | { kind: "item"; item: MediaItem };

interface GalleryTableProps {
  entries: GalleryEntry[];
  onOpen: (url: string) => void;
  selectionMode: boolean;
  isSelected: (item: MediaItem) => boolean;
  onToggleSelected: (item: MediaItem) => void;
}

// One shape for both kinds of entry, so the row and its detail panel render once.
interface Row {
  key: string;
  item?: MediaItem;
  status?: string;
  prompt?: string | null;
  negative?: string | null;
  error?: string | null;
  label: string;
  workflow?: string | null;
  node?: string | null;
  width?: number | null;
  height?: number | null;
  seed?: number | string | null;
  owner?: string | null;
  models: string[];
  loras: string[];
  submittedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

function toRow(entry: GalleryEntry): Row {
  if (entry.kind === "job") {
    const job = entry.job;
    return {
      key: job.prompt_id,
      status: job.status,
      prompt: job.prompt,
      error: job.status === "failed" ? job.error : null,
      label: job.prompt_id,
      workflow: job.workflow || job.job_type,
      node: job.provider,
      width: job.width,
      height: job.height,
      seed: job.seed,
      owner: job.owner_id,
      models: job.models || [],
      loras: job.loras || [],
      submittedAt: job.created_at,
      startedAt: job.started_at,
      finishedAt: job.finished_at,
    };
  }
  const item = entry.item;
  const meta = item.metadata || {};
  const params = meta.workflow_params || {};
  return {
    key: item.filename || item.url,
    item,
    prompt: item.prompt,
    negative: item.negative_prompt || meta.negative || params.negative_prompt || params.negative,
    label: item.filename || item.name,
    workflow: meta.workflow,
    node: meta.provider,
    width: meta.width ?? item.width,
    height: meta.height ?? item.height,
    seed: meta.seed,
    owner: meta.owner_id,
    models: item.models || [],
    loras: item.loras || [],
    submittedAt: item.submitted_at,
    startedAt: item.started_at,
    finishedAt: item.finished_at,
  };
}

function duration(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const seconds = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  return Number.isFinite(seconds) ? seconds : null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  // ComfyUI finishes a fully cached prompt almost instantly.
  if (seconds === 0) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

// Short form for the columns. Finished drops the date when it matches the submit date
// beside it; the full timestamp is in the title and the detail panel.
function formatShort(iso?: string | null, relativeTo?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (relativeTo && sameDay(date, new Date(relativeTo))) return date.toLocaleTimeString(undefined, time);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", ...time });
}

function formatFull(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
  });
}

const statusClass: Record<string, string> = {
  pending: "bg-gray-800 text-gray-300",
  running: "bg-brand-faint text-brand",
  failed: "bg-red-950/60 text-red-300",
};

// Fixed layout: the model column takes the width that's left. The prompt is too long to
// read in a row, so it lives only in the detail panel.
const col = {
  select: "w-10",
  expand: "w-6",
  preview: "w-[52px]",
  agent: "w-24",
  workflow: "w-40",
  node: "w-28",
  size: "w-24",
  submitted: "w-32",
  finished: "w-24",
  runTime: "w-20 text-right",
};

// Table width at which each optional column appears, keeping the prompt at about 200px
// or more. Rendered conditionally rather than hidden with CSS so the detail row's
// colSpan matches the real column count.
const SHOW_AT = { submitted: 600, agent: 700, workflow: 860, size: 1000, node: 1160 };
const BASE_COLUMNS = 5; // expand, preview, model, finished, run time

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const stripModelExtension = (name: string) => name.replace(/\.(safetensors|gguf|ckpt|pt)$/, "");

function Detail({ label, value, mono, title }: { label: string; value?: string | number | null; mono?: boolean; title?: string }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-gray-800/50 py-1.5 last:border-0">
      <dt className="shrink-0 text-gray-400">{label}</dt>
      {/* One line per row keeps label and value aligned; long file names show in full on hover. */}
      <dd title={title ?? String(value)} className={`min-w-0 truncate text-right text-gray-200 ${mono ? "font-mono" : "tabular-nums"}`}>{value}</dd>
    </div>
  );
}

function PromptBlock({ title, text, tone }: { title: string; text: string; tone: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{title}</p>
        <button
          type="button"
          onClick={() => {
            copyText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-400 transition hover:bg-gray-800 hover:text-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className={`max-w-[80ch] select-text whitespace-pre-wrap break-words text-sm leading-relaxed ${tone}`}>{text}</p>
    </div>
  );
}

function RowDetail({ row, onOpen, indent }: { row: Row; onOpen: (url: string) => void; indent: string }) {
  const wait = duration(row.submittedAt, row.startedAt);
  const size = row.width && row.height ? `${row.width}×${row.height}` : null;
  return (
    // An inset panel with its own border, so the detail reads as separate from the row above it.
    <div className={`pb-3 pr-3 ${indent}`}>
      <div className="gallery-detail gap-6 rounded-xl border border-gray-800 bg-gray-950 p-4 text-xs shadow-inner shadow-black/40">
        <div className="min-w-0 space-y-4">
          {row.error && <PromptBlock title="Error" text={row.error} tone="text-red-300" />}
          {row.prompt ? (
            <PromptBlock title="Prompt" text={row.prompt} tone="text-gray-100" />
          ) : (
            <p className="text-gray-400">No prompt recorded.</p>
          )}
          {row.negative && <PromptBlock title="Negative prompt" text={row.negative} tone="text-gray-300" />}
          {row.item && (
            <button
              type="button"
              onClick={() => onOpen(row.item!.url)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 px-2.5 py-1.5 text-xs text-gray-100 transition hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Open {row.item.type === "video" ? "video" : "image"}
            </button>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <dl>
            <Detail label={row.item && !row.item.prompt_id ? "Added" : "Submitted"} value={formatFull(row.submittedAt)} />
            {/* Sub-second differences are the job row being written after ComfyUI accepted the prompt. */}
            <Detail label="Waited in queue" value={wait !== null ? (wait > 0 ? formatDuration(wait) : "No wait") : null} />
            {wait !== null && wait > 0 && <Detail label="Started" value={formatFull(row.startedAt)} />}
            <Detail label="Finished" value={formatFull(row.finishedAt)} />
            <Detail label="Run time" value={row.finishedAt ? formatDuration(duration(row.startedAt, row.finishedAt)) : null} />
          </dl>
          <dl>
            {/* A row per file: two-stage video workflows load a high- and a low-noise model. */}
            {row.models.map((name, index) => (
              <Detail key={name} label={index === 0 ? (row.models.length > 1 ? "Models" : "Model") : ""} value={stripModelExtension(name)} title={name} mono />
            ))}
            {row.loras.map((name, index) => (
              <Detail key={name} label={index === 0 ? (row.loras.length > 1 ? "LoRAs" : "LoRA") : ""} value={stripModelExtension(name)} title={name} mono />
            ))}
            <Detail label="Workflow" value={row.workflow} mono />
            <Detail label="Node" value={row.node} mono />
            <Detail label="Size" value={size} />
            <Detail label="Seed" value={row.seed} />
            <Detail label={row.item ? "File" : "Job"} value={row.label} mono />
          </dl>
        </div>
      </div>
    </div>
  );
}

export function GalleryTable({ entries, onOpen, selectionMode, isSelected, onToggleSelected }: GalleryTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [containerRef, width] = useWidth<HTMLDivElement>();
  const show = {
    submitted: width >= SHOW_AT.submitted,
    agent: width >= SHOW_AT.agent,
    workflow: width >= SHOW_AT.workflow,
    size: width >= SHOW_AT.size,
    node: width >= SHOW_AT.node,
  };
  const columnCount = BASE_COLUMNS + Object.values(show).filter(Boolean).length + (selectionMode ? 1 : 0);

  const toggleExpanded = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div ref={containerRef} className="gallery-table overflow-hidden rounded-2xl border border-gray-800/60 bg-gray-950/50">
      <Table className="table-fixed text-xs">
        <TableHeader className="bg-gray-900/40">
          <TableRow className="border-gray-800 hover:bg-transparent">
            {selectionMode && <TableHead className={col.select}><span className="sr-only">Selected</span></TableHead>}
            <TableHead className={col.expand}><span className="sr-only">Details</span></TableHead>
            <TableHead className={`${col.preview} text-gray-400`}><span className="sr-only">Preview</span></TableHead>
            <TableHead className="text-gray-400">Model</TableHead>
            {show.agent && <TableHead className={`${col.agent} text-gray-400`}>Agent</TableHead>}
            {show.workflow && <TableHead className={`${col.workflow} text-gray-400`}>Workflow</TableHead>}
            {show.node && <TableHead className={`${col.node} text-gray-400`}>Node</TableHead>}
            {show.size && <TableHead className={`${col.size} text-gray-400`}>Size</TableHead>}
            {show.submitted && <TableHead className={`${col.submitted} text-gray-400`}>Submitted</TableHead>}
            <TableHead className={`${col.finished} text-gray-400`}>Finished</TableHead>
            <TableHead className={`${col.runTime} pr-4 text-gray-400`}>Run time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const row = toRow(entry);
            const item = row.item;
            const open = expanded.has(row.key);
            const selected = item ? isSelected(item) : false;
            const detailId = `gallery-detail-${row.key}`;
            return (
              <Fragment key={row.key}>
                <TableRow
                  data-state={selected ? "selected" : undefined}
                  onClick={() => (selectionMode && item ? onToggleSelected(item) : toggleExpanded(row.key))}
                  className={`cursor-pointer border-gray-800/60 hover:bg-gray-900/60 data-[state=selected]:bg-white/5 ${open ? "border-b-0 bg-gray-900/60" : ""}`}
                >
                  {selectionMode && (
                    <TableCell className={col.select}>
                      {item && (
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => onToggleSelected(item)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select ${item.name}`}
                          className="accent-[var(--brand)]"
                        />
                      )}
                    </TableCell>
                  )}
                  <TableCell className={`${col.expand} pl-1 pr-0`}>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={open ? "Hide details" : "Show details"}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleExpanded(row.key);
                      }}
                      className="flex h-6 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-800 hover:text-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      <ChevronRight className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
                    </button>
                  </TableCell>
                  <TableCell className={`${col.preview} pl-1 pr-0`}>
                    {item ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(item.url);
                        }}
                        aria-label={`Open ${item.name}`}
                        className="relative block h-12 w-12 overflow-hidden rounded-md bg-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        <img src={item.thumb || item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        {item.type === "video" && <Video className="absolute bottom-0.5 right-0.5 h-3 w-3 text-white drop-shadow" />}
                      </button>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-gray-900">
                        <span className={`rounded px-1 py-0.5 text-[9px] font-medium capitalize ${statusClass[row.status || ""] || "bg-gray-800 text-gray-300"}`}>
                          {row.status}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  {/* Two-stage video workflows load a high- and a low-noise model; the first names the family. */}
                  <TableCell className="truncate font-mono text-gray-300" title={row.models.join("\n") || undefined}>
                    {row.models[0] ? stripModelExtension(row.models[0]) : "—"}
                  </TableCell>
                  {show.agent && <TableCell className={`${col.agent} truncate text-gray-400`}>{row.owner || "—"}</TableCell>}
                  {show.workflow && <TableCell className={`${col.workflow} truncate font-mono text-gray-400`}>{row.workflow || "—"}</TableCell>}
                  {show.node && <TableCell className={`${col.node} truncate font-mono text-gray-400`}>{row.node || "—"}</TableCell>}
                  {show.size && <TableCell className={`${col.size} tabular-nums text-gray-400`}>{row.width && row.height ? `${row.width}×${row.height}` : "—"}</TableCell>}
                  {show.submitted && (
                    <TableCell className={`${col.submitted} tabular-nums text-gray-400`} title={formatFull(row.submittedAt) || undefined}>
                      {formatShort(row.submittedAt)}
                    </TableCell>
                  )}
                  <TableCell className={`${col.finished} tabular-nums text-gray-400`} title={formatFull(row.finishedAt) || undefined}>
                    {/* Without the Submitted column beside it, a bare time would be ambiguous. */}
                    {formatShort(row.finishedAt, show.submitted ? row.submittedAt : null)}
                  </TableCell>
                  <TableCell className={`${col.runTime} pr-4 tabular-nums text-gray-200`}>
                    {formatDuration(duration(row.startedAt, row.finishedAt))}
                  </TableCell>
                </TableRow>
                {open && (
                  <TableRow id={detailId} className="border-gray-800/60 bg-gray-900/60 hover:bg-gray-900/60">
                    <TableCell colSpan={columnCount} className="whitespace-normal p-0">
                      {/* Indent past the checkbox and chevron columns so the detail lines up with the thumbnail. */}
                      <RowDetail row={row} onOpen={onOpen} indent={selectionMode ? "pl-[68px]" : "pl-7"} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
