"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Sun, ChevronDown, CheckCircle2 } from "lucide-react";

const pages: Record<string, { title: string; description: string }> = {
  "/": { title: "Dashboard", description: "A clear overview of your WhatsApp workspace." },
  "/contacts": { title: "Contacts", description: "Organize your business contacts by category and city." },
  "/dashboard/contacts": { title: "Contacts", description: "Manage and organize your business contacts." },
  "/dashboard/categories": { title: "Business Categories", description: "Organize your business contacts by category." },
  "/bulk-messaging": { title: "Bulk Messaging", description: "Create and review consent-based campaigns." },
  "/dashboard/bulk-messaging": { title: "Bulk Messaging", description: "Create and review consent-based campaigns." },
  "/dashboard/bulk-messaging/create": { title: "New Campaign", description: "Review and confirm a consent-based campaign." },
  "/inbox": { title: "Inbox", description: "Keep track of incoming WhatsApp conversations." },
  "/dashboard/inbox": { title: "Inbox", description: "Keep track of incoming WhatsApp conversations." },
  "/templates": { title: "Templates", description: "Manage approved WhatsApp message templates." },
  "/dashboard/templates": { title: "Templates", description: "Manage approved WhatsApp message templates." },
  "/dashboard/leads": { title: "Leads", description: "Manage interested businesses and manual follow-ups." },
  "/dashboard/analytics": { title: "Analytics & Reports", description: "Track your WhatsApp campaigns and business leads." },
  "/settings": { title: "Settings", description: "Configure your workspace and integrations." },
  "/dashboard/settings/whatsapp": { title: "WhatsApp Integration", description: "Connect and manage your Meta WhatsApp Business API." }
};

type ConnectionState = "not_connected" | "connected" | "error";

export function AppHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const page = pages[pathname]
    ?? (pathname.startsWith("/dashboard/analytics/campaigns/")
      ? { title: "Campaign Report", description: "Review campaign delivery and recipient results." }
      : pathname.startsWith("/dashboard/bulk-messaging/")
        ? { title: "Campaign", description: "Review and manage campaign activity." }
        : pathname.startsWith("/dashboard/templates/")
          ? { title: "Templates", description: "Manage approved WhatsApp message templates." }
          : { title: "Workspace", description: "Manage your ArclivoLabs workspace." });
  const [dark, setDark] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("not_connected");

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function refreshConnection() {
      try {
        const response = await fetch("/api/whatsapp/status", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          if (active && response.status >= 500) setConnectionState("error");
          return;
        }
        const result = (await response.json()) as { status?: { status?: ConnectionState } };
        if (active && result.status?.status) setConnectionState(result.status.status);
      } catch {
        if (active && !controller.signal.aborted) setConnectionState("error");
      }
    }
    void refreshConnection();
    window.addEventListener("whatsapp-status-updated", refreshConnection);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("whatsapp-status-updated", refreshConnection);
    };
  }, []);

  function toggleTheme() {
    const nextDark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", nextDark);
    try {
      localStorage.setItem("arclivolabs-theme", nextDark ? "dark" : "light");
    } catch (error) {
      console.error("Could not save theme preference.", error);
    }
    setDark(nextDark);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
      <div className="flex min-h-[76px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onMenuClick}
            aria-label="Open navigation"
            className="rounded-xl border border-[var(--border)] p-2 text-[var(--foreground)] transition hover:bg-[var(--surface)] lg:hidden"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[17px] font-semibold tracking-[-0.03em] sm:text-[19px]">{page.title}</h1>
            <p className="mt-0.5 hidden truncate text-xs text-[var(--muted)] sm:block">{page.description}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href="/dashboard/settings/whatsapp"
            title={`WhatsApp API connection status: ${connectionState === "connected" ? "Connected" : connectionState === "error" ? "Connection Error" : "Not Connected"}`}
            className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-2 transition hover:border-[var(--accent)] sm:gap-2 sm:px-3"
          >
            <span className={`h-2 w-2 rounded-full ${
              connectionState === "connected" ? "bg-emerald-500" : connectionState === "error" ? "bg-red-500" : "bg-gray-400"
            }`} />
            <span className="text-[9px] font-medium text-[var(--muted)] sm:text-[11px]">
              {connectionState === "connected" ? "Connected" : connectionState === "error" ? "Connection Error" : "Not Connected"}
            </span>
          </Link>
          <button
            onClick={toggleTheme}
            aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <div className="relative">
            <button
              onClick={() => setProfileOpen((open) => !open)}
              aria-expanded={profileOpen}
              className="flex items-center gap-2 rounded-xl p-1.5 transition hover:bg-[var(--surface)]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dcefe1] text-[10px] font-semibold text-[#17643d]">AL</span>
              <ChevronDown size={14} className="hidden text-[var(--muted)] sm:block" />
            </button>
            {profileOpen && (
              <div className="surface soft-shadow absolute right-0 top-12 z-50 w-52 rounded-xl p-3">
                <p className="text-xs font-semibold">Administrator</p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">Signed in as workspace administrator.</p>
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <p className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                    <CheckCircle2 size={13} className="text-[var(--accent)]" /> Workspace admin
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
