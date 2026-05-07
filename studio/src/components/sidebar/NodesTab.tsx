import { useEffect, useState } from "react";

type RuntimeMap = {
  comfyui?: { url: string; client_id?: string; online?: boolean; error?: string };
  ai_toolkit?: { toolkit_dir: string; venv: string; training_dir: string; runner: string; status: string };
};

type NodeInfo = {
  id?: string;
  label?: string;
  url?: string;
  roles?: string[];
  online: boolean;
  error?: string;
  runtimes?: RuntimeMap;
  gpu_name?: string;
  vram_total?: number;
  vram_free?: number;
  torch_vram_total?: number;
  torch_vram_free?: number;
  queue_running?: number;
  queue_pending?: number;
  system?: { comfyui_version?: string; os?: string };
};

function gb(value?: number) {
  if (!value) return "—";
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}

function vramPercent(node: NodeInfo) {
  if (!node.vram_total || node.vram_free == null) return null;
  return Math.max(0, Math.min(100, ((node.vram_total - node.vram_free) / node.vram_total) * 100));
}

function roleClass(role: string) {
  if (role === "training") return "text-amber-300 border-amber-500/30 bg-amber-500/10";
  if (role === "image" || role === "video") return "text-blue-300 border-blue-500/30 bg-blue-500/10";
  return "text-gray-400 border-gray-700 bg-gray-900/60";
}

export function NodesTab() {
  const [nodes, setNodes] = useState<Record<string, NodeInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setError(null);
        const response = await fetch("/api/nodes");
        if (!response.ok) throw new Error(`/api/nodes returned ${response.status}`);
        const data = await response.json();
        if (!cancelled) setNodes(data.nodes || {});
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const entries = Object.entries(nodes);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">GPU Nodes</h2>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          Compute workers and runtimes. ComfyUI handles image/video generation; ai-toolkit handles LoRA training on AMD GPUs.
        </p>
      </div>

      {loading && <p className="text-xs text-gray-500">Checking nodes...</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {!loading && entries.length === 0 && !error && (
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/30 p-4 text-xs text-gray-500">
          No GPU nodes configured.
        </div>
      )}

      {entries.map(([id, node]) => {
        const percent = vramPercent(node);
        const comfy = node.runtimes?.comfyui;
        const aiToolkit = node.runtimes?.ai_toolkit;
        return (
          <div key={id} className="rounded-xl border border-gray-800/60 bg-gray-900/30 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-200">{node.label || id}</p>
                {comfy?.url && <p className="text-[11px] text-gray-600 break-all mt-0.5">ComfyUI: {comfy.url}</p>}
              </div>
              <span className={`text-[10px] uppercase tracking-wider rounded-full px-2 py-1 border ${
                node.online
                  ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                  : "text-red-300 border-red-500/30 bg-red-500/10"
              }`}>
                {node.online ? "Comfy online" : "Comfy offline"}
              </span>
            </div>

            {node.roles && node.roles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {node.roles.map((role) => (
                  <span key={role} className={`text-[10px] uppercase tracking-wider rounded-full border px-2 py-0.5 ${roleClass(role)}`}>
                    {role}
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-2 text-xs">
              {comfy && (
                <div className="rounded-lg border border-gray-800 bg-black/30 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-gray-300">ComfyUI</p>
                    <span className={comfy.online ? "text-emerald-400" : "text-red-400"}>{comfy.online ? "online" : "offline"}</span>
                  </div>
                  <p className="text-[11px] text-gray-600 mt-1">Image/video generation runtime.</p>
                  {comfy.error && <p className="text-[11px] text-red-300/70 mt-1 break-words">{comfy.error}</p>}
                </div>
              )}

              {aiToolkit && (
                <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-amber-200">ai-toolkit</p>
                    <span className="text-amber-300">training</span>
                  </div>
                  <p className="text-[11px] text-amber-100/60 mt-1">AMD GPU LoRA training runtime.</p>
                  <p className="text-[10px] text-gray-600 mt-1 break-all">{aiToolkit.training_dir}</p>
                </div>
              )}
            </div>

            {node.online && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-300">{node.gpu_name || "GPU detected"}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">
                    ComfyUI {node.system?.comfyui_version || "version unknown"}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-gray-500">
                    <span>VRAM used</span>
                    <span>{gb((node.vram_total || 0) - (node.vram_free || 0))} / {gb(node.vram_total)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                    <div className="h-full bg-rose-500" style={{ width: `${percent ?? 0}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-gray-800 bg-black/30 p-2">
                    <p className="text-gray-600">Running</p>
                    <p className="text-gray-200 font-semibold mt-1">{node.queue_running ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-black/30 p-2">
                    <p className="text-gray-600">Pending</p>
                    <p className="text-gray-200 font-semibold mt-1">{node.queue_pending ?? 0}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
