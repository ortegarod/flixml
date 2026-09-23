import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Trash2, X, Expand, Check, Bot } from "lucide-react";
import type { MediaItem } from "../types";
import { assetReference, copyText } from "../lib/agentContext";
import { MediaPreview } from "./MediaPreview";

interface MediaTileProps {
  item: MediaItem;
  onOpen: () => void;
  onDelete: (item: MediaItem) => Promise<void> | void;
  onRemoveFromDataset?: (item: MediaItem) => Promise<void> | void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelected?: (item: MediaItem) => void;
}

export function MediaTile({ item, onOpen, onDelete, onRemoveFromDataset, selectionMode = false, selected = false, onToggleSelected }: MediaTileProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [datasetOpen, setDatasetOpen] = useState(false);
  const [removingDataset, setRemovingDataset] = useState(false);
  const [copied, setCopied] = useState(false);
  const workflow = item.workflow;
  // No workflow ran: say where the file came from instead, so every card carries a badge.
  const origin = item.metadata?.stitched_from ? "stitched"
    : item.metadata?.last_frame_of ? "last frame"
    : item.filename?.startsWith("projects/") ? "project render"
    : "upload";

  async function confirmRemoveDataset(event: React.MouseEvent) {
    event.stopPropagation();
    if (removingDataset || !onRemoveFromDataset) return;
    setRemovingDataset(true);
    try {
      await onRemoveFromDataset(item);
    } finally {
      setRemovingDataset(false);
      setDatasetOpen(false);
    }
  }

  async function confirm(event: React.MouseEvent) {
    event.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(item);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <div
      onClick={() => selectionMode ? onToggleSelected?.(item) : onOpen()}
      className={`cursor-pointer rounded-xl overflow-hidden border aspect-[3/4] bg-gray-900/50 relative group transition-all duration-200 hover:shadow-xl hover:shadow-black/30 hover:-translate-y-0.5 ${selected ? "border-brand ring-2 ring-brand-soft" : "border-gray-800/60 hover:border-gray-600"}`}
    >
      {/* Media */}
      <MediaPreview
        type={item.type}
        url={item.url}
        thumb={item.thumb}
        alt={item.name || ""}
        className={item.type === "video"
          ? "w-full h-full object-cover"
          : "w-full h-full object-cover group-hover:scale-105 transition duration-500"}
      />

      {selectionMode && (
        <div className={`absolute top-2 left-2 z-30 w-7 h-7 rounded-lg border flex items-center justify-center backdrop-blur-sm ${selected ? "bg-brand border-brand text-brand-foreground" : "bg-black/60 border-white/20 text-transparent"}`}>
          {selected && <Check className="w-4 h-4" />}
        </div>
      )}

      {item.included_in_training_dataset && (
        onRemoveFromDataset && !selectionMode ? (
          <AlertDialog.Root open={datasetOpen} onOpenChange={(open) => !removingDataset && setDatasetOpen(open)}>
            <AlertDialog.Trigger asChild>
              <button
                onClick={(event) => event.stopPropagation()}
                disabled={removingDataset}
                title="Remove from training dataset"
                className="absolute bottom-2 left-2 z-10 rounded-lg border border-white/15 bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-200 shadow-lg shadow-black/30 backdrop-blur-sm hover:border-white/30 hover:text-white transition disabled:opacity-50 cursor-pointer"
              >
                {removingDataset ? "removing…" : "dataset"}
              </button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
              <AlertDialog.Content
                onClick={(event) => event.stopPropagation()}
                className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-800 bg-gray-950 p-5 shadow-2xl shadow-black/60 focus:outline-none"
              >
                <AlertDialog.Title className="text-base font-semibold text-white">
                  Remove from training dataset?
                </AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-sm text-gray-400 leading-relaxed">
                  Remove <span className="text-gray-200">{item.name || item.filename || "this image"}</span> from the training dataset?
                  The file itself is not deleted.
                </AlertDialog.Description>
                <div className="mt-5 flex justify-end gap-2">
                  <AlertDialog.Cancel asChild>
                    <button
                      disabled={removingDataset}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-900 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <button
                      onClick={confirmRemoveDataset}
                      disabled={removingDataset}
                      className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:brightness-110 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition"
                    >
                      {removingDataset ? "Removing…" : "Remove"}
                    </button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        ) : (
          <div className="absolute bottom-2 left-2 z-10 rounded-lg border border-white/15 bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-200 shadow-lg shadow-black/30 backdrop-blur-sm">
            dataset
          </div>
        )
      )}

      {/* Top-right buttons */}
      <div className={`absolute top-2 right-2 z-10 flex gap-1 transition-all ${selectionMode ? "hidden" : deleteOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        {/* Copy reference for agent */}
        <button
          onClick={(event) => {
            event.stopPropagation();
            copyText(assetReference(item));
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="w-8 h-8 rounded-lg bg-black/60 text-white/80 backdrop-blur-sm flex items-center justify-center hover:bg-white/15 hover:text-white transition-all"
          title="Copy reference for agent"
        >
          {copied ? <Check className="w-4 h-4 text-brand" /> : <Bot className="w-4 h-4" />}
        </button>
        {/* Expand to lightbox */}
        <button
          onClick={(event) => { event.stopPropagation(); onOpen(); }}
          className="w-8 h-8 rounded-lg bg-black/60 text-white/80 backdrop-blur-sm flex items-center justify-center hover:bg-white/15 hover:text-white transition-all"
          title="View full size"
        >
          <Expand className="w-4 h-4" />
        </button>
        <AlertDialog.Root open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
          {!deleteOpen && (
            <AlertDialog.Trigger asChild>
              <button
                onClick={(event) => event.stopPropagation()}
                className="w-8 h-8 rounded-lg bg-black/60 text-white/80 backdrop-blur-sm flex items-center justify-center hover:bg-red-600 hover:text-white transition-all"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </AlertDialog.Trigger>
          )}
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
            <AlertDialog.Content
              onClick={(event) => event.stopPropagation()}
              className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-800 bg-gray-950 p-5 shadow-2xl shadow-black/60 focus:outline-none"
            >
              <AlertDialog.Title className="text-base font-semibold text-white">
                {deleting ? "Deleting…" : "Delete this image?"}
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-gray-400 leading-relaxed">
                Permanently delete <span className="text-gray-200">{item.name || item.filename || "this file"}</span>?
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
                    onClick={confirm}
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

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-6 opacity-0 group-hover:opacity-100 transition pointer-events-none">
        <p className="text-xs font-medium truncate text-white/90">{item.name || item.filename || "Untitled"}</p>
        {item.filename && item.filename !== item.name && (
          <p className="text-[10px] text-gray-400 font-mono truncate mt-0.5">{item.filename}</p>
        )}
      </div>

      {/* Workflow badge — which workflow made this, or where the file came from when none did. */}
      {!selectionMode && (
        <div
          title={workflow || origin}
          className="absolute top-2 left-2 max-w-[calc(100%-7rem)] opacity-0 group-hover:opacity-100 transition-all bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium px-2 py-1 rounded-md flex items-center"
        >
          <span className={workflow ? "truncate font-mono" : "truncate uppercase tracking-wide"}>{workflow || origin}</span>
        </div>
      )}

    </div>
  );
}
