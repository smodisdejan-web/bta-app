"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Props = { redirect?: string };

function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="40" cy="40" r="34"/>
        <path d="M38 14 L38 66 M38 14 C22 14 14 24 14 40 C14 56 22 66 38 66"/>
        <path d="M42 14 L42 66 M42 14 C58 14 66 24 66 40 C66 56 58 66 42 66"/>
      </g>
    </svg>
  );
}

export default function UnlockClient({ redirect: redirectProp }: Props) {
  const searchParams = useSearchParams();
  const rawRedirect = redirectProp || searchParams.get('redirect') || '/';
  const redirect = decodeURIComponent(rawRedirect);
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [remember, setRemember] = useState(true);
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
      if (!res.ok) {
        setErr(data?.error || "Unable to unlock.");
        setLoading(false);
        return;
      }
      setTimeout(() => {
        window.location.href = redirect || "/";
      }, 100);
    } catch {
      setErr("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 overflow-auto bg-[#0a0e12] text-[#FAF8F5]">
      {/* Cinematic background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 20% 20%, rgba(179,146,98,0.18) 0%, transparent 55%), radial-gradient(ellipse 70% 60% at 85% 85%, rgba(179,146,98,0.12) 0%, transparent 55%), linear-gradient(180deg, #0a0e12 0%, #121820 50%, #0a0d10 100%)',
          }}
        />
        <svg className="absolute inset-0 w-full h-full opacity-[0.035]" xmlns="http://www.w3.org/2000/svg">
          <filter id="noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch"/>
          </filter>
          <rect width="100%" height="100%" filter="url(#noise)"/>
        </svg>
      </div>

      {/* Floating brand mark top-left */}
      <div className="absolute top-8 left-8 lg:top-10 lg:left-12 z-20 flex items-center gap-3">
        <BrandMark className="h-8 w-8 text-[#FAF8F5]" />
        <div className="flex flex-col leading-none">
          <span className="font-serif text-lg tracking-[0.28em] font-medium">GOOLETS</span>
          <span className="text-[10px] uppercase tracking-[0.3em] text-[#FAF8F5]/60 mt-1">AI Agent</span>
        </div>
      </div>

      {/* Floating copyright bottom-left */}
      <div className="absolute bottom-8 left-8 lg:bottom-10 lg:left-12 z-20 text-[11px] text-[#FAF8F5]/40 tracking-[0.2em] uppercase">
        © {new Date().getFullYear()} Goolets · Internal demo
      </div>

      {/* Main content — centered single column */}
      <div className="relative z-10 min-h-full flex items-center justify-center px-6 sm:px-10 py-28">
        <div className="w-full max-w-lg flex flex-col items-center text-center">
          {/* Hero */}
          <p className="text-[11px] uppercase tracking-[0.4em] text-[#B39262] mb-6">Private Access</p>
          <h1 className="font-serif text-6xl sm:text-7xl leading-[0.95] tracking-tight mb-5">
            Welcome <span className="text-[#B39262]">aboard.</span>
          </h1>
          <div className="flex items-center gap-3 mb-5">
            <span className="h-px w-10 bg-[#B39262]"/>
            <span className="font-script text-2xl text-[#B39262]">Luxury, within your reach.</span>
            <span className="h-px w-10 bg-[#B39262]"/>
          </div>
          <p className="text-[#FAF8F5]/65 text-sm sm:text-base leading-relaxed max-w-md mb-10">
            Goolets marketing intelligence. A private command center for paid performance, lead quality, and vessel-level insight.
          </p>

          {/* Unlock panel */}
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-8 sm:p-10 shadow-2xl text-left">
            <h2 className="font-serif text-3xl mb-2">Enter access password</h2>
            <p className="text-sm text-[#FAF8F5]/60 mb-8">
              If you don&apos;t have the password, ask your Goolets contact.
            </p>

            <label className="block text-xs uppercase tracking-[0.2em] text-[#FAF8F5]/70 mb-3" htmlFor="password">
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
                className="w-full rounded-lg border border-white/15 bg-black/20 focus:outline-none focus:ring-2 focus:ring-[#B39262]/60 focus:border-[#B39262]/60 px-4 py-3.5 pr-12 text-[15px] text-[#FAF8F5] placeholder:text-[#FAF8F5]/30 transition"
                placeholder="••••••••"
                aria-invalid={!!err}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute inset-y-0 right-0 px-3 text-[#FAF8F5]/50 hover:text-[#B39262] transition-colors"
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
              <div className="mt-2 text-xs text-[#B39262] bg-[#B39262]/10 border border-[#B39262]/20 rounded-lg px-2 py-1 inline-flex items-center gap-1">
                <span>Caps Lock is ON</span>
              </div>
            )}

            <div className="mt-5 flex items-center gap-2">
              <input
                id="remember"
                type="checkbox"
                className="rounded border-white/20 bg-black/20 text-[#B39262] focus:ring-[#B39262]/60 focus:ring-offset-0"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <label htmlFor="remember" className="text-sm text-[#FAF8F5]/70">Remember for 7 days</label>
            </div>

            {err && (
              <div className="mt-4 text-sm text-red-300 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">
                {err}
              </div>
            )}

            <div className="mt-8">
              <button
                type="button"
                onClick={submit}
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 bg-[#B39262] text-[#121212] font-medium hover:bg-[#C9A876] disabled:opacity-60 transition-colors focus:outline-none focus:ring-2 focus:ring-[#B39262]/60 focus:ring-offset-2 focus:ring-offset-[#0a0e12]"
              >
                {loading && (
                  <svg className="animate-spin -ml-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3"/>
                    <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                )}
                Unlock
              </button>
            </div>

            <div className="mt-6 text-xs text-[#FAF8F5]/40 text-center">
              Press <kbd className="px-1.5 py-0.5 rounded border border-white/20 bg-white/5 text-[#FAF8F5]/70">Enter</kbd> to submit
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
