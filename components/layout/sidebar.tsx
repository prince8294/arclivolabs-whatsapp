"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  Shapes,
  ContactRound,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessageSquareText,
  UserRoundCheck,
  Send,
  Settings,
  X,
  ChartNoAxesCombined,
} from "lucide-react";

const navigation = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Categories", href: "/dashboard/categories", icon: Shapes },
  { label: "Contacts", href: "/dashboard/contacts", icon: ContactRound },
  { label: "Bulk Messaging", href: "/dashboard/bulk-messaging", icon: Send },
  { label: "Inbox", href: "/dashboard/inbox", icon: MessageSquareText },
  { label: "Leads", href: "/dashboard/leads", icon: UserRoundCheck },
  { label: "Templates", href: "/dashboard/templates", icon: FileText },
  { label: "Analytics", href: "/dashboard/analytics", icon: ChartNoAxesCombined },
  { label: "Settings", href: "/settings", icon: Settings },
];

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onClose: () => void;
};

export function Sidebar({ collapsed, mobileOpen, onCollapse, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function refreshUnread() {
      try {
        const response = await fetch("/api/inbox/conversations?summary=1", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { summary?: { unreadMessages?: number } };
        if (active) setUnreadCount(result.summary?.unreadMessages ?? 0);
      } catch (error) {
        if (active) console.error("Inbox unread count could not be refreshed.", error);
      }
    }
    void refreshUnread();
    const timer = window.setInterval(() => void refreshUnread(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not sign out.");
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("Could not sign out.", error);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-[var(--border)] bg-[var(--sidebar)] transition-all duration-300 ${
          collapsed ? "lg:w-[88px]" : "lg:w-[264px]"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className={`flex h-[76px] items-center border-b border-[var(--border)] px-5 ${collapsed ? "lg:justify-center lg:px-3" : "justify-between"}`}>
          <Link href="/" onClick={onClose} className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#075E54] text-white">
              <MessageCircle size={21} strokeWidth={2.2} />
            </span>
            <span className={`${collapsed ? "lg:hidden" : ""}`}>
              <span className="block whitespace-nowrap text-[14px] font-semibold tracking-[-0.02em]">ArclivoLabs</span>
              <span className="mt-0.5 block whitespace-nowrap text-[11px] text-[var(--muted)]">WhatsApp CRM</span>
            </span>
          </Link>
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)] lg:hidden"
          >
            <X size={18} />
          </button>
          <button
            onClick={onCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute -right-3 top-[83px] hidden h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] shadow-sm transition hover:text-[var(--foreground)] lg:flex"
          >
            <ChevronLeft size={15} className={`transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-6" aria-label="Main navigation">
          <p className={`mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)] ${collapsed ? "lg:hidden" : ""}`}>
            Workspace
          </p>
          {navigation.map(({ label, href, icon: Icon }) => {
            const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                title={collapsed ? label : undefined}
                className={`group relative flex h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
                } ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
              >
                <Icon size={18} strokeWidth={1.8} className="shrink-0" />
                <span className={collapsed ? "lg:hidden" : ""}>{label}</span>
                {label === "Inbox" && unreadCount > 0 && <span className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#128c50] px-1 text-[9px] font-bold text-white ${collapsed ? "lg:absolute lg:right-2 lg:top-1.5" : ""}`}>{unreadCount > 99 ? "99+" : unreadCount}</span>}
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-current lg:hidden" />}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--border)] p-3">
          <div className={`flex items-center gap-3 rounded-xl bg-[var(--surface-muted)] p-2.5 ${collapsed ? "lg:justify-center lg:px-1.5" : ""}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dcefe1] text-xs font-semibold text-[#17643d]">
              AL
            </div>
            <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
              <p className="truncate text-xs font-semibold">Administrator</p>
              <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">Workspace admin</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              disabled={loggingOut}
              title="Sign out"
              aria-label="Sign out"
              className={`rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)] disabled:opacity-50 ${collapsed ? "lg:hidden" : ""}`}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
