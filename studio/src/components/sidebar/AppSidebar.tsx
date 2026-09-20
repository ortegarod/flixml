import { useState, useEffect } from "react";
import { Settings, Terminal, X, Cpu, Users, Search, Box, Film, Activity, Code2, Workflow } from "lucide-react";
import type { ProjectModeData } from "../../types";
import { WorkflowsTab } from "./WorkflowsTab";
import { NodesTab } from "./NodesTab";
import { ProjectSidebar } from "./ProjectSidebar";
import { ProjectsGuide } from "../ProjectsGuide";

export type SidebarTab = "workflows" | "jobs" | "characters" | "projects" | "nodes" | "settings";
export const SIDEBAR_WIDTH = 380;

interface CharacterSummary {
  id: string;
  name: string;
  trigger: string | null;
  kind: string | null;
  loras: Record<string, unknown>[];
  source_images: string[];
  defaults: Record<string, unknown>;
}

interface AppSidebarProps {
  activeTab: SidebarTab;
  collapsed?: boolean;
  onTabChange: (tab: SidebarTab) => void;
  onClose: () => void;
  onSelectCharacter?: (characterId: string) => void;
  projectMode?: ProjectModeData;
}

export function AppSidebar({ activeTab, collapsed = false, onTabChange, onClose, onSelectCharacter, projectMode }: AppSidebarProps) {
  const topTabs: { id: SidebarTab; icon: React.ReactNode; label: string }[] = [
    { id: "workflows", icon: <Workflow className="w-4 h-4" />, label: "Workflows" },
    { id: "jobs", icon: <Activity className="w-4 h-4" />, label: "Jobs" },
    { id: "characters", icon: <Users className="w-4 h-4" />, label: "Characters & LoRA Training" },
    { id: "projects", icon: <Film className="w-4 h-4" />, label: "Projects" },
    { id: "nodes", icon: <Cpu className="w-4 h-4" />, label: "Nodes" },
  ];

  const bottomTabs: { id: SidebarTab; icon: React.ReactNode; label: string }[] = [
    { id: "settings", icon: <Settings className="w-4 h-4" />, label: "Settings" },
  ];

  const tabs = [...topTabs, ...bottomTabs];

  return (
    <div className="h-full flex flex-shrink-0 border-r border-gray-800/60 transition-[width] duration-200 absolute inset-y-0 left-0 z-50 max-w-[85vw] shadow-2xl shadow-black/50 md:static md:z-auto md:max-w-none md:shadow-none" style={{ width: `${collapsed ? 48 : SIDEBAR_WIDTH}px` }}>
      {/* Icon rail */}
      <div className="w-12 flex-shrink-0 bg-gray-950/60 border-r border-gray-800/40 flex flex-col items-center py-3 gap-1">
        {topTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            title={tab.label}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all relative group ${
              activeTab === tab.id
                ? "bg-brand-faint text-brand ring-1 ring-brand-soft"
                : "text-gray-600 hover:text-gray-300 hover:bg-gray-900/60"
            }`}
          >
            {tab.icon}
            {activeTab === tab.id && (
              <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-brand rounded-full" />
            )}
          </button>
        ))}

        <div className="mt-auto flex flex-col items-center gap-1">
          {bottomTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              title={tab.label}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all relative ${
                activeTab === tab.id
                  ? "bg-brand-faint text-brand ring-1 ring-brand-soft"
                  : "text-gray-600 hover:text-gray-300 hover:bg-gray-900/60"
              }`}
            >
              {tab.icon}
            </button>
          ))}
          <button
            onClick={onClose}
            title="Close sidebar"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-700 hover:text-gray-400 hover:bg-gray-900/60 transition mt-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content panel */}
      {!collapsed && (
      <div className="flex-1 flex flex-col min-w-0 bg-gray-950/40 overflow-hidden">
        <div className="flex items-center px-4 py-2.5 border-b border-gray-800/40 flex-shrink-0">
          <span className="text-sm font-semibold text-gray-300 tracking-tight">
            {projectMode && activeTab === "projects" ? "Scenes" : tabs.find((tab) => tab.id === activeTab)?.label}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === "characters" && <CharactersTab onSelectCharacter={onSelectCharacter} />}
          {activeTab === "workflows" && <WorkflowsTab />}
          {activeTab === "projects" && (projectMode ? <ProjectSidebar data={projectMode} onDeleteScene={(id) => projectMode.onDeleteScene(id)} /> : <ProjectsGuide compact />)}
          {activeTab === "nodes" && <NodesTab />}
        </div>

        {/* AGPL-3.0 section 13: anyone using this over a network is offered the source. */}
        <div className="flex-shrink-0 px-4 py-2 border-t border-gray-800/40">
          <a
            href="https://github.com/ortegarod/flixml"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-gray-600 hover:text-gray-400 transition inline-flex items-center gap-1.5"
          >
            <Code2 className="w-3 h-3" />
            Source code — AGPL-3.0
          </a>
        </div>
      </div>
      )}
    </div>
  );
}

