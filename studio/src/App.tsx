import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { QueryClient, QueryClientProvider, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useMatch, useNavigate, useParams } from "react-router-dom";
import { ArrowUp, BookOpen, Code2, LogOut, Menu, Settings, ShieldCheck, Sparkles, UserCircle, Users } from "lucide-react";
import { StudioView } from "./components/GalleryView";
import { CharacterProfileView } from "./components/CharacterProfileView";
import { AgentProfileView } from "./components/AgentProfileView";
import { AccountsView } from "./components/AccountsView";
import { AccountAvatar } from "./components/AccountAvatar";
import { ProjectsView } from "./components/ProjectsView";
import { LoraTrainingPage } from "./components/LoraTrainingPage";
import { ProjectDetailView } from "./components/ProjectDetailView";
import { ProjectFilmsView } from "./components/ProjectFilmsView";
import { Lightbox } from "./components/Lightbox";
import { SignInGate } from "./components/SignInGate";
import { ApiKeysPage } from "./components/ApiKeysPage";
import { JobsPage } from "./components/JobsPage";
import { AccountSettings, SettingsPage, signOut, useSession } from "./components/SettingsPage";

import { AppSidebar } from "./components/sidebar/AppSidebar";
import type { SidebarTab } from "./components/sidebar/AppSidebar";
import type { CharacterSummary, JobItem, LoraCheckpoint, LoraTrainingStatus, MediaItem, MediaMetadataPatch, Project, Scene, Shot, ProjectPhase, ProjectModeData } from "./types";

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      retry: 1,
      // React Query pauses every refetchInterval while the tab is hidden, so a render
      // that finishes while the user is in another window lands on disk and in /api/listing
      // but never reaches the open Studio tab. Refetching on focus is what closes that gap:
      // without it the tab also waits out the rest of the 5s tick after the user returns.
      // Background polling stays off — a hidden tab has no one to show the result to.
      refetchOnWindowFocus: true,
    },
  },
});

const listingKeyBase = ["listing"] as const;
const countsKey = ["listing-counts"] as const;
const jobsKey = ["jobs"] as const;
const charactersKey = ["characters"] as const;
const LISTING_PAGE_SIZE = 60;

export type GalleryFilter = "all" | "images" | "videos";

interface ListingPage {
  images: MediaItem[];
  total: number;
  offset: number;
  limit: number;
}

interface ListingCounts {
  total: number;
  images: number;
  videos: number;
}

/* ── App Context ── */
interface AppContextType {
  items: MediaItem[];
  jobs: JobItem[];
  loading: boolean;
  hasLoadedOnce: boolean;
  error: string | null;
  selected: string | null;
  setSelected: (url: string | null) => void;
  // A page whose list isn't the gallery's — an account's files, say — lends the
  // lightbox its own items while it's open, so the rail reads the asset it was
  // actually given instead of failing to find it in the gallery's first page.
  lightboxItems: MediaItem[] | null;
  setLightboxItems: (items: MediaItem[] | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  activeSidebarTab: SidebarTab;
  setActiveSidebarTab: (tab: SidebarTab) => void;
  training: LoraTrainingStatus | null;
  checkpoints: LoraCheckpoint[];
  trainingJobs: any[];
  deleteItem: (item: MediaItem) => Promise<void>;
  load: () => Promise<void>;
  projectData: { project: Project; scenes: Scene[]; shots: Shot[] } | null;
  selectedSceneId: string | null;
  selectedShotId: string | null;
  setSelectedSceneId: (id: string | null) => void;
  setSelectedShotId: (id: string | null) => void;
  loadProject: (id: string) => Promise<void>;
  addScene: () => Promise<void>;
  deleteScene: (sceneId: string) => Promise<void>;
  deleteShot: (shotId: string) => Promise<void>;
  // Gallery pagination + filters
  galleryFilter: GalleryFilter;
  setGalleryFilter: (filter: GalleryFilter) => void;
  gallerySearch: string;
  setGallerySearch: (search: string) => void;
  filteredTotal: number;
  fetchNextGalleryPage: () => void;
  hasNextGalleryPage: boolean;
  isFetchingNextGalleryPage: boolean;
  counts: ListingCounts;
  characters: CharacterSummary[];
  galleryCharacter: string;
  setGalleryCharacter: (characterId: string) => void;
  galleryTag: string;
  setGalleryTag: (tag: string) => void;
  galleryTrainingDatasetOnly: boolean;
  setGalleryTrainingDatasetOnly: (enabled: boolean) => void;
  updateMediaMetadata: (item: MediaItem, patch: MediaMetadataPatch) => Promise<void>;
  bulkDeleteItems: (items: MediaItem[]) => Promise<void>;
  bulkUpdateMediaMetadata: (items: MediaItem[], patcher: (item: MediaItem) => MediaMetadataPatch) => Promise<void>;
}

const AppContext = createContext<AppContextType>(null!);
export function useApp() {
  return useContext(AppContext);
}

/* ── Account menu: who is signed in, plus Settings and sign-out ── */
function AccountMenu() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const agent = session?.agent;
  const close = () => document.getElementById("account-menu")?.hidePopover();
  const itemClass =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-800/80 hover:text-white focus-visible:bg-gray-800/80 focus-visible:outline-none";

