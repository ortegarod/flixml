import { useEffect, useMemo, useState } from "react";
import { Film, Image as ImageIcon, Video, Wand2, Plus, Save, Layers, Sparkles, Edit3, Play, ArrowLeft } from "lucide-react";
import type { Project, Scene, Shot, ShotVersion, ProjectPhase } from "../types";

interface ProjectDetailViewProps {
  project: Project;
  scenes: Scene[];
  shots: Shot[];
  phase: ProjectPhase;
  selectedSceneId: string | null;
  selectedShotId: string | null;
  onSelectScene: (id: string) => void;
  onSelectShot: (id: string | null) => void;
  onRefresh: () => Promise<void> | void;
  onBack: () => void;
}

function mediaUrl(file: string | null | undefined): string | null {
  if (!file) return null;
  if (file.startsWith("/") || file.startsWith("http")) return file;
  return `/media/${file}`;
}

export function ProjectDetailView({
  project, scenes, shots, phase,
  selectedSceneId, selectedShotId,
  onSelectScene, onSelectShot, onRefresh, onBack,
}: ProjectDetailViewProps) {
  const [versions, setVersions] = useState<ShotVersion[]>([]);
  const [busyShotId, setBusyShotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedScene = useMemo(() => scenes.find((s) => s.id === selectedSceneId) || null, [scenes, selectedSceneId]);
  const selectedShot = useMemo(() => shots.find((s) => s.id === selectedShotId) || null, [shots, selectedShotId]);
  const sceneShots = useMemo(() => shots.filter((s) => s.scene_id === selectedSceneId), [shots, selectedSceneId]);

  // Load versions for the focused shot
  useEffect(() => {
    if (!selectedShotId || !selectedSceneId) { setVersions([]); return; }
    let cancelled = false;
    fetch(`/api/projects/${project.id}/scenes/${selectedSceneId}/shots/${selectedShotId}/versions`)
      .then((r) => r.ok ? r.json() : { versions: [] })
      .then((data) => { if (!cancelled) setVersions(data.versions || []); })
      .catch(() => { if (!cancelled) setVersions([]); });
    return () => { cancelled = true; };
  }, [project.id, selectedSceneId, selectedShotId, shots]);

  async function patchShot(shotId: string, patch: Partial<Shot>) {
    const shot = shots.find((s) => s.id === shotId);
    if (!shot) return;
    setBusyShotId(shotId);
    try {
      const response = await fetch(`/api/projects/${project.id}/scenes/${shot.scene_id}/shots/${shotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(`Patch failed: ${response.status}`);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save shot");
    } finally {
      setBusyShotId(null);
    }
  }

  async function addShot() {
    if (!selectedSceneId) return;
    const next = sceneShots.length > 0 ? Math.max(...sceneShots.map((s) => s.shot_number)) + 1 : 1;
    try {
      const response = await fetch(`/api/projects/${project.id}/scenes/${selectedSceneId}/shots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shot_number: next, description: "" }),
      });
      if (!response.ok) throw new Error(`Add shot failed: ${response.status}`);
      const created = await response.json();
      await onRefresh();
      onSelectShot(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add shot");
    }
  }

  async function generateImage(shot: Shot) {
    setBusyShotId(shot.id);
    try {
      const response = await fetch(`/api/projects/${project.id}/scenes/${shot.scene_id}/shots/${shot.id}/generate-image`, { method: "POST" });
      if (!response.ok) throw new Error(`Generate failed: ${response.status}`);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate image");
    } finally {
      setBusyShotId(null);
    }
  }

  async function animateShot(shot: Shot) {
    setBusyShotId(shot.id);
    try {
      const response = await fetch(`/api/projects/${project.id}/scenes/${shot.scene_id}/shots/${shot.id}/animate`, { method: "POST" });
      if (!response.ok) throw new Error(`Animate failed: ${response.status}`);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to animate");
    } finally {
      setBusyShotId(null);
    }
  }

  async function selectVersion(version: ShotVersion) {
    if (!selectedShot) return;
    try {
      const response = await fetch(`/api/projects/${project.id}/scenes/${selectedShot.scene_id}/shots/${selectedShot.id}/versions/${version.id}/select`, { method: "POST" });
      if (!response.ok) throw new Error(`Select version failed: ${response.status}`);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to select version");
    }
  }

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-gray-800/60 bg-gray-950/60 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-800 bg-gray-900/50 hover:bg-gray-900 hover:border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition flex-shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> All projects
          </button>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-rose-400/70">Project</p>
            <h1 className="text-base font-semibold tracking-tight text-gray-100 truncate">{project.title}</h1>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] flex-shrink-0">
          <PhaseChip phase={phase} />
          <span className="rounded-full border border-gray-800 bg-gray-900/50 px-2.5 py-1 text-gray-500 font-mono">{project.aspect_ratio}</span>
          {project.duration_seconds !== null && (
            <span className="rounded-full border border-gray-800 bg-gray-900/50 px-2.5 py-1 text-gray-500">{project.duration_seconds}s</span>
          )}
          <span className="rounded-full border border-gray-800 bg-gray-900/50 px-2.5 py-1 text-gray-500 uppercase tracking-wider">{project.status}</span>
        </div>
      </div>

      {/* Main split: center | right context editor */}
      <div className="flex-1 min-h-0 flex">
        {/* Center: shots in current scene */}
        <main className="flex-1 min-w-0 flex flex-col bg-gradient-to-b from-transparent via-transparent to-gray-950/30">
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto p-6 space-y-4">
              {selectedScene ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-rose-400/70">Scene {selectedScene.scene_number}</p>
                      <h2 className="text-2xl font-bold tracking-tight mt-1">{selectedScene.heading || "Untitled scene"}</h2>
                      {selectedScene.summary && (
                        <p className="text-sm text-gray-400 mt-2 max-w-2xl leading-relaxed">{selectedScene.summary}</p>
                      )}
                    </div>
                    <button
                      onClick={addShot}
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-600/10 hover:bg-rose-600/20 hover:border-rose-400/50 px-3 py-1.5 text-xs font-medium text-rose-100 transition flex-shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add shot
                    </button>
                  </div>

                  {sceneShots.length === 0 ? (
                    <div className="rounded-2xl border border-gray-800/60 bg-gray-900/30 p-12 text-center">
                      <Film className="w-7 h-7 text-gray-600 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No shots in this scene yet.</p>
                      <p className="text-xs text-gray-600 mt-1.5">Add shots and write image prompts before generating.</p>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {sceneShots.map((shot) => (
                        <ShotCard
                          key={shot.id}
                          shot={shot}
                          phase={phase}
                          selected={shot.id === selectedShotId}
                          busy={busyShotId === shot.id}
                          onSelect={() => onSelectShot(shot.id)}
                          onGenerateImage={() => generateImage(shot)}
                          onAnimate={() => animateShot(shot)}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <OutlineCenter project={project} />
              )}
            </div>
          </div>

          {/* Bottom: shot version strip */}
          <div className="border-t border-gray-800/60 bg-gray-950/60 flex-shrink-0">
            <div className="px-4 py-2 flex items-center gap-3 overflow-x-auto">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium flex-shrink-0">
                {selectedShot ? `S${selectedScene?.scene_number}·shot ${selectedShot.shot_number} versions` : "Versions"}
              </span>
              {!selectedShot && (
                <span className="text-[11px] text-gray-600">Select a shot to see its generated versions.</span>
              )}
              {selectedShot && versions.length === 0 && (
                <span className="text-[11px] text-gray-600">No versions yet. Generate to create one.</span>
              )}
              {versions.map((version) => {
                const url = mediaUrl(version.file);
                const isCurrent = selectedShot?.image_file === version.file || selectedShot?.video_file === version.file;
                return (
                  <button
                    key={version.id}
                    onClick={() => selectVersion(version)}
                    title={`v${version.version_number} · ${version.kind} · ${version.status}`}
                    className={`flex-shrink-0 relative rounded-lg overflow-hidden border transition ${isCurrent ? "border-rose-500/60 ring-1 ring-rose-500/40" : "border-gray-800 hover:border-gray-600"}`}
                  >
                    {url ? (
                      version.kind === "video" ? (
                        <video src={url} className="h-14 w-24 object-cover bg-black" muted />
                      ) : (
                        <img src={url} alt="" className="h-14 w-24 object-cover bg-black" />
                      )
                    ) : (
                      <div className="h-14 w-24 flex items-center justify-center bg-gray-900 text-[10px] text-gray-600">{version.status}</div>
                    )}
                    <span className={`absolute bottom-0.5 left-0.5 rounded px-1 text-[9px] font-mono ${isCurrent ? "bg-rose-600 text-white" : "bg-black/70 text-gray-300"}`}>v{version.version_number}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </main>

        {/* Right: context-aware editor — styled to match AppSidebar */}
        <aside className="w-[340px] flex-shrink-0 border-l border-gray-800/60 bg-gray-950/40 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/40 flex-shrink-0">
            <span className="text-sm font-semibold text-gray-300 tracking-tight">
              {selectedShot ? `Shot ${selectedShot.shot_number}` : selectedScene ? `Scene ${selectedScene.scene_number}` : "Project"}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-600">{phase}</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {selectedShot ? (
              <ShotEditor
                shot={selectedShot}
                phase={phase}
                saving={busyShotId === selectedShot.id}
                onPatch={(patch) => patchShot(selectedShot.id, patch)}
                onGenerate={() => generateImage(selectedShot)}
                onAnimate={() => animateShot(selectedShot)}
              />
            ) : selectedScene ? (
              <SceneSummary scene={selectedScene} />
            ) : (
              <ProjectSummary project={project} />
            )}
          </div>
        </aside>
      </div>

      {error && (
        <div className="absolute top-16 right-4 rounded-xl border border-red-500/30 bg-red-950/40 backdrop-blur px-3 py-2 text-xs text-red-300 max-w-sm cursor-pointer" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}

function PhaseChip({ phase }: { phase: ProjectPhase }) {
  if (phase === "outline") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-700 bg-gray-900/60 px-2.5 py-1 text-gray-300">
        <Edit3 className="w-3 h-3" /> Outline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-600/15 px-2.5 py-1 text-violet-200">
      <Sparkles className="w-3 h-3" /> Remix
    </span>
  );
}

function OutlineCenter({ project }: { project: Project }) {
  return (
    <div className="rounded-2xl border border-gray-800/60 bg-gray-900/30 p-12 text-center max-w-2xl mx-auto">
      <Layers className="w-9 h-9 text-gray-600 mx-auto mb-3" />
      <p className="text-base text-gray-300 font-medium">Outline phase</p>
      <p className="text-sm text-gray-500 mt-2 leading-relaxed max-w-md mx-auto">
        No scenes in <span className="text-gray-300">{project.title}</span> yet. Pitch your idea to your agent and it'll draft the structure here, or add the first scene yourself.
      </p>
    </div>
  );
}

interface ShotCardProps {
  shot: Shot;
  phase: ProjectPhase;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onGenerateImage: () => void;
  onAnimate: () => void;
}

function ShotCard({ shot, phase, selected, busy, onSelect, onGenerateImage, onAnimate }: ShotCardProps) {
  const imageUrl = mediaUrl(shot.image_file);
  const videoUrl = mediaUrl(shot.video_file);
  return (
    <div
      onClick={onSelect}
      className={`rounded-xl border bg-gray-900/30 overflow-hidden cursor-pointer transition ${selected ? "border-rose-500/50 ring-1 ring-rose-500/30" : "border-gray-800/60 hover:border-gray-700"}`}
    >
      <div className="aspect-video bg-black flex items-center justify-center relative">
        {videoUrl ? (
          <video src={videoUrl} className="w-full h-full object-cover" muted loop autoPlay />
        ) : imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center text-gray-600">
            <ImageIcon className="w-6 h-6 mx-auto mb-1 opacity-50" />
            <p className="text-[10px] uppercase tracking-wider">No image</p>
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-mono text-gray-200">
          shot {shot.shot_number}
        </span>
        {videoUrl && (
          <span className="absolute top-1.5 right-1.5 rounded-md bg-violet-600/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white inline-flex items-center gap-1">
            <Video className="w-2.5 h-2.5" /> video
          </span>
        )}
      </div>
      <div className="p-2.5 space-y-1.5">
        <p className="text-[11px] text-gray-300 leading-relaxed line-clamp-2 min-h-[2.4em]">
          {shot.description || <span className="italic text-gray-600">no description</span>}
        </p>
        <div className="flex items-center gap-1.5 pt-1 border-t border-gray-800/40">
          {phase === "outline" || !imageUrl ? (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerateImage(); }}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-600/10 hover:bg-rose-600/20 disabled:opacity-50 disabled:cursor-wait px-2 py-1 text-[11px] text-rose-100 transition"
            >
              <Wand2 className="w-3 h-3" /> {busy ? "Generating…" : imageUrl ? "Regenerate" : "Generate"}
            </button>
          ) : (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onGenerateImage(); }}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900/60 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-wait px-2 py-1 text-[11px] text-gray-300 transition"
              >
                <Wand2 className="w-3 h-3" /> Re-image
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onAnimate(); }}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-600/15 hover:bg-violet-600/25 disabled:opacity-50 disabled:cursor-wait px-2 py-1 text-[11px] text-violet-100 transition"
              >
                <Play className="w-3 h-3" /> {busy ? "…" : "Animate"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ShotEditorProps {
  shot: Shot;
  phase: ProjectPhase;
  saving: boolean;
  onPatch: (patch: Partial<Shot>) => void;
  onGenerate: () => void;
  onAnimate: () => void;
}

function ShotEditor({ shot, phase, saving, onPatch, onGenerate, onAnimate }: ShotEditorProps) {
  const [draft, setDraft] = useState({
    description: shot.description || "",
    image_prompt: shot.image_prompt || "",
    motion_prompt: shot.motion_prompt || "",
  });

  useEffect(() => {
    setDraft({
      description: shot.description || "",
      image_prompt: shot.image_prompt || "",
      motion_prompt: shot.motion_prompt || "",
    });
  }, [shot.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    draft.description !== (shot.description || "") ||
    draft.image_prompt !== (shot.image_prompt || "") ||
    draft.motion_prompt !== (shot.motion_prompt || "");

  return (
    <div className="space-y-4">
      <Field label="Description" hint="What's in the frame, plain English.">
        <textarea
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          rows={3}
          className="w-full rounded-lg bg-black/40 border border-gray-800 px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-rose-500/50 placeholder:text-gray-700 leading-relaxed"
          placeholder="Wide shot of the workshop, neon glow on the floor."
        />
      </Field>

      <Field label="Image prompt" hint="Sent to image generation. Trigger words, lighting, lens, mood.">
        <textarea
          value={draft.image_prompt}
          onChange={(e) => setDraft((d) => ({ ...d, image_prompt: e.target.value }))}
          rows={4}
          className="w-full rounded-lg bg-black/40 border border-gray-800 px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-rose-500/50 placeholder:text-gray-700 leading-relaxed font-mono"
          placeholder="mycharacter, workshop interior, neon underglow, cinematic anamorphic lens, moody lighting"
        />
      </Field>

      <Field label="Motion prompt" hint="Camera move + motion for the animate step.">
        <textarea
          value={draft.motion_prompt}
          onChange={(e) => setDraft((d) => ({ ...d, motion_prompt: e.target.value }))}
          rows={3}
          className="w-full rounded-lg bg-black/40 border border-gray-800 px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-rose-500/50 placeholder:text-gray-700 leading-relaxed font-mono"
          placeholder="Slow push in, suit plates locking into place."
        />
      </Field>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500">
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
          <p className="text-gray-600 text-[10px] uppercase tracking-wider">Status</p>
          <p className="text-gray-300 mt-0.5">{shot.status}</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
          <p className="text-gray-600 text-[10px] uppercase tracking-wider">Duration</p>
          <p className="text-gray-300 mt-0.5">{shot.duration_seconds}s</p>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-gray-800/40">
        <button
          onClick={() => onPatch(draft)}
          disabled={!dirty || saving}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-700 bg-gray-900/60 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-xs font-medium text-gray-200 transition"
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        {phase === "outline" || !shot.image_file ? (
          <button
            onClick={onGenerate}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-600/15 hover:bg-rose-600/25 disabled:opacity-50 disabled:cursor-wait px-3 py-2 text-xs font-medium text-rose-100 transition"
          >
            <Wand2 className="w-3.5 h-3.5" /> {saving ? "Generating…" : shot.image_file ? "Regenerate image" : "Generate image"}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onGenerate}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-700 bg-gray-900/60 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-wait px-3 py-2 text-xs font-medium text-gray-200 transition"
            >
              <Wand2 className="w-3.5 h-3.5" /> Re-image
            </button>
            <button
              onClick={onAnimate}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-500/40 bg-violet-600/15 hover:bg-violet-600/25 disabled:opacity-50 disabled:cursor-wait px-3 py-2 text-xs font-medium text-violet-100 transition"
            >
              <Play className="w-3.5 h-3.5" /> {saving ? "…" : "Animate"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-[11px] font-medium text-gray-300">{label}</p>
        {hint && <p className="text-[10px] text-gray-600 leading-relaxed">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function ProjectSummary({ project }: { project: Project }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-medium text-gray-300">Title</p>
        <p className="text-sm text-gray-100 mt-0.5">{project.title}</p>
      </div>
      <div>
        <p className="text-[11px] font-medium text-gray-300">Description</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{project.description || <span className="italic text-gray-600">no description</span>}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
          <p className="text-gray-600 text-[10px] uppercase tracking-wider">Aspect</p>
          <p className="text-gray-300 mt-0.5 font-mono">{project.aspect_ratio}</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
          <p className="text-gray-600 text-[10px] uppercase tracking-wider">Duration</p>
          <p className="text-gray-300 mt-0.5">{project.duration_seconds ?? "—"}s</p>
        </div>
      </div>
      {project.characters.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-gray-300 mb-1">Cast</p>
          <div className="flex flex-wrap gap-1">
            {project.characters.map((id) => (
              <span key={id} className="inline-flex rounded-md border border-gray-800 bg-gray-900/40 px-2 py-0.5 text-[11px] text-gray-300 font-mono">{id}</span>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-gray-600 leading-relaxed pt-2 border-t border-gray-800/40">
        Pick a scene from the Projects tab to start editing shots, or ask your agent to draft an outline.
      </p>
    </div>
  );
}

function SceneSummary({ scene }: { scene: Scene }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-medium text-gray-300">Heading</p>
        <p className="text-sm text-gray-100 mt-0.5">{scene.heading || "Untitled scene"}</p>
      </div>
      <div>
        <p className="text-[11px] font-medium text-gray-300">Summary</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{scene.summary || <span className="italic text-gray-600">no summary</span>}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
          <p className="text-gray-600 text-[10px] uppercase tracking-wider">Location</p>
          <p className="text-gray-300 mt-0.5">{scene.location || "—"}</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
          <p className="text-gray-600 text-[10px] uppercase tracking-wider">Time</p>
          <p className="text-gray-300 mt-0.5">{scene.time_of_day || "—"}</p>
        </div>
      </div>
      <p className="text-[11px] text-gray-600 leading-relaxed pt-2 border-t border-gray-800/40">
        Pick a shot in the center to edit its prompts.
      </p>
    </div>
  );
}
