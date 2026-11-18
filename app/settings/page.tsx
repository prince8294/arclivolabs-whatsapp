import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Workspace preferences</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Settings</h2>
        <p className="mt-1.5 text-sm text-[var(--muted)]">Manage workspace details and integrations.</p>
      </div>
      <Link
        href="/dashboard/settings/whatsapp"
        className="surface soft-shadow group flex max-w-2xl items-center gap-4 rounded-2xl border border-[var(--border)] p-5 transition hover:border-[var(--accent)]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <MessageCircle size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">WhatsApp Integration</span>
          <span className="mt-1 block text-xs text-[var(--muted)]">Connect and configure the official Meta Cloud API.</span>
        </span>
        <ArrowRight size={17} className="text-[var(--muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
      </Link>
    </div>
  );
}