  return (
    <>
      <button
        type="button"
        popoverTarget="account-menu"
        id="account-menu-button"
        title={agent ? `${agent.name} · account menu` : "Account menu"}
        className="flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-900/50 py-1 pl-1 pr-2.5 text-gray-200 hover:border-gray-600 transition"
      >
        {agent ? (
          <AccountAvatar avatar={agent.avatar} name={agent.name} className="h-7 w-7 rounded-lg ring-1 ring-black/40" />
        ) : (
          <UserCircle className="ml-1 h-5 w-5" aria-hidden />
        )}
        <span className="hidden sm:inline font-medium">{agent?.name ?? "Account"}</span>
      </button>
      <div
        id="account-menu"
        popover="auto"
        // Pin under the button when it opens; the top layer ignores the header's layout.
        onBeforeToggle={(event) => {
          const rect = document.getElementById("account-menu-button")?.getBoundingClientRect();
          if (event.newState !== "open" || !rect) return;
          event.currentTarget.style.top = `${rect.bottom + 8}px`;
          event.currentTarget.style.right = `${window.innerWidth - rect.right}px`;
        }}
        className="fixed m-0 w-60 [inset:auto] rounded-2xl border border-gray-800 bg-gray-950 p-1.5 text-white shadow-2xl shadow-black/60"
      >
        {agent && (
          <div className="mb-1 flex items-center gap-2.5 border-b border-gray-800/60 px-3 py-2">
            <AccountAvatar avatar={agent.avatar} name={agent.name} className="h-9 w-9 rounded-xl ring-1 ring-black/40" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-100">{agent.name}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                {agent.is_admin && <ShieldCheck className="h-3 w-3 shrink-0 text-amber-300" aria-hidden />}
                {agent.is_admin ? "Admin" : "Scoped key"} · <span className="truncate font-mono">{agent.id}</span>
              </p>
            </div>
          </div>
        )}
        {agent && (
          <button type="button" className={itemClass} onClick={() => { close(); navigate(`/studio/agents/${agent.id}`); }}>
            <UserCircle className="h-4 w-4" aria-hidden /> Your profile
          </button>
        )}
        {/* Only an admin key can read the directory; a scoped one would land on a 404 wall. */}
        {(!agent || agent.is_admin) && (
          <button type="button" className={itemClass} onClick={() => { close(); navigate("/studio/agents"); }}>
            <Users className="h-4 w-4" aria-hidden /> Accounts
          </button>
        )}
        <button type="button" className={itemClass} onClick={() => { close(); navigate("/studio/settings/account"); }}>
          <Settings className="h-4 w-4" aria-hidden /> Settings
        </button>
        <a className={itemClass} href="https://flixml.com/docs" target="_blank" rel="noreferrer" onClick={close}>
          <BookOpen className="h-4 w-4" aria-hidden /> Docs
        </a>
        {/* AGPL-3.0 §13: a network-served copy has to offer its users the source. */}
        <a className={itemClass} href="https://github.com/ortegarod/flixml" target="_blank" rel="noreferrer" onClick={close}>
          <Code2 className="h-4 w-4" aria-hidden /> Source code
        </a>
        {agent && (
          <button type="button" className={itemClass} onClick={signOut}>
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        )}
      </div>
    </>
  );
}

