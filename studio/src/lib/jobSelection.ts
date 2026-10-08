// The lightbox is driven by one selected string: an asset's URL. A job that has no
// file yet is selected as `job:<prompt_id>`, so the same state can open it.
const PREFIX = "job:";

export function jobSelection(promptId: string): string {
  return `${PREFIX}${promptId}`;
}

export function selectedJobId(selected: string | null | undefined): string | null {
  return selected && selected.startsWith(PREFIX) ? selected.slice(PREFIX.length) : null;
}
