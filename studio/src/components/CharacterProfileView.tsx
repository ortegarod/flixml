import { useCallback, useEffect, useState } from "react";
import { Cpu, Film, Image, Mic, RotateCcw, Save, Settings2, Sparkles, Trash2, UserRound, X, Check } from "lucide-react";
import { MediaTile } from "./MediaTile";
import type { MediaItem } from "../types";

interface LoraEntry {
  name: string;
  strength: number;
  workflow?: string;
  base_model?: string;
}

interface Checkpoint {
  name: string;
  step: number | null;
  size_bytes: number;
  modified_at: string;
}

interface CheckpointsResponse {
  job_name: string;
  checkpoints: Checkpoint[];
  count: number;
  updated_at: string;
}

interface CharacterRecord {
  id: string;
  name: string;
  kind: string | null;
  trigger: string | null;
  description: string | null;
  base_prompt: string | null;
  source_images: string[];
  loras: LoraEntry[];
  defaults: Record<string, unknown>;
  voice?: { provider: string; voice_id: string; name?: string | null; settings?: Record<string, unknown> } | null;
}

interface FormState {
  name: string;
  kind: string;
  trigger: string;
  description: string;
  base_prompt: string;
  source_images: string[];
  voice_provider: string;
  voice_id: string;
  voice_name: string;
  defaults_json: string;
}

interface CharacterProfileViewProps {
  characterId: string;
  onOpen: (url: string) => void;
  onDelete: (item: MediaItem) => Promise<void> | void;
  onGenerate: () => void;
  onSaved?: () => void;
}

function resolveImageUrl(img: string): string {
  return img.startsWith("/") ? img : `/media/${img}`;
}

function isVideo(item: MediaItem) {
  return item.type === "video" || item.url.endsWith(".mp4") || item.url.endsWith(".webm");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json();
}

function defaultsToJson(def: Record<string, unknown>): string {
  if (!def || Object.keys(def).length === 0) return "";
  try {
    return JSON.stringify(def, null, 2);
  } catch {
    return "";
  }
}

