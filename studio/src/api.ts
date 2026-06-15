const API_BASE = "";

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export async function getListing(): Promise<{ images: any[]; total: number }> {
  return apiFetch("/api/listing");
}

async function providerForRole(role: string): Promise<string> {
  const list: Array<{ id: string; roles?: string[] }> = await apiFetch("/api/providers");
  const match = list.find((p) => (p.roles ?? []).includes(role));
  if (match) return match.id;
  const fallback = list.find((p) => (p.roles ?? []).includes("default"));
  return (fallback ?? list[0])?.id ?? "";
}

async function workflowForTask(task: string): Promise<string> {
  const list: Array<{ id: string; task?: string }> = await apiFetch("/api/workflows");
  return list.find((w) => w.task === task)?.id ?? "";
}

export async function generateVideo(params: {
  image: string;
  prompt?: string;
  width?: number;
  height?: number;
  length?: number;
  fps?: number;
}): Promise<{ ok: boolean; prompt_id: string; mode: string }> {
  const [provider, workflow] = await Promise.all([
    providerForRole("video"),
    workflowForTask("image-to-video"),
  ]);
  return apiFetch("/api/video/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "i2v",
      workflow,
      provider,
      image: params.image,
      prompt: params.prompt || "",
      ...(params.width ? { width: params.width } : {}),
      ...(params.height ? { height: params.height } : {}),
      length: params.length || 49,
      fps: params.fps || 16,
    }),
  });
}
