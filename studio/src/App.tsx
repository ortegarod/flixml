import { useState, useEffect, useCallback } from "react";
import { Menu, Sparkles, UserCircle } from "lucide-react";
import { StudioView } from "./components/GalleryView";
import { CharacterProfileView } from "./components/CharacterProfileView";
import { ProjectsView } from "./components/ProjectsView";
import { ProjectDetailView } from "./components/ProjectDetailView";
import { AppSidebar } from "./components/sidebar/AppSidebar";
import type { SidebarTab } from "./components/sidebar/AppSidebar";
import type { JobItem, LoraCheckpoint, LoraTrainingStatus, MediaItem, Project, Scene, Shot, ProjectPhase } from "./types";

async function fetchJson<T>(url: string, timeoutMs = 5000): Promise<T> {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(id);
  }
}

export default function App() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [training, setTraining] = useState<LoraTrainingStatus | null>(null);
  const [checkpoints, setCheckpoints] = useState<LoraCheckpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>("generate");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<"studio" | "character" | "projects" | "project-detail">("studio");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectData, setProjectData] = useState<{ project: Project; scenes: Scene[]; shots: Shot[] } | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    if (!selectedProjectId) { setProjectData(null); return; }
    try {
      const response = await fetch(`/api/projects/${selectedProjectId}`);
      if (!response.ok) throw new Error(`Project fetch failed: ${response.status}`);
      const data = await response.json();
      const scenes: Scene[] = (data.scenes || []).slice().sort((a: Scene, b: Scene) => a.scene_number - b.scene_number);
      const shots: Shot[] = (data.shots || []).slice().sort((a: Shot, b: Shot) => a.shot_number - b.shot_number);
      setProjectData({ project: data.project, scenes, shots });
      setSelectedSceneId((current) => {
        if (current && scenes.some((scene) => scene.id === current)) return current;
        return scenes.length > 0 ? scenes[0].id : null;
      });
    } catch (e) {
      console.error("Failed to load project", e);
    }
  }, [selectedProjectId]);

  useEffect(() => { loadProject(); }, [loadProject]);

  const phase: ProjectPhase = projectData?.shots.some((shot) => shot.image_file) ? "remix" : "outline";

  const addScene = useCallback(async () => {
    if (!selectedProjectId || !projectData) return;
    const next = projectData.scenes.length > 0 ? Math.max(...projectData.scenes.map((scene) => scene.scene_number)) + 1 : 1;
    try {
      const response = await fetch(`/api/projects/${selectedProjectId}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene_number: next, heading: `SCENE ${next}` }),
      });
      if (!response.ok) throw new Error(`Add scene failed: ${response.status}`);
      const created = await response.json();
      await loadProject();
      setSelectedSceneId(created.id);
      setSelectedShotId(null);
    } catch (e) {
      console.error("Failed to add scene", e);
    }
  }, [selectedProjectId, projectData, loadProject]);

  const load = useCallback(async () => {
    if (!hasLoadedOnce) setLoading(true);

    try {
      setError(null);
      const listing = await fetchJson<{ images?: MediaItem[] }>("/api/listing", 8000);
      setItems(listing.images || []);
      setHasLoadedOnce(true);
    } catch (e) {
      console.error("Failed to load gallery", e);
      setError(e instanceof Error ? e.message : "Failed to load gallery");
    } finally {
      setLoading(false);
    }

    const [jobsResult, trainingResult, checkpointsResult] = await Promise.allSettled([
      fetchJson<{ jobs?: JobItem[] }>("/api/jobs", 3500),
      fetchJson<LoraTrainingStatus & { ok?: boolean }>("/api/lora-training/status", 3500),
      fetchJson<{ checkpoints?: LoraCheckpoint[] }>("/api/lora-training/checkpoints", 3500),
    ]);

    if (jobsResult.status === "fulfilled") setJobs(jobsResult.value.jobs || []);
    if (trainingResult.status === "fulfilled") setTraining(trainingResult.value.ok ? trainingResult.value : null);
    if (checkpointsResult.status === "fulfilled") setCheckpoints(checkpointsResult.value.checkpoints || []);
  }, [hasLoadedOnce]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const deleteItem = useCallback(async (item: MediaItem) => {
    const filename = item.filename || item.url.replace(/^\/media\//, "");
    const response = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [filename] }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.detail || `Failed to delete ${filename}`);
    }
    setItems((current) => current.filter((candidate) => (candidate.filename || candidate.url) !== (item.filename || item.url)));
    if (selected === item.url) setSelected(null);
  }, [selected]);

  const hasContent = jobs.length > 0 || items.length > 0;
  const videoCount = items.filter((item) => item.type === "video" || item.url.endsWith(".mp4") || item.url.endsWith(".webm")).length;
  const imageCount = items.length - videoCount;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="h-14 border-b border-gray-800/60 bg-black/90 backdrop-blur-xl flex items-center justify-between px-5 sticky top-0 z-40">
        <div className="flex items-center gap-3 min-w-0">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-9 h-9 rounded-xl border border-gray-800 text-gray-500 hover:text-gray-200 hover:border-gray-600 transition"
              title="Open tools"
            >
              <Menu className="w-4 h-4 mx-auto" />
            </button>
          )}
          <button
            onClick={() => { setMainView("studio"); }}
            className="flex items-center gap-3 min-w-0 hover:opacity-80 transition"
            title="Home"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 via-fuchsia-500 to-amber-400 flex items-center justify-center shadow-lg shadow-rose-500/20 ring-1 ring-white/10">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="text-sm font-bold tracking-tight">Nemoflix Studio</h1>
              <p className="text-[10px] text-rose-400/60 tracking-wide">AMD MI300X</p>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <div className="hidden md:flex items-center gap-1.5">
            {jobs.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-800/40 bg-amber-950/30 px-2.5 py-1 text-amber-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {jobs.length} generating
              </span>
            )}
            <span className="rounded-full border border-gray-800 bg-gray-900/50 px-2.5 py-1 text-gray-500">
              {items.length} media
            </span>
            <span className="hidden lg:inline rounded-full border border-gray-800 bg-gray-900/50 px-2.5 py-1 text-gray-500">
              {imageCount} images
            </span>
            <span className="hidden lg:inline rounded-full border border-gray-800 bg-gray-900/50 px-2.5 py-1 text-gray-500">
              {videoCount} videos
            </span>
          </div>

          <div className="group relative">
            <button className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/20 px-2.5 py-1.5 text-rose-100 hover:border-rose-400/50 transition">
              <UserCircle className="w-4 h-4" />
              <span className="hidden sm:inline font-medium">Demo Account</span>
              <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">Hackathon</span>
            </button>
            <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-gray-800 bg-gray-950/95 p-4 shadow-2xl shadow-black/60 opacity-0 translate-y-1 transition group-hover:opacity-100 group-hover:translate-y-0">
              <p className="text-xs font-semibold text-gray-200">Demo workspace</p>
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                This hackathon build uses a sample owner dataset to demonstrate character LoRA training, generation, and media management. Authentication is intentionally mocked for the demo.
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {sidebarOpen && (
          <AppSidebar
            activeTab={activeSidebarTab}
            onTabChange={setActiveSidebarTab}
            onClose={() => setSidebarOpen(false)}
            checkpoints={checkpoints}
            onQueued={load}
            onSelectCharacter={(id) => { setSelectedCharacterId(id); setMainView("character"); }}
            projectMode={mainView === "project-detail" && projectData ? {
              project: projectData.project,
              scenes: projectData.scenes,
              shots: projectData.shots,
              selectedSceneId,
              selectedShotId,
              phase,
              onSelectScene: (id) => { setSelectedSceneId(id); setSelectedShotId(null); },
              onSelectShot: setSelectedShotId,
              onBack: () => { setSelectedShotId(null); setMainView("projects"); },
              onRefresh: loadProject,
              onAddScene: addScene,
            } : undefined}
          />
        )}

        <main className="flex-1 min-w-0 overflow-y-auto bg-gradient-to-b from-transparent via-transparent to-gray-950/30">
          {mainView === "character" && selectedCharacterId && (
            <CharacterProfileView
              characterId={selectedCharacterId}
              items={items}
              onOpen={setSelected}
              onDelete={deleteItem}
              onGenerate={() => setActiveSidebarTab("generate")}
            />
          )}

          {mainView === "projects" && (
            <ProjectsView
              onOpenProject={(id) => { setSelectedProjectId(id); setMainView("project-detail"); setActiveSidebarTab("projects"); setSidebarOpen(true); }}
            />
          )}
          {mainView === "project-detail" && projectData && (
            <ProjectDetailView
              project={projectData.project}
              scenes={projectData.scenes}
              shots={projectData.shots}
              phase={phase}
              selectedSceneId={selectedSceneId}
              selectedShotId={selectedShotId}
              onSelectScene={(id) => { setSelectedSceneId(id); setSelectedShotId(null); }}
              onSelectShot={setSelectedShotId}
              onRefresh={loadProject}
              onBack={() => { setSelectedShotId(null); setMainView("projects"); }}
            />
          )}
          {mainView === "studio" && (
            <StudioView
              items={items}
              jobs={jobs}
              loading={loading && !hasLoadedOnce && !hasContent}
              error={error}
              onOpen={setSelected}
              onDelete={deleteItem}
              onOpenProjects={() => setMainView("projects")}
            />
          )}
        </main>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div className="max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
            {selected.endsWith(".mp4") || selected.endsWith(".webm") ? (
              <video src={selected} controls autoPlay className="max-w-full max-h-[90vh] rounded" />
            ) : (
              <img src={selected} alt="" className="max-w-full max-h-[90vh] rounded" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
