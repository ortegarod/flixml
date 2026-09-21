import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { AccountAvatar } from "./AccountAvatar";
import { useSession } from "./SettingsPage";

// The directory of accounts. An account is whoever's key submitted a job — an agent,
// a tool, a person — which is the author side of the gallery, not the character in
// the frame. /studio/agents is where a stranger looks for that list, so this lives
// there and key management stays in Settings.
interface DirectoryAccount {
  id: string;
  name: string;
  avatar: string | null;
  bio: string | null;
  deleted: boolean;
  counts: { images: number; videos: number; total: number };
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function AccountsView() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const [accounts, setAccounts] = useState<DirectoryAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const agent = session?.agent ?? null;
  // A scoped key can only read its own profile, so the list would be a wall of 404s.
  const scopedTo = agent && !agent.is_admin ? agent.id : null;

  useEffect(() => {
    if (sessionLoading || scopedTo) return;
    let live = true;
    fetch("/api/agents/directory")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Directory returned ${res.status}`))))
      .then((data: { accounts: DirectoryAccount[] }) => { if (live) setAccounts(data.accounts); })
      .catch((err: Error) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [sessionLoading, scopedTo]);

  if (scopedTo) return <Navigate to={`/studio/agents/${scopedTo}`} replace />;
  if (sessionLoading || (!accounts && !error)) {
    return <div className="p-6 text-sm text-gray-500 animate-pulse">Loading accounts…</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-gray-800/60 bg-gray-900/20 p-10 text-center text-sm text-gray-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 lg:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Everyone with a key to this install, and what they've made. Click one to open its profile.
          </p>
        </div>
        <Link
          to="/studio/settings/api-keys"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-800 px-3 py-1.5 text-sm text-gray-300 transition hover:border-gray-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <KeyRound className="h-4 w-4" aria-hidden /> Manage keys
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts?.map((account) => (
          <Link
            key={account.id}
            to={`/studio/agents/${account.id}`}
            className="group flex gap-4 rounded-2xl border border-gray-800/60 bg-gray-950/50 p-4 transition hover:border-brand/60 hover:bg-gray-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <AccountAvatar avatar={account.avatar} className="h-14 w-14 rounded-2xl ring-2 ring-black" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold text-gray-100 group-hover:text-white">{account.name}</span>
                <span className="font-mono text-xs text-gray-500">{account.id}</span>
                {agent?.id === account.id && (
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[11px] text-gray-300">You</span>
                )}
                {account.deleted && (
                  <span className="rounded-full bg-red-950/60 px-2 py-0.5 text-[11px] text-red-300">key deleted</span>
                )}
              </span>
              <span className="mt-1 block truncate text-sm text-gray-400">
                {account.bio || <span className="text-gray-600">No bio</span>}
              </span>
              <span className="mt-2 block text-xs text-gray-500">
                {account.counts.total === 0
                  ? "Nothing yet"
                  : `${plural(account.counts.images, "image")} · ${plural(account.counts.videos, "video")}`}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
