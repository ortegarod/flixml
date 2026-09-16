import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";

export interface SessionAgent {
  id: string;
  name: string;
  is_admin: boolean;
}

export interface SessionInfo {
  agent: SessionAgent | null;
  require_api_key: boolean;
}

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionInfo> => {
      const res = await fetch("/api/session");
      if (!res.ok) throw new Error(`Session check failed (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

// Clearing the cookie and reloading lands the browser back on the sign-in gate.
export async function signOut() {
  await fetch("/api/session", { method: "DELETE" });
  window.location.assign("/studio");
}

export function SettingsPage() {
  const { data: session } = useSession();
  // Without an agent (keys not required) there's no admin check to fail, so the section stays visible.
  const showKeys = !session?.agent || session.agent.is_admin;
  const sections = [
    { to: "account", label: "Account" },
    ...(showKeys ? [{ to: "api-keys", label: "API keys" }] : []),
  ];

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 p-6 md:flex-row">
      <nav aria-label="Settings" className="flex-shrink-0 md:w-48">
        <h1 className="mb-3 text-xl font-bold text-white">Settings</h1>
        <ul className="flex gap-1 md:flex-col">
          {sections.map((section) => (
            <li key={section.to}>
              <NavLink
                to={section.to}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                    isActive ? "bg-gray-800/80 text-white" : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
                  }`
                }
              >
                {section.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export function AccountSettings() {
  const { data: session, isLoading, error } = useSession();

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>;
  if (error) return <p role="alert" className="text-sm text-red-300">{(error as Error).message}</p>;

  const agent = session?.agent;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-white">Account</h2>
        <p className="text-sm text-gray-400">The API key this browser is signed in with.</p>
      </header>

      {agent ? (
        <>
          <dl className="divide-y divide-gray-800/60 rounded-2xl border border-gray-800/60 bg-gray-950/50 text-sm">
            <div className="grid grid-cols-[8rem_1fr] gap-4 px-4 py-3">
              <dt className="text-gray-400">Name</dt>
              <dd className="text-gray-100">{agent.name}</dd>
            </div>
            <div className="grid grid-cols-[8rem_1fr] gap-4 px-4 py-3">
              <dt className="text-gray-400">ID</dt>
              <dd className="font-mono text-gray-100">{agent.id}</dd>
            </div>
            <div className="grid grid-cols-[8rem_1fr] gap-4 px-4 py-3">
              <dt className="text-gray-400">Role</dt>
              <dd className="text-gray-100">
                {agent.is_admin ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">
                    <ShieldCheck className="h-3 w-3" aria-hidden /> Admin
                  </span>
                ) : (
                  "Scoped: sees only what it creates"
                )}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-gray-400">
            Studio stores only a hash of each key, so it can't show your key again. If you've lost it, an admin can issue a
            new one under API keys.
          </p>
          <Button type="button" variant="outline" onClick={signOut}>
            <LogOut aria-hidden />
            Sign out
          </Button>
        </>
      ) : (
        <p className="text-sm text-gray-400">
          This install doesn't require API keys, so the browser isn't signed in as anyone. Set{" "}
          <code className="font-mono text-gray-300">security.require_api_key</code> to <code className="font-mono text-gray-300">true</code>{" "}
          in <code className="font-mono text-gray-300">config.json</code> once every caller has a key.
        </p>
      )}
    </div>
  );
}
