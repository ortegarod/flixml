import type { MediaItem } from "../types";

/**
 * The one piece of information a human hands their agent about an asset.
 *
 * The human is the creative guide, not the technical one: they copy a reference,
 * say what they want, and the agent looks up everything else — prompt, workflow,
 * checkpoint, LoRA, seed and params — from the API (`GET /api/jobs/{prompt_id}`,
 * or `GET /api/listing?q=<filename>` for media with no job behind it).
 */
export function assetReference(item: MediaItem): string {
  return `FlixML asset ${item.prompt_id || item.filename || item.name}`;
}

/**
 * The same one piece of information, for a workflow rather than an asset.
 *
 * Copied out of the workflows catalog: the human says what they want and names
 * this, and the agent reads the params, defaults and requirements it needs from
 * `GET /api/workflows`.
 */
export function workflowReference(id: string): string {
  return `FlixML workflow ${id}`;
}

/** Copy helper that works without the async clipboard API, which http origins don't get. */
export function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}
