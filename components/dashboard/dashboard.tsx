"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowRight, Bell, CheckCheck, ContactRound, MessageSquareText, Plus, Send, Shapes, Sparkles, UserRoundCheck } from "lucide-react";
import { categoryIcons, type CategoryIconName } from "@/lib/categories/icons";

type CategorySummary = {
  _id: string;
  name: string;
  icon: CategoryIconName;
  contactCount: number;
};

type CampaignStats = {
  totalCampaigns: number;
  messagesSent: number;
  messagesDelivered: number;
  totalReplies: number;
};
type ContactStats = { totalContacts: number };
type RecentCampaign = {
  _id: string;
  name: string;
  categoryNames: string[];
  eligibleRecipients: number;
  sentCount: number;
  status: string;
  createdAt: string;
};
type InboxSummary = {
  totalIncomingReplies: number;
  unreadConversations: number;
  interestedLeads: number;
  recentReplies: { phoneNumber: string; conversationId: string; name: string; text: string; lastMessageAt: string | null }[];
};
type LeadSummary = {
  interestedLeads: number;
  followUpsPending: number;
  recentInterestedBusinesses: { _id: string; businessName: string; categoryName: string; phoneNumber: string }[];
};

const metrics = [
  { label: "Total campaigns", detail: "Campaigns in your workspace", icon: Send },
  { label: "Total contacts", detail: "Businesses in your workspace", icon: ContactRound },
  { label: "Messages sent", detail: "Confirmed by Meta status updates", icon: CheckCheck },
  { label: "Delivered messages", detail: "Delivered or read", icon: CheckCheck },
  { label: "Total replies", detail: "Incoming WhatsApp messages", icon: MessageSquareText },
  { label: "Unread conversations", detail: "Messages not read internally", icon: Bell },
  { label: "Interested leads", detail: "Manually marked Interested", icon: UserRoundCheck }
];

