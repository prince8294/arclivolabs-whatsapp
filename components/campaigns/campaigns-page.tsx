"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCheck, CircleAlert, Eye, FileSpreadsheet, LoaderCircle, Pause, Play, Plus, Send, Square, X } from "lucide-react";

type Campaign = {
  _id: string;
  name: string;
  categoryNames: string[];
  templateName: string;
  messageMode: string;
  importBatchId: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  status: string;
  createdAt: string;
};

type Stats = {
  totalCampaigns: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesFailed: number;
};

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/campaigns", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Campaigns could not be loaded.");
      setCampaigns(result.campaigns as Campaign[]);
      setStats(result.stats as Stats);
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaigns could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function action(campaign: Campaign, actionName: "pause" | "resume" | "cancel") {
    if (actionName === "cancel" && !window.confirm("Cancel this campaign? Unsent recipients will be cancelled; messages already submitted to Meta cannot be recalled.")) return;
    setBusy(campaign._id);
    setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaign._id}/${actionName}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? `Campaign could not be ${actionName}d.`);
      await load();
      setNotice(`Campaign ${actionName === "resume" ? "resumed" : `${actionName}d`}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Campaign could not be ${actionName}d.`);
    } finally {
      setBusy("");
    }
  }

  const metrics = useMemo(() => [
    { label: "Total Campaigns", value: stats?.totalCampaigns, icon: Send, tone: "text-[var(--accent)] bg-[var(--accent-soft)]" },
    { label: "Messages Sent", value: stats?.messagesSent, icon: CheckCheck, tone: "text-sky-700 bg-sky-500/10 dark:text-sky-300" },
    { label: "Messages Delivered", value: stats?.messagesDelivered, icon: CheckCheck, tone: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300" },
    { label: "Messages Failed", value: stats?.messagesFailed, icon: CircleAlert, tone: "text-rose-700 bg-rose-500/10 dark:text-rose-300" }
  ], [stats]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Campaign workspace</p>
          <h1 className="text-[24px] font-semibold tracking-[-0.04em] sm:text-[28px]">Bulk Messaging</h1>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">Send WhatsApp campaigns to selected business categories.</p>
        </div>
        <div className="flex flex-wrap gap-2"><Link href="/dashboard/bulk-messaging/create?mode=csv" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#128c50] px-4 text-xs font-semibold text-[#128c50]"><FileSpreadsheet size={15} /> Upload Personalized CSV</Link><Link href="/dashboard/bulk-messaging/create" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#128c50] px-4 text-xs font-semibold text-white hover:bg-[#0f7944]"><Plus size={15} /> New Campaign</Link></div>
      </header>

      {notice && <div role="status" className="flex justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs"><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button></div>}

      <section aria-label="Campaign statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, tone }) => <article key={label} className="surface soft-shadow rounded-2xl p-4">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}><Icon size={16} /></span>
          <p className="mt-4 text-[11px] text-[var(--muted)]">{label}</p>
          <p className="mt-1 text-[25px] font-semibold leading-none tracking-[-0.04em]">{value === undefined ? "—" : value.toLocaleString()}</p>
        </article>)}
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="text-sm font-semibold">Campaign history</h2><p className="mt-1 text-[11px] text-[var(--muted)]">Recipient and delivery counts are updated from the queue and Meta webhooks.</p></div>
        {state === "loading" ? <div className="space-y-3 p-5" aria-label="Loading campaigns">{[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-[var(--surface-muted)]" />)}</div>
          : state === "error" ? <div className="py-12 text-center"><p className="text-sm font-semibold">Campaigns could not be loaded</p><button onClick={() => void load()} className="mt-2 text-xs font-semibold text-[var(--accent)]">Try again</button></div>
            : campaigns.length === 0 ? <div className="flex flex-col items-center px-5 py-14 text-center"><Send size={22} className="text-[var(--muted)]" /><p className="mt-3 text-sm font-semibold">No campaigns yet</p><p className="mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">Select an audience with documented opt-in and an approved WhatsApp template to get started.</p><Link href="/dashboard/bulk-messaging/create" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#128c50] px-3 py-2 text-xs font-semibold text-white"><Plus size={14} /> Create campaign</Link></div>
              : <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead><tr className="bg-[var(--surface-muted)] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]"><th className="px-5 py-3">Campaign Name</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Template</th><th className="px-4 py-3">Recipients</th><th className="px-4 py-3">Sent</th><th className="px-4 py-3">Delivered</th><th className="px-4 py-3">Failed</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
                  <tbody className="divide-y divide-[var(--border)]">{campaigns.map((campaign) => {
                    const active = ["Queued", "Processing"].includes(campaign.status);
                    return <tr key={campaign._id} className="text-xs">
                      <td className="px-5 py-3.5 font-semibold">{campaign.name}</td>
                      <td className="max-w-[150px] truncate px-4 py-3.5">{campaign.categoryNames.join(", ") || "—"}</td>
                      <td className="px-4 py-3.5">{campaign.templateName || (campaign.messageMode === "personalized_csv" ? "Exact CSV text" : "—")}</td>
                      <td className="px-4 py-3.5">{campaign.totalRecipients.toLocaleString()}</td>
                      <td className="px-4 py-3.5">{campaign.sentCount.toLocaleString()}</td>
                      <td className="px-4 py-3.5">{campaign.deliveredCount.toLocaleString()}</td>
                      <td className="px-4 py-3.5">{campaign.failedCount.toLocaleString()}</td>
                      <td className="px-4 py-3.5"><span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-semibold">{campaign.status}</span></td>
                      <td className="px-4 py-3.5 text-[var(--muted)]">{new Date(campaign.createdAt).toLocaleDateString()}</td>
                      <td className="px-5 py-3.5"><div className="flex justify-end gap-1">
                        <Link href={`/dashboard/bulk-messaging/${campaign._id}`} title="View details" aria-label={`View ${campaign.name}`} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)]"><Eye size={14} /></Link>
                        {campaign.status === "Draft" && !campaign.importBatchId && <Link href={`/dashboard/bulk-messaging/create?campaignId=${campaign._id}`} title="Edit draft" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)]"><CalendarDays size={14} /></Link>}
                        {active && <button disabled={busy === campaign._id} onClick={() => void action(campaign, "pause")} title="Pause" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)] disabled:opacity-40"><Pause size={14} /></button>}
                        {campaign.status === "Paused" && <button disabled={busy === campaign._id} onClick={() => void action(campaign, "resume")} title="Resume" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)] disabled:opacity-40"><Play size={14} /></button>}
                        {(active || campaign.status === "Paused") && <button disabled={busy === campaign._id} onClick={() => void action(campaign, "cancel")} title="Cancel" className="rounded-lg p-2 text-rose-600 hover:bg-rose-500/10 disabled:opacity-40"><Square size={13} /></button>}
                      </div></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>}
      </section>
      {busy && <span className="sr-only" aria-live="polite"><LoaderCircle className="animate-spin" /></span>}
    </div>
  );
}
