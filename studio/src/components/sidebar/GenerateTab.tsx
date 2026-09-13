import { useEffect, useMemo, useState } from "react";
import { copyText } from "../../lib/agentContext";

// Shape of a registry workflow as served by GET /api/workflows. Everything the
// docs below render is derived live from this — no static workflow doc to drift.
interface WorkflowMeta {
  id: string;
  name?: string;
  description?: string;
  task?: string;
  output_type?: "image" | "video";
  requirements?: {
    vram_gb?: number;
    workflow_type?: string;
    supports_lora?: boolean;
    requires_image?: boolean;
    requires_audio?: boolean;
  };
}

// ── Presentation maps ───────────────────────────────────────────────────────
// The registry speaks in machine tokens (task strings, workflow_type). These
// turn them into the words an end user thinks in, and fix the display order.

type GroupKey = "Images" | "Videos";
const GROUP_ORDER: GroupKey[] = ["Images", "Videos"];

// Each task = one subgroup. Order within a group, plus its in→out framing and a
// copyable "paste to your agent" example so a newcomer has somewhere to start.
const TASKS: Record<
  string,
  { group: GroupKey; label: string; input: string; output: string; order: number; example: string }
> = {
  "text-to-image": {
    group: "Images",
    label: "Text → Image",
    input: "Text",
    output: "Image",
    order: 0,
    example: "Generate an image of me on a rainy neon rooftop at night, cinematic.",
  },
  "image-to-image": {
    group: "Images",
    label: "Image → Image",
    input: "Image",
    output: "Image",
    order: 1,
    example: "From this image, give me three new camera angles of the same shot.",
  },
  "face-reference-to-image": {
    group: "Images",
    label: "Face → Image",
    input: "Face",
    output: "Image",
    order: 2,
    example: "Use this face as the reference and make a portrait in golden-hour light.",
  },
  "text-to-video": {
    group: "Videos",
    label: "Text → Video",
    input: "Text",
    output: "Video",
    order: 0,
    example: "A short cinematic clip of a woman walking through neon rain at night.",
  },
  "image-to-video": {
    group: "Videos",
    label: "Image → Video",
    input: "Image",
    output: "Video",
    order: 1,
    example: "Animate this image — slow push-in, hair moving in the wind.",
  },
  "first-last-frame-to-video": {
    group: "Videos",
    label: "Start + End → Video",
    input: "2 frames",
    output: "Video",
    order: 2,
    example: "Blend from this first frame to this last frame into one smooth clip.",
  },
  "video-to-video": {
    group: "Videos",
    label: "Video → Video",
    input: "Clip + voice",
    output: "Video",
    order: 3,
    example: "Take this clip and sync it to this voice line: 'You found me.'",
  },
};

// Model family badge, derived from the workflow id (more human than workflow_type,
// which lumps lip-sync under wanvideo_wrapper). Workflows from the private local/
// tier fall through to the generic badge — the public build knows nothing about them.
function modelFamily(id: string): { label: string; cls: string } {
  if (id.startsWith("flux2")) return { label: "FLUX.2", cls: "bg-amber-500/15 text-amber-200" };
  if (id.startsWith("sdxl")) return { label: "SDXL", cls: "bg-sky-500/15 text-sky-200" };
  if (id.startsWith("qwen")) return { label: "Qwen", cls: "bg-violet-500/15 text-violet-200" };
  if (id.startsWith("infinitetalk")) return { label: "InfiniteTalk", cls: "bg-emerald-500/15 text-emerald-200" };
  if (id.startsWith("wan22")) return { label: "Wan 2.2", cls: "bg-rose-500/15 text-rose-200" };
  return { label: "Model", cls: "bg-white/10 text-gray-300" };
}

function InOut({ input, output }: { input: string; output: string }) {
  return (
    <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-mono">
      <span className="rounded bg-white/[0.05] px-1 py-0.5 text-gray-400">{input}</span>
      <span className="text-gray-600">→</span>
      <span className="rounded bg-rose-600/15 px-1 py-0.5 text-rose-200">{output}</span>
    </span>
  );
}

