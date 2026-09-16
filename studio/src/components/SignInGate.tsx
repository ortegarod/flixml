import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type State = "checking" | "signed-in" | "needs-key";

// Holds the app back until the API accepts this browser. With keys required, the browser
// signs in once with an API key; the API keeps it in an HttpOnly cookie, which also covers
// the <img> and <video> requests a header can't reach.
export function SignInGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/session")
      .then((res) => setState(res.status === 401 ? "needs-key" : "signed-in"))
      // An unreachable API isn't a sign-in problem; let the app show its own errors.
      .catch(() => setState("signed-in"));
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        setState("signed-in");
        return;
      }
      setError(res.status === 401 ? "That key isn't valid, or it has been revoked." : `Sign-in failed (${res.status}).`);
    } catch {
      setError("Can't reach the API.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "signed-in") return <>{children}</>;
  if (state === "checking") return null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-950 px-4 text-gray-100">
      <form onSubmit={signIn} className="w-full max-w-sm space-y-4 rounded-2xl border border-gray-800 bg-gray-900/60 p-6">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="h-5 w-5 text-brand" aria-hidden />
            FlixML Studio
          </h1>
          <p className="text-sm text-gray-400">
            This install requires an API key. Lost yours? An admin can replace it under Settings → API keys, or on
            the server with <code className="font-mono text-gray-300">scripts/manage_agent_keys.py</code>.
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="api-key" className="text-sm text-gray-300">
            API key
          </label>
          <Input
            id="api-key"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={key}
            onChange={(event) => setKey(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "api-key-error" : undefined}
            className="font-mono"
          />
          {error && (
            <p id="api-key-error" role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" disabled={busy || !key.trim()} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
