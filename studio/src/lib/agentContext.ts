import type { MediaItem } from "../types";

/**
 * Builds the "copy context for agent" block for a media asset.
 *
 * This is the bridge between the human scrolling the gallery and their AI agent:
 * the human copies this block from a card and pastes it into the agent so the
 * agent knows *exactly* which asset, prompt, character, and params are in play.
 * Every field the API exposes about the asset goes here — the logic stays hidden
 * from the human, but fully legible to the agent.
 */
export function buildAgentContext(item: MediaItem): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const absUrl = item.url?.startsWith("/") ? `${origin}${item.url}` : item.url;
  const meta = item.metadata || {};
  const wp = (meta.workflow_params as Record<string, any>) || {};

  const lines: string[] = ["[Nemoflix asset]"];
  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    lines.push(`${label}: ${value}`);
  };

  push("file", item.filename || item.name);
  push("id", item.prompt_id);
  push("type", item.type);
  push("url", absUrl);
  if (item.width && item.height) push("dimensions", `${item.width}x${item.height}`);
  push("character", (item.character_ids || []).join(", "));
  push("workflow", meta.workflow || wp.workflow);
  push("checkpoint", wp.checkpoint || meta.model);
  push("lora", wp.lora_name || (Array.isArray(meta.loras) ? meta.loras[0]?.name : undefined));
  push("seed", meta.seed ?? wp.seed);
  push("steps", meta.steps ?? wp.steps);
  push("cfg", meta.cfg ?? wp.cfg);
  push("sampler", meta.sampler || wp.sampler);
  if ((item.tags || []).length) push("tags", (item.tags || []).join(", "));
  const prompt = meta.prompt || item.prompt;
  if (prompt) push("prompt", prompt);

  return lines.join("\n");
}

/** Copy helper that works without the async clipboard API (matches GuideTab pattern). */
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
