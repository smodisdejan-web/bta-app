"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Props = { redirect?: string };

export default function UnlockClient({ redirect: redirectProp }: Props) {
  const searchParams = useSearchParams();
  // Decode the redirect URL in case it's URL-encoded
  const rawRedirect = redirectProp || searchParams.get('redirect') || '/';
  const redirect = decodeURIComponent(rawRedirect);
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [remember, setRemember] = useState(true); // default 7 days
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit() {
    setErr(null);
    if (!pw) return setErr("Please enter the password.");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw, remember }),
      });
      const data = await res.json();
      console.log('[Unlock] API response:', data);
      if (!res.ok) {
        setErr(data?.error || "Unable to unlock.");
        setLoading(false);
        return;
      }
      // Use window.location.href for immediate redirect after cookie is set
      // Small delay to ensure cookie is set before redirect
      console.log('[Unlock] Success! Redirecting to:', redirect);
      setTimeout(() => {
        window.location.href = redirect || "/";
      }, 100);
    } catch {
      setErr("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-gradient-to-b from-zinc-50 to-zinc-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl ring-1 ring-zinc-200 p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-black text-white grid place-items-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M7 10V8a5 5 0 1 1 10 0v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <rect x="4.8" y="10" width="14.4" height="10.2" rx="2.2" stroke="currentColor" strokeWidth="1.8"/>
              </svg>
            </div>
            <div>
              <div className="text-sm text-zinc-500">Goolets • AI Agent</div>
              <h1 className="text-lg font-semibold tracking-tight">Enter access password</h1>
            </div>
          </div>

          <p className="text-sm text-zinc-600 mb-5">
            Private demo access. If you don't have the password, ask your Goolets contact.
          </p>

          <label className="block text-sm font-medium text-zinc-700 mb-2" htmlFor="password">
            Password
          </label>
          <div className="relative">
            <input
              ref={inputRef}
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.getModifierState?.("CapsLock")) setCaps(true);
                else setCaps(false);
                if (e.key === "Enter") submit();
              }}
              className="w-full rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 px-4 py-3 pr-12 text-[15px] bg-white"
              placeholder="••••••••"
              aria-invalid={!!err}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 right-0 px-3 text-zinc-500 hover:text-zinc-700"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M10.6 10.6a3 3 0 0 0 3.8 3.8M6.6 6.6C4.8 7.6 3.4 9 2.3 10.9c2.9 5.1 8.6 7.5 13.9 5.9M13.8 6.2c3.3.8 6.1 3 7.9 4.7-1.1 2-2.6 3.6-4.6 4.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M2.3 12c2.9-5.1 8.6-7.5 13.9-5.9 2.4.7 4.5 2.1 6.1 3.9-2.9 5.1-8.6 7.5-13.9 5.9-2.4-.7-4.5-2.1-6.1-3.9Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8"/>
                </svg>
              )}
            </button>
          </div>

          {caps && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-flex items-center gap-1">
              <span>Caps Lock is ON</span>
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <input
              id="remember"
              type="checkbox"
              className="rounded-md border-zinc-300 text-amber-600 focus:ring-amber-500"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <label htmlFor="remember" className="text-sm text-zinc-700">Remember for 7 days</label>
          </div>

          {err && (
            <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {err}
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 bg-black text-white hover:bg-zinc-800 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {loading && (
                <svg className="animate-spin -ml-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3"/>
                  <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              )}
              Unlock
            </button>
            <button type="button" onClick={() => window.location.href = "/"} className="text-sm text-zinc-600 hover:text-zinc-800">
              Back to home
            </button>
          </div>

          <div className="mt-6 text-xs text-zinc-500">
            Tip: Press <kbd className="px-1 py-0.5 rounded border">Enter</kbd> to submit.
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-zinc-500">
          © {new Date().getFullYear()} Goolets • Internal demo
        </div>
      </div>
    </main>
  );
}
