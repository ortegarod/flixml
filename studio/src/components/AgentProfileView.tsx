import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, X } from "lucide-react";
import { AccountAvatar } from "./AccountAvatar";
import { MediaTile } from "./MediaTile";
import type { MediaItem } from "../types";

// An account — the agent, tool or person whose key submitted the job. Distinct from
// the character in the frame: an account's files and a character's files are separate
// sets that only partly overlap. This page is the author side.
interface AccountRecord {
  id: string;
  name: string;
  avatar: string | null;
  bio: string | null;
  created_at: string | null;
  deleted: boolean;
}

interface ProfileResponse {
  account: AccountRecord;
  counts: { images: number; videos: number; total: number };
}

interface ListingResponse {
  images: MediaItem[];
  total: number;
}

interface AgentProfileViewProps {
  agentId: string;
  onOpen: (url: string) => void;
  onDelete: (item: MediaItem) => Promise<void> | void;
  // Lend the lightbox this page's list while it's open. Without it the rail only
  // finds assets that happen to be in the gallery's first page, and everything
  // deeper opens as a bare image with no record beside it.
  onItemsChange: (items: MediaItem[] | null) => void;
}

const PAGE = 60;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json();
}

function joinedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function AgentProfileView({ agentId, onOpen, onDelete, onItemsChange }: AgentProfileViewProps) {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMedia, setLoadingMedia] = useState(true);
  // Picking a picture turns the grid into a chooser: a tap sets the avatar instead
  // of opening the asset, so the picture comes from what the account actually made.
  const [picking, setPicking] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const patchProfile = useCallback(async (patch: { avatar?: string | null; bio?: string | null }) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        throw new Error((body.detail as string) || `PATCH returned ${res.status}`);
      }
      setProfile((prev) => (prev ? { ...prev, account: { ...prev.account, ...patch } } : prev));
      // The header reads the picture off the session, which is cached for a minute.
      // Without this the top-right keeps the old face until a reload.
      if ("avatar" in patch) queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }, [agentId, queryClient]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetchJson<ProfileResponse>(`/api/agents/${encodeURIComponent(agentId)}/profile`)
      .then((data) => { if (live) setProfile(data); })
      .catch((err) => { if (live) setError(err instanceof Error ? err.message : "Failed to load account"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [agentId]);

  // The listing is the same catalog the gallery reads, narrowed to one account — and
  // unfiltered by type, so a clip sits next to the still it came from the way it does
  // in the gallery. Splitting them into tabs hid half the work behind a click.
  const loadPage = useCallback(async (offset: number) => {
    setLoadingMedia(true);
    try {
      const data = await fetchJson<ListingResponse>(
        `/api/listing?owner=${encodeURIComponent(agentId)}&limit=${PAGE}&offset=${offset}`,
      );
      setItems((prev) => (offset === 0 ? data.images : [...prev, ...data.images]));
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load media");
    } finally {
      setLoadingMedia(false);
    }
  }, [agentId]);

  useEffect(() => { setItems([]); loadPage(0); }, [loadPage]);

  // Hand the current list to the lightbox, and hand it back on the way out so the
  // gallery's own items take over again.
  useEffect(() => { onItemsChange(items); }, [items, onItemsChange]);
  useEffect(() => () => onItemsChange(null), [onItemsChange]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-500 animate-pulse">Loading account…</div>;
  }

  if (error && !profile) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-gray-800/60 bg-gray-900/20 p-10 text-center text-sm text-gray-500">
          {error}
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const { account, counts } = profile;
  const joined = joinedLabel(account.created_at);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* ── Who made it ── */}
      <section className="rounded-3xl border border-gray-800/60 bg-gradient-to-b from-gray-900/70 to-gray-950/40 p-5 lg:p-7">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setPicking((open) => !open)}
            title={picking ? "Cancel" : "Choose a picture"}
            className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-3xl ring-4 ring-black"
          >
            <AccountAvatar avatar={account.avatar} name={account.name} className="h-full w-full" iconClassName="h-9 w-9" />
            <span className="absolute inset-0 hidden items-center justify-center bg-black/60 group-hover:flex">
              {picking ? <X className="h-5 w-5 text-white" /> : <Pencil className="h-5 w-5 text-white" />}
            </span>
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-bold tracking-tight text-white">{account.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
              <span className="font-mono text-gray-400">{account.id}</span>
              <span>·</span>
              <span>{account.deleted ? "key deleted" : "account"}</span>
              {joined && (<><span>·</span><span>joined {joined}</span></>)}
            </p>

            {editingBio ? (
              <div className="mt-2 grid max-w-lg grid-cols-[1fr_auto_auto] gap-1.5">
                <input
                  value={bioDraft}
                  onChange={(event) => setBioDraft(event.target.value)}
                  maxLength={280}
                  placeholder="One line about this account"
                  className="min-w-0 rounded-md border border-gray-800 bg-black/30 px-2 py-1 text-xs text-gray-200 placeholder:text-gray-700 focus:border-brand focus:outline-none"
                />
                <button
                  onClick={async () => { await patchProfile({ bio: bioDraft.trim() || null }); setEditingBio(false); }}
                  disabled={saving}
                  className="rounded-md bg-gray-800 px-2 py-1 text-xs font-medium text-gray-200 transition hover:bg-brand hover:text-brand-foreground disabled:text-gray-600"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setEditingBio(false)}
                  className="rounded-md border border-gray-800 px-2 py-1 text-xs text-gray-500 transition hover:text-gray-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setBioDraft(account.bio ?? ""); setEditingBio(true); }}
                className="mt-2 max-w-lg text-left text-sm text-gray-400 transition hover:text-gray-200"
              >
                {account.bio || <span className="text-gray-600">Add a bio</span>}
              </button>
            )}
          </div>
        </div>

        {picking && (
          <p className="mt-4 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-xs text-gray-200">
            Pick any image below to use as the picture.
          </p>
        )}

        <div className="mt-6 grid max-w-xl grid-cols-3 gap-3">
          <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
            <p className="text-xs text-gray-600">Images</p>
            <p className="text-xl font-bold text-gray-100">{counts.images}</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
            <p className="text-xs text-gray-600">Videos</p>
            <p className="text-xl font-bold text-gray-100">{counts.videos}</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-black/30 p-3">
            <p className="text-xs text-gray-600">Total</p>
            <p className="text-xl font-bold text-gray-100">{counts.total}</p>
          </div>
        </div>
      </section>

      {/* ── What it made ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-gray-800/60 pb-3">
          <h2 className="text-sm font-medium text-white">Everything {account.name} made</h2>
          {total > 0 && (
            <p className="text-xs text-gray-600">
              {items.length} of {total}
            </p>
          )}
        </div>

        {items.length === 0 && !loadingMedia ? (
          <div className="rounded-2xl border border-gray-800/60 bg-gray-900/20 p-10 text-center text-sm text-gray-500">
            {account.name} hasn't made anything yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((item) => (
              <MediaTile
                key={item.filename || item.url}
                item={item}
                onOpen={() => onOpen(item.url)}
                onDelete={onDelete}
                // A picture is a still, so a clip in the mixed grid stays a normal tile
                // while picking rather than offering itself as one.
                selectionMode={picking && item.type === "image"}
                selected={picking && item.filename === account.avatar}
                onToggleSelected={async (picked) => {
                  await patchProfile({ avatar: picked.filename });
                  setPicking(false);
                }}
              />
            ))}
          </div>
        )}

        {items.length < total && (
          <div className="flex justify-center">
            <button
              onClick={() => loadPage(items.length)}
              disabled={loadingMedia}
              className="rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 transition hover:border-brand hover:text-white disabled:opacity-50"
            >
              {loadingMedia ? "Loading…" : `Show more (${total - items.length} left)`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
