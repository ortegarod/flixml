import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, Film, Image, Sparkles, UserRound } from "lucide-react";
import { MediaTile } from "./MediaTile";
import type { MediaItem } from "../types";

interface CharacterRecord {
  id: string;
  name: string;
  kind: string | null;
  trigger: string | null;
  description: string | null;
  source_images: string[];
  loras: Record<string, unknown>[];
  defaults: Record<string, unknown>;
}

interface CharacterProfileViewProps {
  characterId: string;
  items: MediaItem[];
  onOpen: (url: string) => void;
  onDelete: (item: MediaItem) => Promise<void> | void;
  onGenerate: () => void;
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

export function CharacterProfileView({ characterId, items, onOpen, onDelete, onGenerate }: CharacterProfileViewProps) {
  const [character, setCharacter] = useState<CharacterRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"images" | "videos">("images");

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchJson<{ character: CharacterRecord }>(`/api/characters/${characterId}`);
      setCharacter(data.character || data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load character");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => { load(); }, [load]);

  const related = useMemo(() => {
    if (!character) return [];
    const terms = [character.id, character.name, character.trigger].filter(Boolean).map((value) => String(value).toLowerCase());
    return items.filter((item) => {
      const haystack = [item.name, item.filename, item.prompt].join(" ").toLowerCase();
      return terms.some((term) => haystack.includes(term));
    });
  }, [character, items]);

  const fallbackItems = related.length > 0 ? related : items;
  const images = fallbackItems.filter((item) => !isVideo(item));
  const videos = fallbackItems.filter(isVideo);
  const shown = tab === "images" ? images : videos;

  if (loading) return <div className="p-6 text-gray-500">Loading character...</div>;
  if (error) return <div className="p-6 text-red-400">{error}</div>;
  if (!character) return null;

  const avatarUrl = character.source_images[0] ? resolveImageUrl(character.source_images[0]) : null;
  const loraCount = character.loras.length;

  return (
    <div className="p-5 lg:p-7 space-y-6">
      <section className="rounded-3xl border border-gray-800/60 bg-gradient-to-b from-gray-900/70 to-gray-950/40 overflow-hidden">
        <div className="relative h-44 bg-gradient-to-br from-rose-950/50 via-fuchsia-950/20 to-amber-950/20">
          {avatarUrl && <img src={avatarUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-35 blur-sm scale-105" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        </div>

        <div className="px-5 lg:px-7 pb-6 -mt-16 relative">
          <div className="flex flex-col lg:flex-row lg:items-end gap-5">
            <div className="w-32 h-32 rounded-3xl overflow-hidden ring-4 ring-black bg-gray-900 shadow-2xl flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={character.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-rose-500 to-amber-400 flex items-center justify-center">
                  <UserRound className="w-12 h-12 text-white" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {character.kind && <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-blue-300">{character.kind}</span>}
                {character.trigger && <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-rose-300">trigger: {character.trigger}</span>}
              </div>
              <h1 className="text-3xl font-bold tracking-tight">{character.name}</h1>
              <p className="text-sm text-gray-500 mt-2 max-w-3xl">
                {character.description || "Reusable character identity for agent-generated images and videos."}
              </p>
            </div>

            <div className="flex gap-2">
              <button onClick={onGenerate} className="rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-sm font-semibold transition flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Generate
              </button>
              <button className="rounded-xl border border-gray-700 text-gray-400 px-4 py-2 text-sm font-semibold transition flex items-center gap-2 cursor-not-allowed opacity-60" title="Profile editing is coming next">
                <Edit3 className="w-4 h-4" /> Edit
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