function parseDefaultsJson(json: string): Record<string, unknown> | null {
  const trimmed = json.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function recordToForm(record: CharacterRecord): FormState {
  return {
    name: record.name ?? "",
    kind: record.kind ?? "",
    trigger: record.trigger ?? "",
    description: record.description ?? "",
    base_prompt: record.base_prompt ?? "",
    source_images: [...(record.source_images || [])],
    voice_provider: record.voice?.provider ?? "elevenlabs",
    voice_id: record.voice?.voice_id ?? "",
    voice_name: record.voice?.name ?? "",
    defaults_json: defaultsToJson(record.defaults || {}),
  };
}

export function CharacterProfileView({ characterId, onOpen, onDelete, onGenerate, onSaved }: CharacterProfileViewProps) {
  const [character, setCharacter] = useState<CharacterRecord | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"images" | "videos">("images");
  const [checkpoints, setCheckpoints] = useState<CheckpointsResponse | null>(null);

  // Form state
  const [form, setForm] = useState<FormState>({
    name: "",
    kind: "",
    trigger: "",
    description: "",
    base_prompt: "",
    source_images: [],
    voice_provider: "elevenlabs",
    voice_id: "",
    voice_name: "",
    defaults_json: "",
  });
  const [original, setOriginal] = useState<FormState>(form);
  const [isDirty, setIsDirty] = useState(false);

  // Save / delete state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [charRes, mediaRes] = await Promise.all([
        fetchJson<{ character: CharacterRecord }>(`/api/characters/${characterId}`),
        fetchJson<{ images: MediaItem[] }>(`/api/characters/${characterId}/media`),
      ]);
      const char: CharacterRecord = charRes.character || (charRes as unknown as CharacterRecord);
      setCharacter(char);
      setMediaItems(mediaRes.images || []);

      const initial = recordToForm(char);
      setForm(initial);
      setOriginal(initial);
      setIsDirty(false);
      setSaveError(null);
      setSavedOk(false);

      if (char.loras.length > 0) {
        try {
          // Extract job_name prefix from the first LoRA binding to filter checkpoints.
          const firstLora = char.loras[0];
          const loraFile = firstLora?.name?.split("/").pop() ?? "";
          const jobNamePrefix = loraFile.replace(/_\d{6,}\.safetensors$/, "").replace(/\.safetensors$/, "");
          const query = jobNamePrefix ? `?job_name=${encodeURIComponent(jobNamePrefix)}` : "";
          const ckpts = await fetchJson<CheckpointsResponse>(`/api/lora-training/checkpoints${query}`);
          setCheckpoints(ckpts);
        } catch {
          // optional
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load character");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => { load(); }, [load]);

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      setIsDirty(JSON.stringify(next) !== JSON.stringify(original));
      return next;
    });
    setSavedOk(false);
  }, [original]);

  const save = useCallback(async () => {
    if (!character) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);

    const defaults = parseDefaultsJson(form.defaults_json);
    if (defaults === null) {
      setSaveError("Defaults JSON is invalid");
      setSaving(false);
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        kind: form.kind.trim() || null,
        trigger: form.trigger.trim() || null,
        description: form.description.trim() || null,
        base_prompt: form.base_prompt.trim() || null,
        source_images: form.source_images.filter((s) => s.trim()),
        voice: form.voice_id.trim()
          ? {
              provider: form.voice_provider.trim() || "elevenlabs",
              voice_id: form.voice_id.trim(),
              name: form.voice_name.trim() || null,
              settings: {},
            }
          : null,
        defaults,
      };
      const res = await fetch(`/api/characters/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        throw new Error((body.detail as string) || `PATCH returned ${res.status}`);
      }
      await load();
      setSavedOk(true);
      onSaved?.();
      // clear success after 3s
      setTimeout(() => setSavedOk(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [character, characterId, form, load, onSaved]);

  const reset = useCallback(() => {
    setForm(original);
    setIsDirty(false);
    setSaveError(null);
    setSavedOk(false);
  }, [original]);

  const removeCharacter = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/characters/${characterId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        throw new Error((body.detail as string) || `DELETE returned ${res.status}`);
      }
      window.location.href = "/studio";
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete character");
      setDeleting(false);
    }
  }, [characterId]);

  const images = mediaItems.filter((item) => !isVideo(item));
  const videos = mediaItems.filter(isVideo);
  const shown = tab === "images" ? images : videos;

  if (loading) return <div className="p-6 text-gray-500">Loading character...</div>;
  if (error) return <div className="p-6 text-red-400">{error}</div>;
  if (!character) return null;

  const avatarUrl = form.source_images[0] ? resolveImageUrl(form.source_images[0]) : null;
  const loraCount = character.loras.length;

  const inputBase =
    "w-full rounded-lg border border-gray-700 bg-black/30 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-rose-500 focus:bg-black/50 focus:outline-none transition";
  const textareaBase =
    "w-full rounded-lg border border-gray-700 bg-black/30 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-rose-500 focus:bg-black/50 focus:outline-none transition resize-none font-mono leading-relaxed";

  return (
    <div className="p-5 lg:p-7 space-y-6">
      {/* ── Status Bar ── */}
      {(isDirty || saving || saveError || savedOk) && (
        <div className="sticky top-0 z-40 rounded-2xl border border-gray-800 bg-gray-950/90 backdrop-blur-sm px-4 py-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2 text-sm">
            {saving && (
              <>
                <span className="w-3.5 h-3.5 border-2 border-rose-500/30 border-t-rose-500 rounded-full animate-spin" />
                <span className="text-gray-400">Saving...</span>
              </>
            )}
            {!saving && saveError && <span className="text-red-400">{saveError}</span>}
            {!saving && !saveError && savedOk && (
              <span className="text-emerald-400 flex items-center gap-1.5">
                <Check className="w-4 h-4" /> Saved
              </span>
            )}
            {!saving && !saveError && !savedOk && isDirty && (
              <span className="text-amber-400">Unsaved changes</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <>
                <button
                  onClick={reset}
                  className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-400 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white transition flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" /> Save
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Hero / Profile Header ── */}
      <section className="rounded-3xl border border-gray-800/60 bg-gradient-to-b from-gray-900/70 to-gray-950/40 overflow-hidden">
        <div className="relative h-44 bg-gradient-to-br from-rose-950/50 via-fuchsia-950/20 to-amber-950/20">
          {avatarUrl && <img src={avatarUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35 blur-sm scale-105" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        </div>

        <div className="px-5 lg:px-7 pb-6 -mt-16 relative">
          <div className="flex flex-col lg:flex-row lg:items-end gap-5">
            {/* Avatar */}
            <div className="w-32 h-32 rounded-3xl overflow-hidden ring-4 ring-black bg-gray-900 shadow-2xl flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={form.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-rose-500 to-amber-400 flex items-center justify-center">
                  <UserRound className="w-12 h-12 text-white" />
                </div>
              )}
            </div>

            {/* Form fields */}
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={form.kind}
                  onChange={(e) => updateField("kind", e.target.value)}
                  className={inputBase + " w-auto appearance-none text-xs"}
                >
                  <option value="">Select kind</option>
                  <option value="human">Human</option>
                  <option value="agent">Agent</option>
                </select>
                <input
                  type="text"
                  value={form.trigger}
                  onChange={(e) => updateField("trigger", e.target.value)}
                  className={inputBase + " w-48 text-xs"}
                  placeholder="Trigger word"
                />
              </div>

              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                className="w-full max-w-lg text-3xl font-bold tracking-tight bg-transparent border-b border-gray-700 focus:border-rose-500 focus:outline-none px-0 py-1 transition text-white placeholder-gray-600"
                placeholder="Character name"
              />

              <textarea
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                rows={2}
                className="w-full max-w-2xl text-sm text-gray-300 bg-transparent border border-gray-700 focus:border-rose-500 focus:bg-black/20 focus:outline-none rounded-lg px-3 py-2 transition resize-none placeholder-gray-600"
                placeholder="Description"
              />
            </div>

            <div className="flex gap-2 flex-shrink-0">
              <button onClick={onGenerate} className="rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-sm font-semibold transition flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Generate
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-6 max-w-xl">
            <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
              <p className="text-xs text-gray-600">Images</p>
              <p className="text-xl font-bold text-gray-100">{images.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
              <p className="text-xs text-gray-600">Videos</p>
              <p className="text-xl font-bold text-gray-100">{videos.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
              <p className="text-xs text-gray-600">LoRAs</p>
              <p className="text-xl font-bold text-gray-100">{loraCount}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Base Prompt ── */}
      <section className="rounded-3xl border border-gray-800/60 bg-gray-950/40 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-300" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Base Prompt</h2>
        </div>
        <textarea
          value={form.base_prompt}
          onChange={(e) => updateField("base_prompt", e.target.value)}
          rows={8}
          className={textareaBase}
          placeholder="The base prompt appended to every generation for this character..."
        />
        <p className="text-[11px] text-gray-500">
          This prompt is merged into every image and video generation. Click Save to apply changes.
        </p>
      </section>

      {/* ── Voice ── */}
      <section className="rounded-3xl border border-gray-800/60 bg-gray-950/40 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Voice</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5 block">Provider</label>
            <select
              value={form.voice_provider}
              onChange={(e) => updateField("voice_provider", e.target.value)}
              className={inputBase}
            >
              <option value="elevenlabs">ElevenLabs</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5 block">Voice ID</label>
            <input
              type="text"
              value={form.voice_id}
              onChange={(e) => updateField("voice_id", e.target.value)}
              className={inputBase}
              placeholder="e.g. cNJNKUz67BqA7H2Sj5Sd"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5 block">Voice Name</label>
            <input
              type="text"
              value={form.voice_name}
              onChange={(e) => updateField("voice_name", e.target.value)}
              className={inputBase}
              placeholder="Human-readable label"
            />
          </div>
        </div>
      </section>

      {/* ── Defaults ── */}
      <section className="rounded-3xl border border-gray-800/60 bg-gray-950/40 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Defaults</h2>
        </div>
        <textarea
          value={form.defaults_json}
          onChange={(e) => updateField("defaults_json", e.target.value)}
          rows={6}
          className={textareaBase}
          placeholder='{"strength": 0.8, "steps": 28}'
        />
        <p className="text-[11px] text-gray-500">
          JSON object of default generation parameters. Invalid JSON will block save.
        </p>
      </section>

      {/* ── Save / Reset Bar (bottom) ── */}
      {isDirty && (
        <div className="sticky bottom-4 z-40 rounded-2xl border border-gray-700 bg-gray-950/95 backdrop-blur-sm px-5 py-3 flex items-center justify-between shadow-xl">
          <span className="text-sm text-amber-400">You have unsaved changes</span>
          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-400 hover:text-white hover:border-gray-500 transition flex items-center gap-1.5"
            >
              <RotateCcw className="w-4 h-4" /> Reset
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition flex items-center gap-1.5"
            >
              {saving ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* ── LoRAs ── */}
      {character.loras.length > 0 && (
        <section className="rounded-3xl border border-gray-800/60 bg-gray-950/40 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Model</h2>
          </div>

          <div className="space-y-3">
            {character.loras.map((lora, i) => {
              const shortName = lora.name.split("/").pop() ?? lora.name;
              return (
                <div key={i} className="rounded-2xl border border-gray-800/60 bg-black/30 p-4 space-y-3">
                  <p className="text-xs font-mono text-violet-300 break-all">{shortName}</p>
                  <div className="grid grid-cols-3 gap-3">
                    {lora.base_model && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-gray-600">Base</p>
                        <p className="text-xs text-gray-300 mt-0.5 font-mono">{lora.base_model}</p>
                      </div>
                    )}
                    {lora.workflow && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-gray-600">Workflow</p>
                        <p className="text-xs text-gray-300 mt-0.5 font-mono">{lora.workflow}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-gray-600">Strength</p>
                      <p className="text-xs text-gray-300 mt-0.5 font-mono">{lora.strength}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {checkpoints && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-gray-600">
                  Training Checkpoints — <span className="font-mono">{checkpoints.job_name}</span>
                </p>
                <p className="text-[10px] text-gray-700">
                  checked {new Date(checkpoints.updated_at).toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-gray-800/60 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800/60 bg-black/20">
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-gray-600 font-medium">Step</th>
                      <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-gray-600 font-medium">File</th>
                      <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-gray-600 font-medium">Size</th>
                      <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-gray-600 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkpoints.checkpoints.map((ck, i) => (
                      <tr key={i} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-900/30">
                        <td className="px-3 py-2 font-mono text-violet-300">{ck.step ?? "final"}</td>
                        <td className="px-3 py-2 text-gray-400 font-mono text-[11px] break-all">{ck.name}</td>
                        <td className="px-3 py-2 text-gray-400 text-right font-mono">{(ck.size_bytes / 1024 / 1024).toFixed(0)} MB</td>
                        <td className="px-3 py-2 text-gray-500 text-right whitespace-nowrap">{new Date(ck.modified_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Danger Zone ── */}
      <section className="rounded-3xl border border-red-900/30 bg-red-950/10 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-red-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-red-300">Danger Zone</h2>
        </div>
        <p className="text-sm text-gray-500">
          Deleting a character removes the record and all associated media. This cannot be undone.
        </p>
        {showDeleteConfirm ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-red-300">Are you sure? This deletes everything.</span>
            <button
              onClick={removeCharacter}
              disabled={deleting}
              className="rounded-xl bg-red-700 hover:bg-red-600 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition"
            >
              {deleting ? "Deleting…" : "Yes, Delete"}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-400 hover:text-white transition"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-xl border border-red-800/60 bg-red-950/20 hover:bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-300 transition flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Delete Character
          </button>
        )}
      </section>

      {/* ── Media Gallery ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-gray-800/60">
          <button onClick={() => setTab("images")} className={`px-4 py-3 text-sm font-medium border-b-2 transition flex items-center gap-2 ${tab === "images" ? "text-white border-rose-500" : "text-gray-600 border-transparent hover:text-gray-300"}`}>
            <Image className="w-4 h-4" /> Images
          </button>
          <button onClick={() => setTab("videos")} className={`px-4 py-3 text-sm font-medium border-b-2 transition flex items-center gap-2 ${tab === "videos" ? "text-white border-rose-500" : "text-gray-600 border-transparent hover:text-gray-300"}`}>
            <Film className="w-4 h-4" /> Videos
          </button>
        </div>

        {shown.length === 0 ? (
          <div className="rounded-2xl border border-gray-800/60 bg-gray-900/20 p-10 text-center text-sm text-gray-500">
            No {tab} found for this character yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {shown.map((item) => (
              <MediaTile key={item.filename || item.url} item={item} onOpen={() => onOpen(item.url)} onDelete={onDelete} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