export function Dashboard() {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [categoryState, setCategoryState] = useState<"loading" | "ready" | "unauthorized" | "error">("loading");
  const [campaignStats, setCampaignStats] = useState<CampaignStats | null>(null);
  const [contactStats, setContactStats] = useState<ContactStats | null>(null);
  const [recentCampaigns, setRecentCampaigns] = useState<RecentCampaign[]>([]);
  const [campaignState, setCampaignState] = useState<"loading" | "ready" | "error">("loading");
  const [inboxSummary, setInboxSummary] = useState<InboxSummary | null>(null);
  const [inboxState, setInboxState] = useState<"loading" | "ready" | "error">("loading");
  const [leadSummary, setLeadSummary] = useState<LeadSummary | null>(null);
  const [leadState, setLeadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/categories", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          if (active) setCategoryState("unauthorized");
          return;
        }
        if (!response.ok) throw new Error("Category list unavailable.");
        const result = (await response.json()) as { categories: CategorySummary[] };
        if (active) {
          setCategories(result.categories);
          setCategoryState("ready");
        }
      })
      .catch(() => {
        if (active) setCategoryState("error");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/contacts/stats", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error("Contact statistics unavailable.");
        const result = await response.json() as { stats: ContactStats };
        if (active) setContactStats(result.stats);
      })
      .catch((error) => {
        if (active) console.error("Contact statistics could not be loaded.", error);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/leads/stats", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error("Lead summary unavailable.");
        const result = await response.json() as LeadSummary;
        if (active) {
          setLeadSummary(result);
          setLeadState("ready");
        }
      })
      .catch(() => {
        if (active) setLeadState("error");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/inbox/conversations?summary=1", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error("Inbox summary unavailable.");
        const result = await response.json() as { summary: InboxSummary };
        if (active) {
          setInboxSummary(result.summary);
          setInboxState("ready");
        }
      })
      .catch(() => {
        if (active) setInboxState("error");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/campaigns", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error("Campaign statistics unavailable.");
        const result = await response.json() as { stats: CampaignStats; campaigns: RecentCampaign[] };
        if (active) {
          setCampaignStats(result.stats);
          setRecentCampaigns(result.campaigns.slice(0, 5));
          setCampaignState("ready");
        }
      })
      .catch(() => {
        if (active) setCampaignState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
            <Sparkles size={12} /> Workspace overview
          </div>
          <h2 className="text-[22px] font-semibold tracking-[-0.04em] sm:text-[26px]">Good to have you back</h2>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">Here&apos;s what&apos;s happening with your WhatsApp workspace.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link
            href="/dashboard/contacts"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-xs font-semibold transition hover:bg-[var(--surface-muted)]"
          >
            <Plus size={15} /> Add contact
          </Link>
          <Link
            href="/dashboard/bulk-messaging/create"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white transition hover:bg-[#0f7944] dark:bg-[#168b4e] dark:hover:bg-[#1a9d59]"
          >
            <Send size={14} /> New campaign
          </Link>
        </div>
      </section>

      <section aria-label="Workspace statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-7">
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          const value = metric.label === "Total campaigns"
            ? campaignStats?.totalCampaigns.toLocaleString() ?? "—"
            : metric.label === "Total contacts"
              ? contactStats?.totalContacts.toLocaleString() ?? "—"
            : metric.label === "Messages sent"
              ? campaignStats?.messagesSent.toLocaleString() ?? "—"
              : metric.label === "Delivered messages"
                ? campaignStats?.messagesDelivered.toLocaleString() ?? "—"
                : metric.label === "Total replies"
                  ? (inboxSummary?.totalIncomingReplies ?? campaignStats?.totalReplies)?.toLocaleString() ?? "—"
                  : metric.label === "Unread conversations"
                    ? inboxSummary?.unreadConversations.toLocaleString() ?? "—"
                    : inboxSummary?.interestedLeads.toLocaleString() ?? "—";
          return (
            <motion.article
              key={metric.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.045, duration: 0.25 }}
              whileHover={{ y: -2 }}
              className="surface soft-shadow rounded-2xl p-4 sm:p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Icon size={17} strokeWidth={1.9} />
                </div>
              </div>
              <p className="mt-5 text-[11px] font-medium text-[var(--muted)] sm:text-xs">{metric.label}</p>
              <p className="mt-1 text-[27px] font-semibold leading-none tracking-[-0.05em] sm:text-[30px]">{value}</p>
              <p className="mt-2 text-[10px] text-[var(--muted)] sm:text-[11px]">{metric.detail}</p>
            </motion.article>
          );
        })}
      </section>

      <section className="surface soft-shadow rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="grid flex-1 grid-cols-3 gap-3">
            <div><p className="text-[10px] text-[var(--muted)] sm:text-[11px]">Delivered messages</p><p className="mt-1 text-lg font-semibold">{campaignStats?.messagesDelivered.toLocaleString() ?? "—"}</p></div>
            <div><p className="text-[10px] text-[var(--muted)] sm:text-[11px]">Total replies</p><p className="mt-1 text-lg font-semibold">{inboxSummary?.totalIncomingReplies.toLocaleString() ?? "—"}</p></div>
            <div><p className="text-[10px] text-[var(--muted)] sm:text-[11px]">Interested leads</p><p className="mt-1 text-lg font-semibold">{leadSummary?.interestedLeads.toLocaleString() ?? "—"}</p></div>
          </div>
          <div className="min-w-0 border-t border-[var(--border)] pt-3 sm:w-80 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">Recent campaign performance</p>
            {recentCampaigns.length ? recentCampaigns.slice(0, 2).map((campaign) => (
              <div key={campaign._id} className="flex items-center justify-between gap-3 py-1 text-[11px]">
                <span className="min-w-0 truncate font-medium">{campaign.name}</span>
                <span className="shrink-0 text-[var(--muted)]">{campaign.sentCount.toLocaleString()} sent · {campaign.status}</span>
              </div>
            )) : <p className="py-1 text-[11px] text-[var(--muted)]">No campaigns yet.</p>}
          </div>
          <Link href="/dashboard/analytics" className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[11px] font-semibold text-[var(--accent)] hover:opacity-80">View Reports <ArrowRight size={13} /></Link>
        </div>
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-5">
          <div><h3 className="text-sm font-semibold tracking-[-0.02em]">Interested brands</h3><p className="mt-1 text-[11px] text-[var(--muted)]">Manually qualified businesses and their follow-ups.</p></div>
          <Link href="/dashboard/leads" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:gap-1.5">View all leads <ArrowRight size={13} /></Link>
        </div>
        {leadState === "loading" ? <div className="space-y-3 p-5" aria-label="Loading leads">{[0, 1, 2].map((item) => <div key={item} className="h-10 animate-pulse rounded-lg bg-[var(--surface-muted)]" />)}</div>
          : leadState === "error" ? <p role="status" className="px-5 py-8 text-center text-xs text-[var(--muted)]">Interested brands could not be loaded.</p>
            : <div className="grid gap-4 p-4 sm:grid-cols-[200px_200px_1fr] sm:p-5">
              <div className="rounded-xl bg-[var(--surface-muted)] p-4"><p className="text-[11px] text-[var(--muted)]">Interested leads</p><p className="mt-2 text-2xl font-semibold">{leadSummary?.interestedLeads.toLocaleString() ?? "0"}</p></div>
              <div className="rounded-xl bg-[var(--surface-muted)] p-4"><p className="text-[11px] text-[var(--muted)]">Follow-ups pending</p><p className="mt-2 text-2xl font-semibold">{leadSummary?.followUpsPending.toLocaleString() ?? "0"}</p></div>
              <div className="min-w-0">
                <p className="mb-2 text-[11px] font-semibold text-[var(--muted)]">Recent interested businesses</p>
                {leadSummary?.recentInterestedBusinesses.length ? <div className="divide-y divide-[var(--border)]">
                  {leadSummary.recentInterestedBusinesses.map((lead) => <Link key={lead._id} href={`/dashboard/leads?leadId=${lead._id}`} className="flex items-center justify-between gap-3 py-2 text-xs hover:text-[var(--accent)]">
                    <span className="min-w-0 truncate font-medium">{lead.businessName}</span><span className="shrink-0 truncate text-[10px] text-[var(--muted)]">{lead.categoryName || "—"}</span>
                  </Link>)}
                </div> : <p className="py-3 text-xs text-[var(--muted)]">No interested businesses yet.</p>}
              </div>
            </div>}
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-5">
          <div><h3 className="text-sm font-semibold tracking-[-0.02em]">Recent replies</h3><p className="mt-1 text-[11px] text-[var(--muted)]">Latest incoming messages stored from WhatsApp.</p></div>
          <Link href="/dashboard/inbox" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:gap-1.5">Open Inbox <ArrowRight size={13} /></Link>
        </div>
        {inboxState === "loading" ? <div className="space-y-3 p-5" aria-label="Loading replies">{[0, 1, 2].map((item) => <div key={item} className="h-10 animate-pulse rounded-lg bg-[var(--surface-muted)]" />)}</div>
          : inboxState === "error" ? <p role="status" className="px-5 py-8 text-center text-xs text-[var(--muted)]">Recent replies could not be loaded.</p>
            : inboxSummary?.recentReplies.length ? <div className="divide-y divide-[var(--border)]">{inboxSummary.recentReplies.map((reply) => <Link key={reply.phoneNumber} href={reply.conversationId ? `/dashboard/inbox?conversationId=${reply.conversationId}` : "/dashboard/inbox"} className="flex items-center gap-3 px-5 py-3 transition hover:bg-[var(--surface-muted)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)]">{reply.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{reply.name}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">{reply.text}</span></span>
              <span className="shrink-0 text-[9px] text-[var(--muted)]">{reply.lastMessageAt ? new Date(reply.lastMessageAt).toLocaleDateString() : ""}</span>
            </Link>)}</div>
              : <div className="px-5 py-9 text-center text-xs text-[var(--muted)]">No incoming WhatsApp messages have been stored yet.</div>}
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold tracking-[-0.02em]">Recent campaigns</h3>
            <p className="mt-1 text-[11px] text-[var(--muted)]">A quick look at your latest campaign activity.</p>
          </div>
          <Link
            href="/dashboard/bulk-messaging"
            className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--accent)] transition hover:gap-1.5"
          >
            View all <ArrowRight size={13} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[690px] text-left">
            <thead>
              <tr className="bg-[var(--surface-muted)] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]">
                <th className="px-5 py-3">Campaign name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Total contacts</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-5 py-3">Created date</th>
              </tr>
            </thead>
            <tbody>
              {campaignState === "loading" ? (
                <tr><td colSpan={6} className="px-5 py-10"><div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-8 animate-pulse rounded-lg bg-[var(--surface-muted)]" />)}</div></td></tr>
              ) : recentCampaigns.length ? recentCampaigns.map((campaign) => (
                <tr key={campaign._id} className="border-t border-[var(--border)] text-xs">
                  <td className="px-5 py-3.5"><Link href={`/dashboard/bulk-messaging/${campaign._id}`} className="font-semibold hover:text-[var(--accent)]">{campaign.name}</Link></td>
                  <td className="px-4 py-3.5">{campaign.categoryNames.join(", ") || "—"}</td>
                  <td className="px-4 py-3.5">{campaign.eligibleRecipients.toLocaleString()}</td>
                  <td className="px-4 py-3.5">{campaign.sentCount.toLocaleString()}</td>
                  <td className="px-4 py-3.5">{campaign.status}</td>
                  <td className="px-5 py-3.5 text-[var(--muted)]">{new Date(campaign.createdAt).toLocaleDateString()}</td>
                </tr>
              )) : (
                <tr>
                <td colSpan={6} className="px-5 py-12 text-center">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--muted)]">
                    <Send size={19} strokeWidth={1.7} />
                  </div>
                  <p className="mt-3 text-xs font-semibold">No campaigns yet</p>
                  <p className="mx-auto mt-1 max-w-xs text-[11px] leading-5 text-[var(--muted)]">
                    Campaigns you create will appear here. Messages are sent only after explicit confirmation.
                  </p>
                  <Link href="/dashboard/bulk-messaging/create" className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline">
                    Create a campaign <ArrowRight size={12} />
                  </Link>
                </td>
              </tr>)
              }
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold tracking-[-0.02em]">Business categories</h3>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {categoryState === "ready" ? `${categories.length} categories` : "Contact groups for your workspace"}
            </p>
          </div>
          <Link href="/dashboard/categories" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--accent)] transition hover:gap-1.5">
            View all <ArrowRight size={13} />
          </Link>
        </div>
        {categoryState === "loading" ? (
          <div className="space-y-3 p-5" aria-label="Loading categories">
            {[0, 1, 2].map((item) => <div key={item} className="h-9 animate-pulse rounded-lg bg-[var(--surface-muted)]" />)}
          </div>
        ) : categoryState === "unauthorized" ? (
          <div className="px-5 py-8 text-center">
            <p className="text-xs text-[var(--muted)]">Sign in to view your categories.</p>
            <Link href="/login" className="mt-2 inline-flex text-xs font-semibold text-[var(--accent)] hover:underline">Admin sign in</Link>
          </div>
        ) : categoryState === "error" ? (
          <p role="status" className="px-5 py-8 text-center text-xs text-[var(--muted)]">Categories could not be loaded.</p>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-8 text-center">
            <Shapes size={20} className="text-[var(--muted)]" />
            <p className="mt-2 text-xs text-[var(--muted)]">No categories added yet.</p>
            <Link href="/dashboard/categories" className="mt-2 text-xs font-semibold text-[var(--accent)] hover:underline">Add a category</Link>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)] px-4 sm:px-5">
            {categories.slice(0, 5).map((category) => {
              const Icon = categoryIcons[category.icon];
              return (
                <div key={category._id} className="flex items-center gap-3 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{category.name}</span>
                  <span className="text-[10px] text-[var(--muted)]">{category.contactCount} contacts</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