/* ── Layout Shell: header + sidebar + <Outlet /> ── */
function Shell() {
  const ctx = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const projectMatch = useMatch("/studio/projects/:projectId");
  const loraMatch = useMatch("/studio/lora-training");
  const settingsMatch = useMatch("/studio/settings/*");
  const jobsMatch = useMatch("/studio/jobs");

  // Load project when entering a project-detail route
  const lastProjectId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const pid = projectMatch?.params.projectId;
    if (pid && pid !== lastProjectId.current) {
      lastProjectId.current = pid;
      ctx.loadProject(pid);
      ctx.setActiveSidebarTab("projects");
    }
  }, [projectMatch?.params.projectId]);

  // Keep "Characters & LoRA Training" sidebar tab highlighted when on /lora-training
  useEffect(() => {
    if (loraMatch) ctx.setActiveSidebarTab("characters");
  }, [loraMatch]);

  useEffect(() => {
    // Settings has its own section nav; however it was reached, drop the empty side panel
    if (settingsMatch) {
      ctx.setActiveSidebarTab("settings");
      ctx.setSidebarCollapsed(true);
    }
  }, [!!settingsMatch]);

  // Jobs is a full-width page too — same treatment when it's reached by URL
  useEffect(() => {
    if (jobsMatch) {
      ctx.setActiveSidebarTab("jobs");
      ctx.setSidebarCollapsed(true);
    }
  }, [!!jobsMatch]);

  // <main> is the only thing that scrolls, so every "go back up" gesture goes through this ref.
  // The infinite gallery gets thousands of tiles deep and the wheel is the only way out without it.
  const mainRef = useRef<HTMLElement>(null);
  const [scrolledDeep, setScrolledDeep] = useState(false);

  const scrollToTop = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    main.scrollTo({ top: 0, behavior: instant ? "auto" : "smooth" });
  }, []);

  // One viewport of scrolling is a glance; two is deep enough that the way back matters.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => setScrolledDeep(main.scrollTop > main.clientHeight * 1.5);
    main.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => main.removeEventListener("scroll", onScroll);
  }, []);

  // <main> outlives the route inside it, so without this a new page opens at the old page's offset
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Home/End move the page, not the focused control — skip while someone is typing
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Home" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      event.preventDefault();
      scrollToTop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scrollToTop]);

  const projectMode: ProjectModeData | undefined =
    projectMatch && ctx.projectData
      ? {
          project: ctx.projectData.project,
          scenes: ctx.projectData.scenes,
          shots: ctx.projectData.shots,
          selectedSceneId: ctx.selectedSceneId,
          selectedShotId: ctx.selectedShotId,
          phase: "outline",
          onSelectScene: (id) => {
            ctx.setSelectedSceneId(id);
            ctx.setSelectedShotId(null);
          },
          onSelectShot: ctx.setSelectedShotId,
          onBack: () => {
            ctx.setSelectedShotId(null);
            navigate("/studio/projects");
          },
          onRefresh: () => {
            const pid = projectMatch?.params.projectId;
            return pid ? ctx.loadProject(pid) : Promise.resolve();
          },
          onAddScene: ctx.addScene,
          onDeleteScene: ctx.deleteScene,
          onDeleteShot: ctx.deleteShot,
        }
      : undefined;

  return (
    <div className="h-screen overflow-hidden bg-black text-white flex flex-col">
      <header className="h-14 flex-shrink-0 border-b border-gray-800/60 bg-black/90 backdrop-blur-xl flex items-center justify-between px-5 z-40">
        <div className="flex items-center gap-3 min-w-0">
          {!ctx.sidebarOpen && (
            <button
              onClick={() => ctx.setSidebarOpen(true)}
              className="w-9 h-9 rounded-xl border border-gray-800 text-gray-500 hover:text-gray-200 hover:border-gray-600 transition"
              title="Open tools"
            >
              <Menu className="w-4 h-4 mx-auto" />
            </button>
          )}
          <button
            onClick={() => {
              navigate("/studio");
              ctx.setActiveSidebarTab("workflows");
              // Already on /studio? The route effect never fires, so take it to the top by hand.
              scrollToTop();
            }}
            className="flex items-center gap-3 min-w-0 hover:opacity-80 transition"
            title="Studio home — back to the top"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-brand-soft flex items-center justify-center shadow-lg shadow-brand/25 ring-1 ring-white/10">
              <Sparkles className="w-4 h-4 text-black" />
            </div>
            <div className="min-w-0 hidden sm:block">
              {/* The app's name, on every page. The <h1> belongs to the page itself. */}
              <p className="font-heading text-base font-bold tracking-tight leading-none">FlixML<span className="text-brand"> Studio</span></p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-0.5">Cinematic AI Studio</p>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <div className="hidden md:flex items-center gap-1.5">
            {(() => {
              const activeCount = ctx.jobs.filter((j) => j.status === "pending" || j.status === "running").length;
              return activeCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand bg-brand-faint px-2.5 py-1 text-brand font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
                  {activeCount} generating
                </span>
              ) : null;
            })()}
          </div>

          <AccountMenu />
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Mobile backdrop — tap to dismiss the overlay drawer (desktop shows sidebar inline, no backdrop) */}
        {ctx.sidebarOpen && (
          <div
            className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => ctx.setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        {ctx.sidebarOpen && (
          <AppSidebar
            activeTab={ctx.activeSidebarTab}
            collapsed={ctx.sidebarCollapsed}
            onTabChange={(tab) => {
              // These pages fill the pane themselves, so they take the full width instead of a side panel
              if (tab === "settings" || tab === "jobs") {
                ctx.setActiveSidebarTab(tab);
                ctx.setSidebarCollapsed(true);
                navigate(tab === "jobs" ? "/studio/jobs" : "/studio/settings");
                if (typeof window !== "undefined" && window.innerWidth < 768) ctx.setSidebarOpen(false);
                return;
              }
              // Clicking the already-active icon collapses the panel (VS Code style)
              if (tab === ctx.activeSidebarTab && !ctx.sidebarCollapsed) {
                ctx.setSidebarCollapsed(true);
                return;
              }
              ctx.setSidebarCollapsed(false);
              ctx.setActiveSidebarTab(tab);
              if (tab === "workflows") navigate("/studio");
              if (tab === "projects") navigate("/studio/projects");
              if (tab === "characters") navigate("/studio/lora-training");
              // On mobile the sidebar is an overlay — close it after picking a destination
              if (typeof window !== "undefined" && window.innerWidth < 768) {
                ctx.setSidebarOpen(false);
              }
            }}
            onToggleCollapsed={() => {
              const next = !ctx.sidebarCollapsed;
              // Settings and Jobs fill the pane themselves and have no side panel, so expanding
              // while one of them is active would open an empty 380px column. Come back on Workflows.
              if (!next && (ctx.activeSidebarTab === "settings" || ctx.activeSidebarTab === "jobs")) {
                ctx.setActiveSidebarTab("workflows");
              }
              ctx.setSidebarCollapsed(next);
            }}
            onClose={() => ctx.setSidebarOpen(false)}
            onSelectCharacter={(id) => {
              ctx.setActiveSidebarTab("characters");
              navigate(`/studio/characters/${id}`);
            }}
            projectMode={projectMode}
          />
        )}

        <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto bg-gradient-to-b from-transparent via-transparent to-gray-950/30">
          <Outlet />
        </main>

        {/* Sits over the scroll pane rather than inside it, so every page gets the way back */}
        <button
          type="button"
          onClick={scrollToTop}
          aria-hidden={!scrolledDeep}
          tabIndex={scrolledDeep ? 0 : -1}
          className={`absolute bottom-5 right-5 z-30 inline-flex items-center gap-1.5 rounded-full border border-gray-700 bg-gray-900/90 py-2.5 pl-3 pr-3.5 text-xs font-medium text-gray-200 shadow-xl shadow-black/50 backdrop-blur-xl transition-all hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
            scrolledDeep ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
          }`}
          title="Back to top (Home)"
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
          Top
        </button>
      </div>

      {/* Lightbox */}
      <Lightbox
        items={ctx.lightboxItems ?? ctx.items}
        selectedUrl={ctx.selected}
        onClose={() => ctx.setSelected(null)}
        onSelect={ctx.setSelected}
        onUpdateMetadata={ctx.updateMediaMetadata}
        onDelete={ctx.deleteItem}
        onOpenOwner={(ownerId) => {
          ctx.setSelected(null);
          navigate(`/studio/agents/${ownerId}`);
        }}
      />
    </div>
  );
}

