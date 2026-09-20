import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { copyText, workflowReference } from "../../lib/agentContext";
import { MediaPreview } from "../MediaPreview";
import { workflowExamples } from "../../data/workflowExamples";
import { clock } from "../../lib/duration";

// The public workflow catalog. Studio is the browsing surface — what a workflow is
// good for, what it needs and how it behaves is written once, there, instead of
// inside every install. A page per shipped id; a workflow from the local tier has
// none, which is why only shipped cards carry the link.
const siteWorkflowUrl = (id: string) => `https://flixml.com/workflows/${id}`;

// Shape of a registry workflow as served by GET /api/workflows. Everything the
// docs below render is derived live from this — no static workflow doc to drift.
export interface WorkflowMeta {
  id: string;
  name?: string;
  description?: string;
  task?: string;
  output_type?: "image" | "video";
  // "shipped" is a workflow FlixML ships and documents; "local" is one the operator
  // dropped into workflows/local/, which nothing here describes or vouches for.
  source?: "shipped" | "local";
  requirements?: {
    vram_gb?: number;
    workflow_type?: string;
    supports_lora?: boolean;
    requires_image?: boolean;
    requires_audio?: boolean;
  };
  // Measured on this install from recent completed jobs; null until one finishes.
  run_time?: {
    by_provider: Record<string, { median_seconds: number; min_seconds: number; max_seconds: number; samples: number }>;
  } | null;
  // One output this install made with the workflow — tagged `showcase`, else the
  // newest. Null until the workflow has produced something here.
  example?: {
    filename: string;
    type: string;
    url: string;
    thumb: string;
    width?: number;
    height?: number;
    prompt_id?: string;
  } | null;
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
    example: "Animate this image: she turns to the camera and pulls her jacket closed as the wind hits.",
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
// which lumps lip-sync under wanvideo_wrapper). No match means no badge: text_logo runs
// no model at all, and a workflow from the local/ tier is one this build has never heard
// of. A chip reading "Model" claimed a model in both cases and named one in neither.
function modelFamily(id: string): { label: string; cls: string } | null {
  if (id.startsWith("flux2")) return { label: "FLUX.2", cls: "bg-amber-500/15 text-amber-200" };
  if (id.startsWith("sdxl")) return { label: "SDXL", cls: "bg-white/5 text-gray-300" };
  if (id.startsWith("qwen")) return { label: "Qwen", cls: "bg-white/5 text-gray-300" };
  if (id.startsWith("infinitetalk")) return { label: "InfiniteTalk", cls: "bg-white/5 text-gray-300" };
  if (id.startsWith("wan22")) return { label: "Wan 2.2", cls: "bg-white/5 text-gray-300" };
  return null;
}

function InOut({ input, output }: { input: string; output: string }) {
  return (
    <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-mono">
      <span className="rounded bg-white/[0.05] px-1 py-0.5 text-gray-400">{input}</span>
      <span className="text-gray-600">→</span>
      <span className="rounded bg-white/5 px-1 py-0.5 text-gray-300">{output}</span>
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

// Typical run time from job history. One node shows its median; several show the
// range of their medians. The title names each node and how many runs it's based on.
function RunTimeChip({ runTime }: { runTime: WorkflowMeta["run_time"] }) {
  const nodes = Object.entries(runTime?.by_provider ?? {});
  if (nodes.length === 0) return null;
  const medians = nodes.map(([, s]) => s.median_seconds);
  const low = Math.min(...medians);
  const high = Math.max(...medians);
  const label = low === high ? clock(low) : `${clock(low)}–${clock(high)}`;
  const title = nodes
    .map(([node, s]) => {
      const spread = s.min_seconds === s.max_seconds ? "" : `${clock(s.min_seconds)}–${clock(s.max_seconds)}, `;
      return `${node}: typically ${clock(s.median_seconds)} (${spread}last ${s.samples} run${s.samples === 1 ? "" : "s"})`;
    })
    .join("\n");
  return (
    <Chip cls="bg-white/5 text-gray-300">
      <span title={title}>{label} run</span>
    </Chip>
  );
}

// The card's face: the sample that ships with FlixML, identical on every install.
// It is never the user's own output — a card says what the workflow makes, and what
// this box has made with it is the gallery's job. A video plays while the card is on
// screen as the list scrolls. A workflow with no sample says what it takes instead.
function Example({ w, taskLabel }: { w: WorkflowMeta; taskLabel: string }) {
  const ex = workflowExamples[w.id];

  if (!ex) {
    return (
      <div className="aspect-[4/3] rounded-lg border border-dashed border-gray-800 bg-black/20 flex flex-col items-center justify-center gap-1 text-center px-3">
        <p className="text-[11px] text-gray-500">No sample yet</p>
        <p className="text-[10px] text-gray-600">{taskLabel}</p>
      </div>
    );
  }

  return (
    <div className="aspect-[4/3] rounded-lg overflow-hidden bg-black/40 relative">
      <MediaPreview
        type={ex.type}
        url={ex.src}
        thumb={ex.poster}
        alt={ex.alt}
        className="w-full h-full object-cover"
      />
      {ex.type === "video" && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 py-0.5 text-[9px] text-gray-300">
          video
        </span>
      )}
    </div>
  );
}

// One workflow card, led by what it actually produced here. The spec chips under it are
// objective only (model, VRAM, measured run time, LoRA, needs-image/voice) — no opinions,
// and no description paragraph: that's what the picture replaced.
function WorkflowCard({ w, taskLabel }: { w: WorkflowMeta; taskLabel: string }) {
  const req = w.requirements ?? {};
  const fam = modelFamily(w.id);
  const [copied, setCopied] = useState(false);

  // The id is what the human hands their agent — one piece of information, and the
  // agent reads the params off the API from there.
  const copyId = () => {
    copyText(workflowReference(w.id));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-2 space-y-1.5">
      <Example w={w} taskLabel={taskLabel} />
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs font-semibold text-gray-100 truncate">{w.name ?? w.id}</span>
        <button
          onClick={copyId}
          title={`Copy "${workflowReference(w.id)}" to give your agent`}
          className="shrink-0 inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[9px] text-gray-600 hover:bg-white/5 hover:text-gray-300 transition"
        >
          {w.id}
          {copied ? <Check className="w-2.5 h-2.5 text-brand" /> : <Copy className="w-2.5 h-2.5" />}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-1">
        {w.source === "local" && (
          <Chip cls="border border-white/20 bg-white/5 text-gray-200 uppercase tracking-wide">Local</Chip>
        )}
        {fam && <Chip cls={fam.cls}>{fam.label}</Chip>}
        {typeof req.vram_gb === "number" && <Chip>{req.vram_gb} GB VRAM</Chip>}
        <RunTimeChip runTime={w.run_time} />
        {req.supports_lora && <Chip cls="bg-white/5 text-gray-300">LoRA</Chip>}
        {req.requires_image && <Chip>needs image</Chip>}
        {req.requires_audio && <Chip cls="bg-white/5 text-gray-300">needs voice</Chip>}
        {/* Only a shipped workflow is in the site's catalog. A local one is the operator's
            own file: flixml.com has never heard of it, and linking would send them to a
            page that doesn't describe what they're looking at. */}
        {w.source !== "local" && (
          <a
            href={siteWorkflowUrl(w.id)}
            target="_blank"
            rel="noreferrer"
            title={`What ${w.name ?? w.id} is good for, what it needs, and how to drive it`}
            className="ml-auto inline-flex items-center gap-0.5 text-[9px] text-gray-500 hover:text-brand transition"
          >
            Docs
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}

export function WorkflowsTab() {
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

  // Workflows dropped into workflows/local/ are the operator's own files — unreviewed,
  // undocumented, and possibly nothing like what FlixML ships. They get their own
  // section rather than sitting among ours where the difference is invisible.
  const shipped = useMemo(() => workflows.filter((w) => w.source !== "local"), [workflows]);
  const local = useMemo(() => workflows.filter((w) => w.source === "local"), [workflows]);

  // Group → task → workflows[], all live from the registry so it stays in sync.
  const tree = useMemo(() => {
    const byTask = new Map<string, WorkflowMeta[]>();
    for (const w of shipped) {
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
  }, [shipped]);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      <section className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4 space-y-2 shadow-lg shadow-black/20">
        <h2 className="text-lg font-semibold">Start here</h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          FlixML Studio is an AI image &amp; video studio you run by talking to your agent. You say
          what you want; your agent makes it through the API and it lands in your gallery. Below is
          every workflow you have installed — what it makes, what it needs, and which model it runs.
        </p>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white">What can you make here?</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Grouped by what goes in and what comes out. Copy an example and paste it to your agent,
            or copy a workflow's id to name it exactly. Docs opens that workflow's page on flixml.com.
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
                    <WorkflowCard key={w.id} w={w} taskLabel={meta.label} />
                  ))}
                </div>
                <button
                  onClick={() => copyExample(task, meta.example)}
                  className="w-full text-left rounded-lg border border-gray-800 bg-black/35 px-2.5 py-1.5 text-[11px] text-gray-400 hover:border-brand hover:text-gray-200 transition"
                  title="Copy this instruction to give your agent"
                >
                  {copiedKey === task ? "Copied ✓" : `Try: "${meta.example}"`}
                </button>
              </div>
            ))}
          </div>
        ))}

        {/* The operator's own workflows, kept visibly apart from what FlixML ships. */}
        {local.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Your own workflows
            </p>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Found in <span className="font-mono text-gray-400">workflows/local/</span> on this
              install. FlixML didn't ship these and doesn't document them — what they make, what
              they need and what they put in your gallery is whatever their author wrote.
            </p>
            <div className="space-y-1.5">
              {local.map((w) => (
                <WorkflowCard
                  key={w.id}
                  w={w}
                  taskLabel={TASKS[w.task ?? ""]?.label ?? "Local workflow"}
                />
              ))}
            </div>
          </div>
        )}

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
