"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, LoaderCircle, LockKeyhole, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not sign in.");
      router.replace("/dashboard/categories");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="surface soft-shadow w-full max-w-[410px] rounded-2xl p-6 sm:p-8">
        <Link href="/" className="inline-flex items-center gap-2 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
          <ArrowLeft size={14} /> Back to dashboard
        </Link>
        <div className="mt-7 flex h-11 w-11 items-center justify-center rounded-xl bg-[#075E54] text-white">
          <MessageCircle size={21} />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-[-0.03em]">Admin sign in</h1>
        <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">Sign in to manage business categories.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium">Admin email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#128c50] text-xs font-semibold text-white transition hover:bg-[#0f7944] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <LoaderCircle size={15} className="animate-spin" /> : <LockKeyhole size={14} />}
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-[10px] leading-4 text-[var(--muted)]">
          Admin credentials are configured only in the server environment.
        </p>
      </div>
    </main>
  );
}
