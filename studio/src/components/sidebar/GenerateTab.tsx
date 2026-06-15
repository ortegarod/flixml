import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { LoraCheckpoint } from "../../types";

interface GenerateTabProps {
  checkpoints: LoraCheckpoint[];
  onQueued?: () => void;
}

type GenerateMode = "image" | "t2v" | "i2v";
type ImageModel = string;

interface GenerateResponse {
  ok: boolean;
  prompt_id?: string | null;
  checkpoint?: string | null;
  lora_name?: string | null;
  mode?: string;
  node_errors?: Record<string, unknown> | null;
}

interface CharacterSummary {
  id: string;
  name: string;
  trigger: string | null;
  base_prompt?: string | null;
  loras: { workflow?: string; name?: string; strength?: number }[];
  source_images: string[];
}

interface Provider {
  id: string;
  type: string;
  roles?: string[];
}

function providerForRole(providers: Provider[], role: string): string {
  const match = providers.find((p) => (p.roles ?? []).includes(role));
  if (match) return match.id;
  const fallback = providers.find((p) => (p.roles ?? []).includes("default"));
  if (fallback) return fallback.id;
  return providers[0]?.id ?? "";
}

interface WorkflowParamSchema {
  type: string;
  default?: unknown;
  required?: boolean;
}

interface WorkflowMeta {
  id: string;
  task?: string;
  output_type?: string;
  requirements?: { workflow_type?: string; supports_lora?: boolean };
  params: Record<string, WorkflowParamSchema>;
}

type WorkflowDefaults = Record<string, Record<string, unknown>>;

function getImageWorkflowTypes(workflows: WorkflowMeta[]): string[] {
  const types = new Set<string>();
  for (const w of workflows) {
    if (w.task === "text-to-image" && w.requirements?.workflow_type) {
      types.add(w.requirements.workflow_type);
    }
  }
  return Array.from(types);
}

function isFluxLike(type: string): boolean {
  return type.toLowerCase().includes("flux");
}

function displayNameForType(type: string): string {
  if (type === "flux2") return "Flux";
  if (type === "sdxl") return "SDXL";
  if (type === "sdxl") return "SDXL";
  return type;
}

// Resolve a workflow id from the registry by capability instead of hardcoding names.
function resolveWorkflowId(
  workflows: WorkflowMeta[],
  mode: GenerateMode,
  imageModel: string,
): string {
  const selector: { task: string; workflowType?: string; preferLora?: boolean } =
    mode === "image"
      ? { task: "text-to-image", workflowType: imageModel, preferLora: imageModel !== "sdxl" }
      : mode === "t2v"
        ? { task: "text-to-video" }
        : { task: "image-to-video" };

  const candidates = workflows.filter(
    (w) =>
      w.task === selector.task &&
      (selector.workflowType ? w.requirements?.workflow_type === selector.workflowType : true),
  );
  if (candidates.length === 0) return "";
  if (selector.preferLora != null) {
    const exact = candidates.find(
      (w) => Boolean(w.requirements?.supports_lora) === selector.preferLora,
    );
    if (exact) return exact.id;
  }
  return candidates[0].id;
}

const DEFAULT_IMAGE_PROMPT =
  "Atlas, portrait in a sleek AI media studio, leaning one hand on a workstation beside glowing video timeline screens, calm confident expression, modern editorial photography, warm cinematic key light, 85mm lens, shallow depth of field, realistic skin texture and sharp facial detail.";
const DEFAULT_SDXL_PROMPT =
  "portrait, detailed face, cinematic lighting, dramatic composition, realistic skin texture, shallow depth of field";
const DEFAULT_VIDEO_PROMPT =
  "cinematic motion, dramatic camera movement, atmospheric lighting, dynamic composition, polished short-form video style";

const VIDEO_LENGTHS = [33, 49, 65, 81] as const;

function checkpointLabel(checkpoint: LoraCheckpoint) {
  if (checkpoint.step == null) return `${checkpoint.name} · final`;
  return `${checkpoint.name} · step ${checkpoint.step.toLocaleString()}`;
}

function slugPrompt(prompt: string) {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return slug || "generation";
}

function outputPrefix(mode: GenerateMode, prompt: string) {
  const bucket = mode === "image" ? "images" : "videos";
  return `${bucket}/${slugPrompt(prompt)}-${Date.now()}`;
}