/* ── Route wrappers that connect URL params to existing components ── */
function StudioRoute() {
  const ctx = useApp();
  const navigate = useNavigate();
  return (
    <StudioView
      items={ctx.items}
      jobs={ctx.jobs}
      loading={ctx.loading && !ctx.hasLoadedOnce && !(ctx.jobs.length > 0 || ctx.items.length > 0)}
      error={ctx.error}
      onOpen={ctx.setSelected}
      onDelete={ctx.deleteItem}
      onOpenProjects={() => navigate("/studio/projects")}
      filter={ctx.galleryFilter}
      onFilterChange={ctx.setGalleryFilter}
      query={ctx.gallerySearch}
      onQueryChange={ctx.setGallerySearch}
      filteredTotal={ctx.filteredTotal}
      counts={ctx.counts}
      fetchNextPage={ctx.fetchNextGalleryPage}
      hasNextPage={ctx.hasNextGalleryPage}
      isFetchingNextPage={ctx.isFetchingNextGalleryPage}
      characters={ctx.characters}
      characterFilter={ctx.galleryCharacter}
      onCharacterFilterChange={ctx.setGalleryCharacter}
      tagFilter={ctx.galleryTag}
      onTagFilterChange={ctx.setGalleryTag}
      trainingDatasetOnly={ctx.galleryTrainingDatasetOnly}
      onTrainingDatasetOnlyChange={ctx.setGalleryTrainingDatasetOnly}
      onBulkDelete={ctx.bulkDeleteItems}
      onBulkUpdateMetadata={ctx.bulkUpdateMediaMetadata}
      onImported={ctx.load}
    />
  );
}

