import { useEffect, useState, type ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  title: string;
  /** What gets deleted, e.g. the file name or "3 items". */
  target: ReactNode;
  /** Called with the optional reason, trimmed; empty when none was typed. */
  onConfirm: (reason: string) => void;
}

/** The delete confirmation every gallery surface uses, with an optional reason. */
export function DeleteDialog({ open, onOpenChange, deleting, title, target, onConfirm }: DeleteDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  function confirm() {
    if (!deleting) onConfirm(reason.trim());
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <AlertDialog.Content
          onClick={(event) => event.stopPropagation()}
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-800 bg-gray-950 p-5 shadow-2xl shadow-black/60 focus:outline-none"
        >
          <AlertDialog.Title className="text-base font-semibold text-white">
            {deleting ? "Deleting…" : title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-gray-400 leading-relaxed">
            Permanently delete <span className="text-gray-200">{target}</span>?
            This cannot be undone.
          </AlertDialog.Description>
          <input
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirm();
              }
            }}
            maxLength={500}
            disabled={deleting}
            placeholder="Reason (optional)"
            aria-label="Reason for deleting (optional)"
            className="mt-4 w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-gray-600 focus:outline-none disabled:opacity-50"
          />
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
                onClick={(event) => { event.preventDefault(); confirm(); }}
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
  );
}