export function GenerateTab({ checkpoints, onQueued }: GenerateTabProps) {
  const latestCheckpoint = useMemo(() => {
    const final = checkpoints.find((checkpoint) => checkpoint.step == null);
    return final?.name || checkpoints[checkpoints.length - 1]?.name || "latest";
  }, [checkpoints]);

  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<GenerateMode>("image");
  const [imageModel, setImageModel] = useState<ImageModel>("");
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [availableCheckpoints, setAvailableCheckpoints] = useState<string[]>([]);
  const [characterId, setCharacterId] = useState("none");
  const [checkpoint, setCheckpoint] = useState("base");
  const [prompt, setPrompt] = useState(DEFAULT_IMAGE_PROMPT);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [sourceImage, setSourceImage] = useState("");
  const [width, setWidth] = useState(1248);
  const [height, setHeight] = useState(832);
  const [steps, setSteps] = useState(20);
  const [guidance, setGuidance] = useState(4);
  const [cfg, setCfg] = useState(5);
  const [sdxlCheckpoint, setSdxlCheckpoint] = useState("");
  const [loraStrength, setLoraStrength] = useState(1);
  const [provider, setProvider] = useState("");
  // Video output
  const [videoLength, setVideoLength] = useState(49);
  const [videoFps, setVideoFps] = useState(16);
  // Advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [seed, setSeed] = useState<string>("");
  const [stepsHigh, setStepsHigh] = useState(4);
  const [stepsLow, setStepsLow] = useState(4);
  const [cfgHigh, setCfgHigh] = useState(1.0);
  const [cfgLow, setCfgLow] = useState(1.0);
  const [shift, setShift] = useState(5.0);
  const [sampler, setSampler] = useState("euler");
  const [scheduler, setScheduler] = useState("simple");

  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([]);
  const [workflowDefaults, setWorkflowDefaults] = useState<WorkflowDefaults>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/characters")
      .then((r) => r.json())
      .then((data) => setCharacters(data.characters || []))
      .catch(() => setCharacters([]));

    fetch("/api/providers")
      .then((r) => r.json())
      .then((data: Provider[]) => {
        const list = data || [];
        setProviders(list);
        setProvider((current) => current || providerForRole(list, mode === "image" ? "image" : "video"));
      })
      .catch(() => setProviders([]));

    fetch("/api/workflows")
      .then((r) => r.json())
      .then((data: WorkflowMeta[]) => {
        setWorkflows(data);
        const defaults: WorkflowDefaults = {};
        for (const wf of data) {
          defaults[wf.id] = {};
          for (const [key, schema] of Object.entries(wf.params ?? {})) {
            if ("default" in schema) defaults[wf.id][key] = schema.default;
          }
        }
        setWorkflowDefaults(defaults);
        const imageTypes = getImageWorkflowTypes(data);
        setImageModel((current) => (imageTypes.includes(current) ? current : imageTypes[0] || ""));
      })
      .catch(() => {});

    fetch("/api/comfy/object_info/CheckpointLoaderSimple")
      .then((r) => r.json())
      .then((data) => {
        const names: string[] = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
        setAvailableCheckpoints(names);
        setSdxlCheckpoint((current) => current || names[0] || "");
      })
      .catch(() => setAvailableCheckpoints([]));
  }, []);

  useEffect(() => {
    const preselect = searchParams.get("character");
    if (preselect) {
      setCharacterId(preselect);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams.get("character")]);

  const selectedCharacter = characters.find((character) => character.id === characterId);
  const availableImageTypes = useMemo(() => getImageWorkflowTypes(workflows), [workflows]);
  const currentImageWorkflowId = resolveWorkflowId(workflows, "image", imageModel);
  const selectedCharacterHasImageLora = Boolean(
    selectedCharacter?.loras?.some((lora) => lora.workflow === currentImageWorkflowId),
  );
  const isVideoMode = mode !== "image";

  function applyWorkflowDefaults(workflowId: string) {
    const d = workflowDefaults[workflowId];
    if (!d) return;
    if (d.width != null) setWidth(d.width as number);
    if (d.height != null) setHeight(d.height as number);
    if (d.steps != null) setSteps(d.steps as number);
    if (d.cfg != null) setCfg(d.cfg as number);
    if (d.guidance != null) setGuidance(d.guidance as number);
    if (d.lora_strength != null) setLoraStrength(d.lora_strength as number);
    if (d.sampler != null) setSampler(d.sampler as string);
    if (d.scheduler != null) setScheduler(d.scheduler as string);
    if (d.length != null) setVideoLength(d.length as number);
    if (d.fps != null) setVideoFps(d.fps as number);
    if (d.steps_high != null) setStepsHigh(d.steps_high as number);
    if (d.steps_low != null) setStepsLow(d.steps_low as number);
    if (d.cfg_high != null) setCfgHigh(d.cfg_high as number);
    if (d.cfg_low != null) setCfgLow(d.cfg_low as number);
    if (d.shift != null) setShift(d.shift as number);
  }

  function selectMode(nextMode: GenerateMode) {
    setMode(nextMode);
    setPrompt(nextMode === "image" ? (imageModel === "sdxl" ? DEFAULT_SDXL_PROMPT : DEFAULT_IMAGE_PROMPT) : DEFAULT_VIDEO_PROMPT);
    setProvider(providerForRole(providers, nextMode !== "image" ? "video" : "image"));
    applyWorkflowDefaults(resolveWorkflowId(workflows, nextMode, imageModel));
    setResult(null);
    setError(null);
  }

  function selectImageModel(model: ImageModel) {
    setImageModel(model);
    setPrompt(model === "sdxl" ? DEFAULT_SDXL_PROMPT : DEFAULT_IMAGE_PROMPT);
    applyWorkflowDefaults(resolveWorkflowId(workflows, "image", model));
    setResult(null);
    setError(null);
  }

  async function submit() {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setError("Prompt is required.");
      return;
    }
    if (mode === "i2v" && !sourceImage.trim()) {
      setError("Image-to-video needs a source image path from the gallery, like images/example.png.");
      return;
    }
    if (mode === "image" && imageModel === "sdxl" && !sdxlCheckpoint) {
      setError("Choose a checkpoint discovered from your ComfyUI node.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const filenamePrefix = outputPrefix(mode, cleanPrompt);
      const endpoint = mode === "image" ? "/api/image/generate" : "/api/video/generate";
      const useCharacter = characterId !== "none";
      const useCheckpoint = !useCharacter && checkpoint !== "base";
      const parsedSeed = seed.trim() ? parseInt(seed, 10) : null;

      const imageWorkflow = resolveWorkflowId(workflows, "image", imageModel);

      const body = mode === "image"
        ? {
            workflow: imageWorkflow,
            provider,
            character: useCharacter ? characterId : undefined,
            checkpoint: isFluxLike(imageModel) && useCheckpoint ? (checkpoint || latestCheckpoint) : undefined,
            prompt: cleanPrompt,
            width,
            height,
            seed: parsedSeed ?? undefined,
            steps,
            lora_strength: loraStrength,
            ...(isFluxLike(imageModel) ? { guidance } : { cfg, checkpoint: sdxlCheckpoint }),
            filename_prefix: filenamePrefix,
            submit: true,
          }
        : {
            mode,
            workflow: resolveWorkflowId(workflows, mode, imageModel),
            provider,
            character: useCharacter ? characterId : undefined,
            image: mode === "i2v" ? sourceImage.trim() : undefined,
            prompt: cleanPrompt,
            negative: negativePrompt.trim() || undefined,
            width: width || undefined,
            height: height || undefined,
            length: videoLength,
            fps: videoFps,
            seed: parsedSeed ?? undefined,
            steps_high: stepsHigh,
            steps_low: stepsLow,
            cfg_high: cfgHigh,
            cfg_low: cfgLow,
            shift,
            sampler,
            scheduler,
            filename_prefix: filenamePrefix,
            submit: true,
          };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.detail || `${response.status}: failed to queue generation`);
      }

      setResult(data);
      onQueued?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      <section className="rounded-2xl border border-rose-600/30 bg-gradient-to-b from-rose-950/25 to-gray-950/70 p-4 space-y-3 shadow-lg shadow-rose-950/10">
        <h2 className="text-lg font-semibold">Tell your agent what to make</h2>
        <p className="text-sm text-gray-300 leading-relaxed">
          Describe the result. The agent chooses the character, workflow, endpoint, and settings.
        </p>
        <div className="rounded-xl border border-gray-800 bg-black/35 p-3">
          <p className="text-xs text-gray-300 leading-relaxed">"Generate an image of me walking through a rainy cyberpunk street."</p>
        </div>
      </section>

      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-2">
        {[
          ["image", "Image"],
          ["t2v", "Text → Video"],
          ["i2v", "Image → Video"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => selectMode(id as GenerateMode)}
            className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
              mode === id
                ? "border-rose-500/60 bg-rose-600/15 text-rose-200"
                : "border-gray-800 bg-gray-950/60 text-gray-500 hover:text-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Image model selector */}
      {mode === "image" && availableImageTypes.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-gray-400">Model</span>
          <div className="grid grid-cols-2 gap-2">
            {availableImageTypes.map((m) => (
              <button
                key={m}
                onClick={() => selectImageModel(m)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  imageModel === m
                    ? "border-rose-500/60 bg-rose-600/15 text-rose-200"
                    : "border-gray-800 bg-gray-950/60 text-gray-500 hover:text-gray-300"
                }`}
              >
                {displayNameForType(m)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SDXL checkpoint */}
      {mode === "image" && imageModel === "sdxl" && (
        <label className="block space-y-2">
          <span className="text-xs font-medium text-gray-400">Checkpoint</span>
          <select
            value={sdxlCheckpoint}
            onChange={(e) => setSdxlCheckpoint(e.target.value)}
            className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600"
          >
            {availableCheckpoints.length === 0 && <option value="">No checkpoints discovered</option>}
            {availableCheckpoints.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Checkpoints discovered from your connected ComfyUI node.
          </p>
        </label>
      )}

      {/* Character */}
      <label className="block space-y-2">
        <span className="text-xs font-medium text-gray-400">Character</span>
        <select
          value={characterId}
          onChange={(event) => setCharacterId(event.target.value)}
          className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600"
        >
          <option value="none">No character / raw workflow</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}{character.trigger ? ` · trigger: ${character.trigger}` : ""}
            </option>
          ))}
        </select>
        {selectedCharacter && (
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Uses this character's LoRA when available. Trigger word <span className="text-gray-400">{selectedCharacter.trigger || "none"}</span> added automatically.
          </p>
        )}
      </label>

      {/* Provider */}
      <label className="block space-y-2">
        <span className="text-xs font-medium text-gray-400">Provider</span>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600"
        >
          {providers.length === 0 && <option value={provider}>{provider}</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.id}</option>
          ))}
        </select>
      </label>

      {/* Prompt */}
      <label className="block space-y-2">
        <span className="text-xs font-medium text-gray-400">Prompt</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={8}
          className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white leading-relaxed resize-y focus:outline-none focus:border-rose-600"
        />
      </label>

      {/* Negative prompt — SDXL and video */}
      {(isVideoMode || (mode === "image" && imageModel === "sdxl")) && (
        <label className="block space-y-2">
          <span className="text-xs font-medium text-gray-400">Negative prompt</span>
          <textarea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            rows={3}
            placeholder={isVideoMode ? "Default WAN negative prompt applied when empty" : ""}
            className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white leading-relaxed resize-y focus:outline-none focus:border-rose-600 placeholder:text-gray-700"
          />
        </label>
      )}

      {/* Flux raw checkpoint */}
      {mode === "image" && isFluxLike(imageModel) && characterId === "none" && (
        <label className="block space-y-2">
          <span className="text-xs font-medium text-gray-400">Raw image checkpoint</span>
          <select
            value={checkpoint}
            onChange={(event) => setCheckpoint(event.target.value)}
            className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600"
          >
            <option value="base">Base Flux2 model — no LoRA</option>
            <option value="latest">Latest available LoRA checkpoint</option>
            {checkpoints.map((item) => (
              <option key={item.name} value={item.name}>
                {checkpointLabel(item)}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Raw image mode bypasses character selection.
          </p>
        </label>
      )}

      {mode === "image" && isFluxLike(imageModel) && characterId !== "none" && selectedCharacter && !selectedCharacterHasImageLora && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-200">
          This character does not have an image LoRA registered for the current workflow yet.
        </div>
      )}

      {/* I2V source image */}
      {mode === "i2v" && (
        <label className="block space-y-2">
          <span className="text-xs font-medium text-gray-400">Source image from gallery</span>
          <input
            value={sourceImage}
            onChange={(event) => setSourceImage(event.target.value)}
            placeholder="images/example.png"
            className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600"
          />
          <p className="text-[10px] text-gray-600">Open a gallery item and use its filename as the source.</p>
        </label>
      )}

      {/* Width / Height / Image params */}
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Width" value={width} onChange={setWidth} min={512} max={2048} step={64} />
        <NumberField label="Height" value={height} onChange={setHeight} min={512} max={2048} step={64} />
        {mode === "image" && <NumberField label="Steps" value={steps} onChange={setSteps} min={1} max={60} step={1} />}
        {mode === "image" && isFluxLike(imageModel) && <NumberField label="Guidance" value={guidance} onChange={setGuidance} min={1} max={10} step={0.5} />}
        {mode === "image" && imageModel === "sdxl" && <NumberField label="CFG" value={cfg} onChange={setCfg} min={1} max={15} step={0.5} />}
      </div>

      {mode === "image" && (
        <NumberField
          label="LoRA strength"
          value={loraStrength}
          onChange={setLoraStrength}
          min={0}
          max={2}
          step={0.05}
        />
      )}

      {/* Video output controls */}
      {isVideoMode && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-2">
            <span className="text-xs font-medium text-gray-400">Length (frames)</span>
            <select
              value={videoLength}
              onChange={(e) => setVideoLength(Number(e.target.value))}
              className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600"
            >
              {VIDEO_LENGTHS.map((n) => (
                <option key={n} value={n}>{n} frames (~{(n / videoFps).toFixed(1)}s)</option>
              ))}
            </select>
          </label>
          <NumberField label="FPS" value={videoFps} onChange={setVideoFps} min={8} max={30} step={1} />
        </div>
      )}

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="w-full flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-300 transition"
      >
        <span>Advanced</span>
        <span>{showAdvanced ? "▲" : "▼"}</span>
      </button>

      {showAdvanced && (
        <div className="space-y-3 rounded-lg border border-gray-800/60 bg-gray-950/40 p-3">
          {/* Seed */}
          <label className="block space-y-2">
            <span className="text-xs font-medium text-gray-400">Seed</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="Leave empty for random"
              className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600 placeholder:text-gray-700"
            />
          </label>

          {/* Video sampling params */}
          {isVideoMode && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Steps high" value={stepsHigh} onChange={setStepsHigh} min={1} max={50} step={1} />
                <NumberField label="Steps low" value={stepsLow} onChange={setStepsLow} min={1} max={50} step={1} />
                <NumberField label="CFG high" value={cfgHigh} onChange={setCfgHigh} min={0} max={10} step={0.1} />
                <NumberField label="CFG low" value={cfgLow} onChange={setCfgLow} min={0} max={10} step={0.1} />
              </div>
              <NumberField label="Shift" value={shift} onChange={setShift} min={0} max={20} step={0.5} />
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-gray-400">Sampler</span>
                  <input
                    value={sampler}
                    onChange={(e) => setSampler(e.target.value)}
                    className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-gray-400">Scheduler</span>
                  <input
                    value={scheduler}
                    onChange={(e) => setScheduler(e.target.value)}
                    className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600"
                  />
                </label>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-lg bg-rose-600 hover:bg-rose-500 disabled:bg-gray-800 disabled:text-gray-500 px-4 py-2.5 text-sm font-semibold transition"
      >
        {submitting ? "Queueing..." : mode === "image" ? "Generate image" : "Generate video"}
      </button>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-3 space-y-2">
          <p className="text-sm font-medium text-emerald-200">Queued successfully</p>
          <div className="text-xs text-emerald-100/80 space-y-1 break-all">
            <p>Prompt ID: {result.prompt_id}</p>
            {result.checkpoint && <p>Checkpoint: {result.checkpoint}</p>}
            {result.lora_name && <p>LoRA: {result.lora_name}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium text-gray-400">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg bg-gray-950 border border-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-600"
      />
    </label>
  );
}