function ProjectsRoute() {
  const navigate = useNavigate();
  return <ProjectsView onOpenProject={(id) => navigate(`/studio/projects/${id}`)} />;
}

function ProjectRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const ctx = useApp();

  useEffect(() => {
    if (projectId) ctx.loadProject(projectId);
  }, [projectId]);

  const navigate = useNavigate();

  if (!ctx.projectData) {
    return <div className="p-8 text-center text-gray-500">Loading project…</div>;
  }

  return (
    <ProjectDetailView
      project={ctx.projectData.project}
      scenes={ctx.projectData.scenes}
      shots={ctx.projectData.shots}
      jobs={ctx.jobs}
      selectedSceneId={ctx.selectedSceneId}
      selectedShotId={ctx.selectedShotId}
      onSelectScene={(id) => {
        ctx.setSelectedSceneId(id);
        ctx.setSelectedShotId(null);
      }}
      onSelectShot={ctx.setSelectedShotId}
      onRefresh={() => (projectId ? ctx.loadProject(projectId) : Promise.resolve())}
      onBack={() => {
        ctx.setSelectedShotId(null);
        navigate("/studio/projects");
      }}
      onDeleteScene={ctx.deleteScene}
      onDeleteShot={ctx.deleteShot}
    />
  );
}

function ProjectFilmsRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  if (!projectId) return null;
  return (
    <ProjectFilmsView
      projectId={projectId}
      onBack={() => navigate(`/studio/projects/${projectId}`)}
    />
  );
}

function CharacterRoute() {
  const { characterId } = useParams<{ characterId: string }>();
  const { setSelected, deleteItem, setActiveSidebarTab, setSidebarOpen } = useApp();
  const navigate = useNavigate();
  if (!characterId) return null;
  return (
    <CharacterProfileView
      characterId={characterId}
      onOpen={setSelected}
      onDelete={deleteItem}
      onGenerate={() => {
        setSidebarOpen(true);
        setActiveSidebarTab("workflows");
        navigate(`/studio?character=${characterId}`);
      }}
    />
  );
}

function AgentRoute() {
  const { agentId } = useParams<{ agentId: string }>();
  const { setSelected, deleteItem, setLightboxItems } = useApp();
  if (!agentId) return null;
  return (
    <AgentProfileView
      agentId={agentId}
      onOpen={setSelected}
      onDelete={deleteItem}
      onItemsChange={setLightboxItems}
    />
  );
}