function CharactersTab({ onSelectCharacter }: { onSelectCharacter?: (characterId: string) => void }) {
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/characters")
      .then((r) => r.json())
      .then((d) => setCharacters(d.characters || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
      <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Character cards first — your owned assets */}
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/30 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-300">Your character assets</p>
          <span className="text-[10px] uppercase tracking-wider text-gray-300 border border-white/15 bg-white/5 rounded-full px-2 py-0.5">Owned</span>
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          These are characters you created or own the rights to use. Each one is backed by a fine-tuned LoRA trained on AMD MI300X.
        </p>
      </div>

      {loading && <p className="text-xs text-gray-500 py-2">Loading...</p>}
      {error && <p className="text-xs text-red-400 py-2">{error}</p>}
      {!loading && characters.length === 0 && (
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/30 p-6 text-center">
          <Users className="w-5 h-5 text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500">No characters registered yet.</p>
        </div>
      )}

      {characters.map((ch) => {
        const avatarUrl = ch.source_images.length > 0
          ? (ch.source_images[0].startsWith("/") ? ch.source_images[0] : `/media/${ch.source_images[0]}`)
          : null;

        return (
        <div
          key={ch.id}
          className="rounded-xl border border-gray-800/60 bg-gray-900/30 hover:bg-gray-900/50 hover:border-gray-600 p-3.5 cursor-pointer transition-all group"
          onClick={() => onSelectCharacter?.(ch.id)}
        >
          <div className="flex items-center gap-3 mb-2.5">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 ring-1 ring-white/10">
              {avatarUrl ? (
                <img src={avatarUrl} alt={ch.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-brand to-brand-soft flex items-center justify-center">
                  <span className="text-xs font-bold text-white">{ch.name.charAt(0).toUpperCase()}</span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-gray-200 truncate">{ch.name}</span>
                {ch.kind === "human" && (
                  <span className="text-[9px] uppercase tracking-wider text-gray-300 border border-white/15 bg-white/5 rounded-full px-1.5 py-0.5 flex-shrink-0">Human</span>
                )}
                {ch.kind === "agent" && (
                  <span className="text-[9px] uppercase tracking-wider text-gray-300 border border-white/15 bg-white/5 rounded-full px-1.5 py-0.5 flex-shrink-0">Agent</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] mt-0.5">
                <span className="text-gray-600 font-mono">{ch.id}</span>
                {ch.loras.length > 0 && (
                  <span className="text-gray-400">{ch.loras.length} LoRA</span>
                )}
                <span className="text-[10px] uppercase tracking-wider text-gray-300 border border-white/15 bg-white/5 rounded-full px-1.5 py-0.5">Owned</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-800/40">
            <p className="text-[10px] text-gray-500">
              Available for your agent to use in generated images and videos.
            </p>
          </div>
        </div>
        );
      })}

      {/* Training workflow below the character card */}
      <CreateCharacterWorkflow />

      <div className="pt-2 border-t border-gray-800/40">
        <a
          href="#"
          className="w-full rounded-xl border border-gray-700/60 hover:border-gray-500 bg-gray-900/40 px-4 py-2 text-xs text-gray-400 hover:text-gray-200 transition flex items-center justify-center gap-2"
          onClick={(e) => { e.preventDefault(); }}
        >
          <Search className="w-3.5 h-3.5" />
          Browse community characters
          <span className="text-[10px] text-gray-600 ml-1">coming soon</span>
        </a>
      </div>
    </div>
  );
}

function CreateCharacterWorkflow() {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Box className="w-4 h-4 text-brand" />
        <span className="text-xs font-semibold text-brand uppercase tracking-wider">LoRA Fine-tuning</span>
        <span className="text-[10px] uppercase tracking-wider text-amber-300/80 border border-amber-500/20 bg-amber-500/5 rounded-full px-2 py-0.5 ml-auto">AMD MI300X</span>
      </div>

      <p className="text-xs text-gray-300 leading-relaxed">
        <strong className="text-gray-100">Train your own character LoRA in ~90 minutes on AMD MI300X.</strong> Once fine-tuned, your AI agent can generate consistent images and videos with your face — every single time.
      </p>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
        <p className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5 mb-1">
          <Cpu className="w-3.5 h-3.5" />
          AMD MI300X — 192 GB VRAM
        </p>
        <p className="text-[11px] text-amber-200/70 leading-relaxed">
          Fine-tuning runs on AMD's flagship GPU via ROCm. No CUDA required. Train a Flux2 LoRA in ~90 minutes, then generate images and videos immediately.
        </p>
      </div>

      <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-3">
        <p className="text-[11px] font-semibold text-gray-300 flex items-center gap-1.5 mb-2">
          <Terminal className="w-3.5 h-3.5 text-brand" />
          Tell your AI agent:
        </p>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          "Create a character for me. Upload my reference images, register the character, start a LoRA fine-tune on AMD MI300X, and let me know when it's ready to use."
        </p>
      </div>

      <div className="space-y-2.5">
        <p className="text-[11px] font-medium text-gray-400">How it works:</p>
        {[
          { n: 1, title: "Upload your images", body: "5-20 reference photos. Different angles and lighting work best. Your agent can even generate variations to build a dataset." },
          { n: 2, title: "Register your character", body: "A character record with a unique trigger word — this is how the agent references your identity in every generation." },
          { n: 3, title: "Fine-tune on AMD MI300X", body: "Training a Flux2 LoRA on 192 GB MI300X VRAM via ROCm. Takes about 90 minutes. Your agent monitors progress and notifies you when done.", highlight: true },
          { n: 4, title: "Generate consistently", body: 'Your character appears in the registry. From then on, just say "generate a shot with [character name] doing X" — your agent handles the rest.' },
        ].map((step) => (
          <div key={step.n} className="flex gap-2.5">
            <div className={`flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center mt-0.5 ${step.highlight ? "bg-amber-500/20" : "bg-gray-800"}`}>
              <span className={`text-[10px] font-medium ${step.highlight ? "text-amber-400" : "text-gray-500"}`}>{step.n}</span>
            </div>
            <div>
              <p className={`text-[11px] ${step.highlight ? "text-amber-300 font-medium" : "text-gray-200"}`}>{step.title}</p>
              <p className="text-[10px] text-gray-500 leading-relaxed mt-0.5">{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-1 border-t border-gray-800/40">
        <p className="text-[10px] text-gray-600">
          Your agent knows the API. It uses <code className="text-gray-500">/api/characters</code> to register and <code className="text-gray-500">/api/lora-training</code> to fine-tune; <code className="text-gray-500">/api/guide</code> is the full reference it reads.
        </p>
      </div>
    </div>
  );
}