function Chip({ children, cls }: { children: React.ReactNode; cls?: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${cls ?? "bg-white/[0.06] text-gray-400"}`}>
      {children}
    </span>
  );
}

// One workflow row. The factual, workflow-authored description is always visible —
// that's what makes two same-family workflows legibly different — alongside
// objective spec chips only (model, VRAM, LoRA, needs-image/voice). No opinions.
function WorkflowCard({ w }: { w: WorkflowMeta }) {
  const req = w.requirements ?? {};
  const fam = modelFamily(w.id);
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/50 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-100 truncate">{w.name ?? w.id}</span>
        <span className="shrink-0 font-mono text-[9px] text-gray-600">{w.id}</span>
      </div>
      {w.description && (
        <p className="text-[11px] text-gray-400 leading-snug">{w.description}</p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Chip cls={fam.cls}>{fam.label}</Chip>
        {typeof req.vram_gb === "number" && <Chip>{req.vram_gb} GB VRAM</Chip>}
        {req.supports_lora && <Chip cls="bg-rose-600/15 text-rose-200">LoRA</Chip>}
        {req.requires_image && <Chip>needs image</Chip>}
        {req.requires_audio && <Chip cls="bg-emerald-500/15 text-emerald-200">needs voice</Chip>}
      </div>
    </div>
  );
}

export function GenerateTab() {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((data: WorkflowMeta[]) => setWorkflows(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const copyExample = (key: string, text: string) => {
    copyText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  // Group → task → workflows[], all live from the registry so it stays in sync.
  const tree = useMemo(() => {
    const byTask = new Map<string, WorkflowMeta[]>();
    for (const w of workflows) {
      const t = w.task ?? "";
      if (!TASKS[t]) continue; // skip anything we don't have a framing for
      if (!byTask.has(t)) byTask.set(t, []);
      byTask.get(t)!.push(w);
    }
    return GROUP_ORDER.map((group) => {
      const tasks = [...byTask.entries()]
        .filter(([t]) => TASKS[t].group === group)
        .sort((a, b) => TASKS[a[0]].order - TASKS[b[0]].order)
        .map(([t, ws]) => ({ task: t, meta: TASKS[t], workflows: ws }));
      return { group, tasks };
    }).filter((g) => g.tasks.length > 0);
  }, [workflows]);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      <section className="rounded-2xl border border-rose-600/30 bg-gradient-to-b from-rose-950/25 to-gray-950/70 p-4 space-y-2 shadow-lg shadow-rose-950/10">
        <h2 className="text-lg font-semibold">Start here</h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          Nemoflix Studio is an AI image &amp; video studio you run by talking to your agent. You say
          what you want; your agent makes it through the API and it lands in your gallery. Below is
          every workflow you have installed — what it makes, what it needs, and which model it runs.
        </p>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white">What can you make here?</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Grouped by what goes in and what comes out. Tap a workflow for details, or copy an example
            and paste it to your agent.
          </p>
        </div>

        {workflows.length === 0 && (
          <p className="text-xs text-gray-600">Loading workflows…</p>
        )}

        {tree.map(({ group, tasks }) => (
          <div key={group} className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{group}</p>
            {tasks.map(({ task, meta, workflows: ws }) => (
              <div key={task} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-200">{meta.label}</span>
                  <InOut input={meta.input} output={meta.output} />
                </div>
                <div className="space-y-1.5">
                  {ws.map((w) => (
                    <WorkflowCard key={w.id} w={w} />
                  ))}
                </div>
                <button
                  onClick={() => copyExample(task, meta.example)}
                  className="w-full text-left rounded-lg border border-gray-800 bg-black/35 px-2.5 py-1.5 text-[11px] text-gray-400 hover:border-rose-600/50 hover:text-gray-200 transition"
                  title="Copy this instruction to give your agent"
                >
                  {copiedKey === task ? "Copied ✓" : `Try: "${meta.example}"`}
                </button>
              </div>
            ))}
          </div>
        ))}

        {/* Movies — lives in the Projects tab, not a single workflow */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Movies</p>
          <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-100">Stitch shots into a film</span>
              <InOut input="Many shots" output="Movie" />
            </div>
            <p className="text-[10px] text-gray-500">
              Script, scenes, shots, voiceover and subtitles — that's the{" "}
              <span className="text-gray-300">Projects</span> tab.
            </p>
          </div>
        </div>

        <p className="text-[10px] text-gray-600 leading-relaxed">
          Want it to always look like a specific person? Train a character under{" "}
          <span className="text-gray-400">Characters</span>, then just name them in your prompt.
        </p>
      </section>
    </div>
  );
}
