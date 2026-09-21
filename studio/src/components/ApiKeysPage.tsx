import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, KeyRound, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { copyText } from "../lib/agentContext";

interface AgentKey {
  id: string;
  name: string;
  enabled: boolean;
  is_admin: boolean;
  allowed_characters: string[];
  allowed_workflows: string[];
  max_concurrent_jobs: number | null;
  created_at: string;
  last_used_at: string | null;
}

interface Scope {
  name: string;
  is_admin: boolean;
  allowed_characters: string[];
  allowed_workflows: string[];
  max_concurrent_jobs: number | null;
}

interface Option {
  id: string;
  label: string;
}

const emptyScope: Scope = { name: "", is_admin: false, allowed_characters: [], allowed_workflows: [], max_concurrent_jobs: null };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? data.detail[0]?.msg : null;
    throw Object.assign(new Error(detail || `Request failed (${res.status})`), { status: res.status });
  }
  return data as T;
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function lastUsed(iso: string | null): string {
  if (!iso) return "Never";
  const seconds = (Date.now() - Date.parse(iso)) / 1000;
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function scopeSummary(agent: AgentKey): string {
  if (agent.is_admin) return "everything";
  const characters = agent.allowed_characters.length ? agent.allowed_characters.join(", ") : "any character";
  return `its own work · ${characters}`;
}

// The key is only ever in the create/rotate response, so this panel is the one chance to copy it.
function KeyReveal({ agentName, secret, onDone }: { agentName: string; secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby="key-reveal-title" className="space-y-3 rounded-2xl border border-brand-soft bg-brand-faint p-4">
      <h2 id="key-reveal-title" className="flex items-center gap-2 text-sm font-semibold text-brand">
        <KeyRound className="h-4 w-4" aria-hidden />
        Key for {agentName}
      </h2>
      <p className="text-sm text-gray-300">
        Copy it now. Studio keeps only a hash, so this is the only time the key is shown. The agent sends it as{" "}
        <code className="font-mono text-gray-200">Authorization: Bearer &lt;key&gt;</code>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-black/40 px-3 py-2 font-mono text-sm text-gray-100">{secret}</code>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            copyText(secret);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}

function Chips({ legend, hint, options, selected, onChange }: {
  legend: string;
  hint: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-gray-300">{legend}</legend>
      <p className="text-xs text-gray-400">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label
              key={option.id}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
                checked ? "border-brand bg-brand-faint text-brand" : "border-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => onChange(checked ? selected.filter((id) => id !== option.id) : [...selected, option.id])}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ScopeForm({ initial, isNew, characters, workflows, lockAdmin, onSubmit, onCancel }: {
  initial: Scope & { id?: string };
  isNew: boolean;
  characters: Option[];
  workflows: Option[];
  lockAdmin: boolean;
  onSubmit: (scope: Scope & { id?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState(initial);
  const [id, setId] = useState(initial.id ?? "");
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = isNew ? "new-agent" : `edit-${initial.id}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...scope, id: isNew ? id : initial.id });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${formId}-name`} className="text-sm text-gray-300">Name</label>
          <Input
            id={`${formId}-name`}
            required
            value={scope.name}
            onChange={(event) => {
              setScope({ ...scope, name: event.target.value });
              if (isNew && !idEdited) setId(slugify(event.target.value));
            }}
          />
        </div>
        {isNew && (
          <div className="space-y-1.5">
            <label htmlFor={`${formId}-id`} className="text-sm text-gray-300">ID</label>
            <Input
              id={`${formId}-id`}
              required
              pattern="[a-z0-9][a-z0-9_\-]{0,63}"
              title="Lowercase letters, digits, - and _"
              value={id}
              onChange={(event) => {
                setId(event.target.value);
                setIdEdited(true);
              }}
              className="font-mono"
            />
          </div>
        )}
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 accent-[var(--brand)]"
          checked={scope.is_admin}
          disabled={lockAdmin}
          onChange={(event) => setScope({ ...scope, is_admin: event.target.checked })}
        />
        <span>
          <span className="text-gray-200">Admin</span>
          <span className="block text-xs text-gray-400">
            {lockAdmin
              ? "This is the key you're signed in with, so it stays admin."
              : "Sees everything and can manage keys. Without it, the key sees only what it creates."}
          </span>
        </span>
      </label>

      <Chips
        legend="Characters"
        hint="None selected allows every character."
        options={characters}
        selected={scope.allowed_characters}
        onChange={(allowed_characters) => setScope({ ...scope, allowed_characters })}
      />
      <Chips
        legend="Workflows"
        hint="None selected allows every workflow."
        options={workflows}
        selected={scope.allowed_workflows}
        onChange={(allowed_workflows) => setScope({ ...scope, allowed_workflows })}
      />

      <div className="max-w-48 space-y-1.5">
        <label htmlFor={`${formId}-cap`} className="text-sm text-gray-300">Max jobs at once</label>
        <Input
          id={`${formId}-cap`}
          type="number"
          min={1}
          placeholder="No limit"
          value={scope.max_concurrent_jobs ?? ""}
          onChange={(event) => setScope({ ...scope, max_concurrent_jobs: event.target.value ? Number(event.target.value) : null })}
        />
      </div>

      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : isNew ? "Create key" : "Save"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function ApiKeysPage() {
  const [agents, setAgents] = useState<AgentKey[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [characters, setCharacters] = useState<Option[]>([]);
  const [workflows, setWorkflows] = useState<Option[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: "rotate" | "delete" } | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setAgents(await request<AgentKey[]>("/api/agents"));
    } catch (err) {
      if ((err as { status?: number }).status === 403) setForbidden(true);
      else toast.error((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    request<{ agent: { id: string } | null }>("/api/session").then((s) => setMe(s.agent?.id ?? null)).catch(() => {});
    request<{ characters: { id: string; name: string }[] }>("/api/characters")
      .then((d) => setCharacters(d.characters.map((c) => ({ id: c.id, label: c.name }))))
      .catch(() => {});
    request<{ id: string; name?: string }[]>("/api/workflows")
      .then((d) => setWorkflows(d.map((w) => ({ id: w.id, label: w.id }))))
      .catch(() => {});
  }, [load]);

  async function run(action: () => Promise<unknown>, done?: string) {
    try {
      await action();
      if (done) toast.success(done);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">API keys</h2>
        <p className="text-sm text-gray-400">Managing keys requires an admin key. Sign in with one to see this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold text-white">API keys</h2>
          <p className="text-sm text-gray-400">
            Give each agent its own key. It sends the key as <code className="font-mono text-gray-300">Authorization: Bearer &lt;key&gt;</code>. An admin key sees everything. Any other key sees only the images, videos, jobs
            and projects it creates, and only the characters and workflows you allow.
          </p>
          <p className="text-sm text-gray-500">
            This page is the key half of an account.{" "}
            <Link to="/studio/agents" className="text-gray-300 underline underline-offset-4 hover:text-white">
              Accounts
            </Link>{" "}
            is the public half — who each one is and what they've made.
          </p>
        </div>
        {!creating && (
          <Button type="button" onClick={() => { setCreating(true); setEditing(null); setRevealed(null); }}>
            <Plus aria-hidden />
            New key
          </Button>
        )}
      </header>

      {revealed && <KeyReveal agentName={revealed.name} secret={revealed.key} onDone={() => setRevealed(null)} />}

      {creating && (
        <section aria-labelledby="new-key-title" className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
          <h2 id="new-key-title" className="text-sm font-semibold text-gray-200">New key</h2>
          <ScopeForm
            initial={emptyScope}
            isNew
            characters={characters}
            workflows={workflows}
            lockAdmin={false}
            onCancel={() => setCreating(false)}
            onSubmit={async ({ id, ...scope }) => {
              const created = await request<{ agent: AgentKey; key: string }>("/api/agents", {
                method: "POST",
                body: JSON.stringify({ id, ...scope }),
              });
              setCreating(false);
              setRevealed({ name: created.agent.name, key: created.key });
              await load();
            }}
          />
        </section>
      )}

      {agents === null ? (
        <p className="text-sm text-gray-400">Loading keys…</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-gray-400">No keys yet.</p>
      ) : (
        <ul className="divide-y divide-gray-800/60 overflow-hidden rounded-2xl border border-gray-800/60 bg-gray-950/50">
          {agents.map((agent) => {
            const isMe = agent.id === me;
            const confirm = confirming?.id === agent.id ? confirming.action : null;
            return (
              <li key={agent.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-100">
                      {/* This list is the only place every account is named, so it's also the way into each profile. */}
                      <Link to={`/studio/agents/${agent.id}`} className="rounded text-gray-100 underline-offset-4 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                        {agent.name}
                      </Link>
                      <span className="font-mono text-xs font-normal text-gray-400">{agent.id}</span>
                      {agent.is_admin && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">
                          <ShieldCheck className="h-3 w-3" aria-hidden /> Admin
                        </span>
                      )}
                      {!agent.enabled && <span className="rounded-full bg-red-950/60 px-2 py-0.5 text-[11px] text-red-300">Revoked</span>}
                      {isMe && <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[11px] text-gray-300">You</span>}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Sees {scopeSummary(agent)}
                      {!agent.is_admin && agent.allowed_workflows.length > 0 && ` · workflows: ${agent.allowed_workflows.join(", ")}`}
                      {agent.max_concurrent_jobs !== null && ` · ${agent.max_concurrent_jobs} jobs at once`}
                      {` · last used ${lastUsed(agent.last_used_at).toLowerCase()}`}
                    </p>
                  </div>

                  {confirm ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                      <span>
                        {confirm === "rotate"
                          ? isMe
                            ? "Replace your key? The current one stops working immediately, and this tab switches to the new one."
                            : "Replace this key? The current one stops working immediately."
                          : "Delete this agent and its key? What it made stays, visible to admins."}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setConfirming(null);
                          if (confirm === "rotate") {
                            run(async () => {
                              const rotated = await request<{ agent: AgentKey; key: string }>(`/api/agents/${agent.id}/rotate`, { method: "POST" });
                              setRevealed({ name: rotated.agent.name, key: rotated.key });
                            });
                          } else {
                            run(() => request(`/api/agents/${agent.id}`, { method: "DELETE" }), `Deleted ${agent.name}`);
                          }
                        }}
                      >
                        {confirm === "rotate" ? "Replace key" : "Delete"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <Button type="button" size="sm" variant="outline" aria-expanded={editing === agent.id} onClick={() => { setEditing(editing === agent.id ? null : agent.id); setCreating(false); }}>
                        Edit
                      </Button>
                      {/* Rotating is offered on your own row too: a key can't be read back, so
                          replacing it is the only way to get a copy for another machine. */}
                      <Button type="button" size="sm" variant="outline" onClick={() => setConfirming({ id: agent.id, action: "rotate" })}>
                        New key
                      </Button>
                      {!isMe && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => run(
                              () => request(`/api/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !agent.enabled }) }),
                              agent.enabled ? `Revoked ${agent.name}'s key` : `Re-enabled ${agent.name}'s key`,
                            )}
                          >
                            {agent.enabled ? "Revoke" : "Enable"}
                          </Button>
                          <Button type="button" size="sm" variant="destructive" onClick={() => setConfirming({ id: agent.id, action: "delete" })}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {editing === agent.id && (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                    <ScopeForm
                      initial={{ id: agent.id, name: agent.name, is_admin: agent.is_admin, allowed_characters: agent.allowed_characters, allowed_workflows: agent.allowed_workflows, max_concurrent_jobs: agent.max_concurrent_jobs }}
                      isNew={false}
                      characters={characters}
                      workflows={workflows}
                      lockAdmin={isMe}
                      onCancel={() => setEditing(null)}
                      onSubmit={async ({ id: _id, ...scope }) => {
                        await request(`/api/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify(scope) });
                        setEditing(null);
                        toast.success(`Saved ${scope.name}`);
                        await load();
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