/* ── App Root ── */
function AppRoutes() {
  const queryClient = useQueryClient();

  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>("all");
  const [gallerySearch, setGallerySearch] = useState("");
  const [galleryCharacter, setGalleryCharacter] = useState("");
  const [galleryTag, setGalleryTag] = useState("");
  const [galleryTrainingDatasetOnly, setGalleryTrainingDatasetOnly] = useState(false);

  const listingKey = useMemo(
    () => [...listingKeyBase, galleryFilter, gallerySearch, galleryCharacter, galleryTag, galleryTrainingDatasetOnly] as const,
    [galleryFilter, gallerySearch, galleryCharacter, galleryTag, galleryTrainingDatasetOnly]
  );

  const listingQuery = useInfiniteQuery({
    queryKey: listingKey,
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) => {
      const params = new URLSearchParams();
      params.set("offset", String(pageParam));
      params.set("limit", String(LISTING_PAGE_SIZE));
      if (galleryFilter === "images") params.set("type", "image");
      if (galleryFilter === "videos") params.set("type", "video");
      const trimmed = gallerySearch.trim();
      if (trimmed) params.set("q", trimmed);
      if (galleryCharacter) params.set("character_id", galleryCharacter);
      const trimmedTag = galleryTag.trim();
      if (trimmedTag) params.set("tag", trimmedTag);
      if (galleryTrainingDatasetOnly) params.set("training_dataset", "true");
      return fetchJson<ListingPage>(`/api/listing?${params.toString()}`, 8000);
    },
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.images.length;
      return next < lastPage.total && lastPage.images.length > 0 ? next : undefined;
    },
    refetchInterval: 5000,
  });

  const countsQuery = useQuery({
    queryKey: countsKey,
    queryFn: () => fetchJson<ListingCounts>("/api/listing/counts", 3500),
    refetchInterval: 10000,
  });

  const jobsQuery = useQuery({
    queryKey: jobsKey,
    // The jobs poll must outlast a busy GPU node: /api/jobs reconciles every job
    // against its node's /queue + /history, which crawls while that node is mid-render.
    // A short abort (3.5s) killed every poll during generation, so in-progress cards —
    // especially video, whose node stays saturated the whole time — never entered the
    // cache and never rendered. Give the poll room to complete against a busy node.
    queryFn: () => fetchJson<{ jobs?: JobItem[] }>("/api/jobs", 20000),
    refetchInterval: 5000,
  });

  const charactersQuery = useQuery({
    queryKey: charactersKey,
    queryFn: () => fetchJson<{ characters?: CharacterSummary[] }>("/api/characters", 3500),
    staleTime: 30_000,
  });

  const items = useMemo(
    () => (listingQuery.data?.pages ?? []).flatMap((page) => page.images),
    [listingQuery.data]
  );
  const filteredTotal = listingQuery.data?.pages?.[0]?.total ?? 0;
  const counts: ListingCounts = countsQuery.data ?? { total: 0, images: 0, videos: 0 };

  const jobs = jobsQuery.data?.jobs || [];
  const characters = charactersQuery.data?.characters || [];
  const loading = listingQuery.isLoading;
  const hasLoadedOnce = listingQuery.isFetched;
  const error = listingQuery.error instanceof Error ? listingQuery.error.message : null;
  const [training, setTraining] = useState<LoraTrainingStatus | null>(null);
  const [checkpoints, setCheckpoints] = useState<LoraCheckpoint[]>([]);
  const [trainingJobs, setTrainingJobs] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lightboxItems, setLightboxItems] = useState<MediaItem[] | null>(null);
  // Open by default on desktop, closed on mobile (the sidebar is an overlay drawer there)
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>("workflows");
  const [projectData, setProjectData] = useState<{
    project: Project;
    scenes: Scene[];
    shots: Shot[];
  } | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const load = useCallback(async () => {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: listingKeyBase }),
      queryClient.invalidateQueries({ queryKey: countsKey }),
      queryClient.invalidateQueries({ queryKey: jobsKey }),
    ]);

    const [trainingResult, checkpointsResult, trainingJobsResult] = await Promise.allSettled([
      fetchJson<LoraTrainingStatus & { ok?: boolean }>("/api/lora-training/status", 3500),
      fetchJson<{ checkpoints?: LoraCheckpoint[] }>("/api/lora-training/checkpoints", 3500),
      fetchJson<{ jobs?: any[] }>("/api/lora-training/jobs", 3500),
    ]);

    if (trainingResult.status === "fulfilled")
      setTraining(trainingResult.value.ok ? trainingResult.value : null);
    if (checkpointsResult.status === "fulfilled")
      setCheckpoints(checkpointsResult.value.checkpoints || []);
    if (trainingJobsResult.status === "fulfilled")
      setTrainingJobs(trainingJobsResult.value.jobs || []);
  }, [queryClient]);

  // Stable polling — uses refs to avoid dependency churn
  const loadRef = useRef(load);
  loadRef.current = load;

  // Job state arrives through the /api/jobs and /api/listing polls above, which the
  // server-side reconciler keeps current. There is no push channel to fall out of sync.
  useEffect(() => {
    loadRef.current();
  }, []);

  const loadProject = useCallback(async (id: string) => {
    setProjectId(id);
    try {
      const response = await fetch(`/api/projects/${id}`);
      if (!response.ok) throw new Error(`Project fetch failed: ${response.status}`);
      const data = await response.json();
      const scenes: Scene[] = (data.scenes || []).slice().sort(
        (a: Scene, b: Scene) => a.scene_number - b.scene_number
      );
      const shots: Shot[] = (data.shots || []).slice().sort(
        (a: Shot, b: Shot) => a.shot_number - b.shot_number
      );
      setProjectData({ project: data.project, scenes, shots });
      setSelectedSceneId((current) => {
        if (current && scenes.some((scene) => scene.id === current)) return current;
        return scenes.length > 0 ? scenes[0].id : null;
      });
    } catch (e) {
      console.error("Failed to load project", e);
    }
  }, []);

  const addScene = useCallback(async () => {
    if (!projectId || !projectData) return;
    const next =
      projectData.scenes.length > 0
        ? Math.max(...projectData.scenes.map((scene) => scene.scene_number)) + 1
        : 1;
    try {
      const response = await fetch(`/api/projects/${projectId}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene_number: next, heading: `SCENE ${next}` }),
      });
      if (!response.ok) throw new Error(`Add scene failed: ${response.status}`);
      const created = await response.json();
      await loadProject(projectId);
      setSelectedSceneId(created.id);
      setSelectedShotId(null);
    } catch (e) {
      console.error("Failed to add scene", e);
    }
  }, [projectId, projectData, loadProject]);

  const deleteScene = useCallback(async (sceneId: string) => {
    if (!projectId) return;
    if (!confirm("Delete this scene and all its shots?")) return;
    await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, { method: "DELETE" });
    if (selectedSceneId === sceneId) {
      setSelectedSceneId("");
      setSelectedShotId(null);
    }
    loadProject(projectId);
  }, [projectId, selectedSceneId, loadProject]);

  const deleteShot = useCallback(async (shotId: string) => {
    if (!projectId || !projectData) return;
    if (!confirm("Delete this shot?")) return;
    const shot = projectData.shots.find((s) => s.id === shotId);
    if (!shot) return;
    await fetch(`/api/projects/${projectId}/scenes/${shot.scene_id}/shots/${shotId}`, { method: "DELETE" });
    if (selectedShotId === shotId) setSelectedShotId(null);
    loadProject(projectId);
  }, [projectId, projectData, selectedShotId, loadProject]);

  const deleteMutation = useMutation({
    mutationFn: async (item: MediaItem) => {
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
      return { item, filename };
    },
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: listingKeyBase });
      const key = (it: MediaItem) => it.filename || it.url;
      const targetKey = key(item);

      // Optimistically drop the item from every page of every active listing query.
      const snapshots = queryClient.getQueriesData<{ pages: ListingPage[]; pageParams: unknown[] }>({ queryKey: listingKeyBase });
      for (const [qKey, data] of snapshots) {
        if (!data?.pages) continue;
        queryClient.setQueryData(qKey, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            images: page.images.filter((candidate) => key(candidate) !== targetKey),
            total: Math.max(0, page.total - 1),
          })),
        });
      }

      if (selected === item.url) setSelected(null);
      return { snapshots };
    },
    onError: (err, _item, context) => {
      if (context?.snapshots) {
        for (const [qKey, data] of context.snapshots) {
          queryClient.setQueryData(qKey, data);
        }
      }
      toast.error(err instanceof Error ? err.message : "Delete failed");
    },
    onSuccess: ({ filename }) => {
      toast.success(`Deleted ${filename}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listingKeyBase });
      queryClient.invalidateQueries({ queryKey: countsKey });
    },
  });

  const deleteItem = useCallback(
    async (item: MediaItem) => {
      await deleteMutation.mutateAsync(item);
    },
    [deleteMutation]
  );

  const metadataMutation = useMutation({
    mutationFn: async ({ item, patch }: { item: MediaItem; patch: MediaMetadataPatch }) => {
      const filename = item.filename || item.url.replace(/^\/media\//, "");
      const mediaPath = filename.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`/api/media/${mediaPath}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.detail || `Failed to update ${filename}`);
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success("Media updated");
      queryClient.invalidateQueries({ queryKey: listingKeyBase });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Update failed");
    },
  });

  const updateMediaMetadata = useCallback(
    async (item: MediaItem, patch: MediaMetadataPatch) => {
      await metadataMutation.mutateAsync({ item, patch });
    },
    [metadataMutation]
  );

  const bulkDeleteItems = useCallback(async (itemsToDelete: MediaItem[]) => {
    if (itemsToDelete.length === 0) return;
    const files = itemsToDelete.map((item) => item.filename || item.url.replace(/^\/media\//, ""));
    const response = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.detail || `Failed to delete ${files.length} files`);
    }
    if (itemsToDelete.some((item) => item.url === selected)) setSelected(null);
    toast.success(`Deleted ${files.length} item${files.length === 1 ? "" : "s"}`);
    queryClient.invalidateQueries({ queryKey: listingKeyBase });
    queryClient.invalidateQueries({ queryKey: countsKey });
  }, [queryClient, selected]);

  const bulkUpdateMediaMetadata = useCallback(async (itemsToUpdate: MediaItem[], patcher: (item: MediaItem) => MediaMetadataPatch) => {
    if (itemsToUpdate.length === 0) return;
    await Promise.all(itemsToUpdate.map(async (item) => {
      const filename = item.filename || item.url.replace(/^\/media\//, "");
      const mediaPath = filename.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`/api/media/${mediaPath}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patcher(item)),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.detail || `Failed to update ${filename}`);
      }
    }));
    toast.success(`Updated ${itemsToUpdate.length} item${itemsToUpdate.length === 1 ? "" : "s"}`);
    queryClient.invalidateQueries({ queryKey: listingKeyBase });
  }, [queryClient]);

  const ctxValue: AppContextType = {
    items,
    jobs,
    loading,
    hasLoadedOnce,
    error,
    selected,
    setSelected,
    lightboxItems,
    setLightboxItems,
    sidebarOpen,
    setSidebarOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    activeSidebarTab,
    setActiveSidebarTab,
    training,
    checkpoints,
    trainingJobs,
    deleteItem,
    load,
    projectData,
    selectedSceneId,
    selectedShotId,
    setSelectedSceneId,
    setSelectedShotId,
    loadProject,
    addScene,
    deleteScene,
    deleteShot,
    galleryFilter,
    setGalleryFilter,
    gallerySearch,
    setGallerySearch,
    filteredTotal,
    fetchNextGalleryPage: () => listingQuery.fetchNextPage(),
    hasNextGalleryPage: Boolean(listingQuery.hasNextPage),
    isFetchingNextGalleryPage: listingQuery.isFetchingNextPage,
    counts,
    characters,
    galleryCharacter,
    setGalleryCharacter,
    galleryTag,
    setGalleryTag,
    galleryTrainingDatasetOnly,
    setGalleryTrainingDatasetOnly,
    updateMediaMetadata,
    bulkDeleteItems,
    bulkUpdateMediaMetadata,
  };

  return (
    <BrowserRouter>
      <AppContext.Provider value={ctxValue}>
        <Routes>
          <Route path="/" element={<Navigate to="/studio" replace />} />
          <Route path="/studio" element={<Shell />}>
            <Route index element={<StudioRoute />} />
            <Route path="projects" element={<ProjectsRoute />} />
            <Route path="projects/:projectId" element={<ProjectRoute />} />
            <Route path="projects/:projectId/films" element={<ProjectFilmsRoute />} />
            <Route path="characters/:characterId" element={<CharacterRoute />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="lora-training" element={<LoraTrainingPage />} />
            <Route path="settings" element={<SettingsPage />}>
              <Route index element={<Navigate to="account" replace />} />
              <Route path="account" element={<AccountSettings />} />
              <Route path="api-keys" element={<ApiKeysPage />} />
            </Route>
            {/* The bare page lists the accounts; a named one is that account's profile.
                Keys are managed in Settings — who someone is and what their key may do
                are different questions. */}
            <Route path="agents" element={<AccountsView />} />
            <Route path="agents/:agentId" element={<AgentRoute />} />
          </Route>
        </Routes>
      </AppContext.Provider>
    </BrowserRouter>
  );
}


export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SignInGate>
        <AppRoutes />
      </SignInGate>
      <Toaster richColors theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
