"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pause, Play, RefreshCw, Send, Square, X } from "lucide-react";

type CampaignRecord = {
  _id: string;
  name: string;
  description: string;
  categoryNames: string[];
  template: { name: string; language: string; metaStatus: string; metaCategory: string; body: string } | null;
  messageMode: string;
  importBatchId: string;
  cities: string[];
  status: string;
  totalRecipients: number;
  eligibleRecipients: number;
  excludedRecipients: number;
  queuedCount: number;
  pausedCount: number;
  processingCount: number;
  acceptedCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  errorCode: string;
  errorMessage: string;
  operationalError: string;
  createdAt: string;
  startedAt: string | null;
};
type Recipient = {
  _id: string;
  businessName: string;
  phoneNumber: string;
  categoryName: string;
  city: string;
  queueStatus: string;
  deliveryStatus: string;
  errorCode: string;
  errorMessage: string;
  originalCsvMessage: string;
  renderedMessage: string;
  eligibilityStatus: string;
  exclusionReason: string;
  updatedAt: string;
};
type RecipientResult = { recipients: Recipient[]; total: number; totalPages: number; page: number };
const filters = ["all", "pending", "sent", "delivered", "read", "failed", "excluded"] as const;

export function CampaignDetails({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [recipients, setRecipients] = useState<RecipientResult | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCampaign = useCallback(async () => {
    const response = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Campaign details could not be loaded.");
    setCampaign(result.campaign as CampaignRecord);
  }, [campaignId]);

  const loadRecipients = useCallback(async () => {
    const params = new URLSearchParams({ status: filter, page: String(page) });
    const response = await fetch(`/api/campaigns/${campaignId}/recipients?${params}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Recipient results could not be loaded.");
    setRecipients(result as RecipientResult);
  }, [campaignId, filter, page]);

  const load = useCallback(async () => {
    try {
      await Promise.all([loadCampaign(), loadRecipients()]);
      setLoading(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign data could not be loaded.");
      setLoading(false);
    }
  }, [loadCampaign, loadRecipients]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => { setPage(1); }, [filter]);

  async function action(name: "start" | "pause" | "resume" | "cancel") {
    if (name === "cancel" && !window.confirm("Cancel this campaign? Unsent recipients will be cancelled; messages already submitted to Meta cannot be recalled.")) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/${name}`, {
        method: "POST",
        ...(name === "start" ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true })
        } : {})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? `Campaign could not be ${name}d.`);
      await load();
      setNotice(name === "start" ? "Campaign started and queued." : `Campaign ${name === "resume" ? "resumed" : `${name}d`}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Campaign could not be ${name}d.`);
    } finally {
      setBusy(false);
    }
  }

  const processingProgress = useMemo(() => {
    if (!campaign?.eligibleRecipients) return 0;
    return Math.max(0, Math.min(100, Math.round(((campaign.eligibleRecipients - campaign.queuedCount - campaign.pausedCount - campaign.processingCount) / campaign.eligibleRecipients) * 100)));
  }, [campaign]);
  const deliveryProgress = useMemo(() => {
    if (!campaign?.acceptedCount) return 0;
    return Math.max(0, Math.min(100, Math.round((campaign.deliveredCount / campaign.acceptedCount) * 100)));
  }, [campaign]);

  if (loading && !campaign) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /><div className="h-40 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /><div className="h-72 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /></div>;
  if (!campaign) return <div className="surface rounded-2xl p-8 text-center"><p className="text-sm font-semibold">Campaign could not be loaded</p><p className="mt-1 text-xs text-[var(--muted)]">{notice}</p><Link href="/dashboard/bulk-messaging" className="mt-3 inline-flex text-xs font-semibold text-[var(--accent)]">Back to campaigns</Link></div>;

  const metrics = [
    ["Eligible", campaign.eligibleRecipients],
    ["Queued", campaign.queuedCount],
    ["Paused", campaign.pausedCount],
    ["API accepted", campaign.acceptedCount],
    ["Sent", campaign.sentCount],
    ["Delivered", campaign.deliveredCount],
    ["Read", campaign.readCount],
    ["Failed", campaign.failedCount]
  ] as const;
  const active = ["Queued", "Processing"].includes(campaign.status);

  return (
    <div className="space-y-5">
      <header>
        <Link href="/dashboard/bulk-messaging" className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={14} /> Campaign history</Link>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-[24px] font-semibold tracking-[-0.04em]">{campaign.name}</h1><span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-semibold">{campaign.status}</span></div><p className="mt-1.5 text-xs text-[var(--muted)]">{campaign.categoryNames.join(", ") || "No categories"} · {campaign.template?.name ?? (campaign.messageMode === "personalized_csv" ? "Exact personalized CSV text" : "No template")} · {campaign.cities.length ? campaign.cities.join(", ") : "All cities"}</p><p className="mt-1 text-[10px] text-[var(--muted)]">Created {new Date(campaign.createdAt).toLocaleString()}{campaign.startedAt ? ` · Started ${new Date(campaign.startedAt).toLocaleString()}` : ""}</p></div>
          <div className="flex flex-wrap gap-2">{campaign.status === "Draft" && !campaign.importBatchId && <Link href={`/dashboard/bulk-messaging/create?campaignId=${campaign._id}`} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold">Edit draft</Link>}{campaign.status === "Draft" && <button disabled={busy} onClick={() => void action("start")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#128c50] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Send size={13} /> {busy ? "Starting…" : "Start Campaign"}</button>}{active && <button disabled={busy} onClick={() => void action("pause")} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-50"><Pause size={13} /> Pause</button>}{campaign.status === "Paused" && <button disabled={busy} onClick={() => void action("resume")} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-50"><Play size={13} /> Resume</button>}{(active || campaign.status === "Paused") && <button disabled={busy} onClick={() => void action("cancel")} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-600 disabled:opacity-50"><Square size={12} /> Cancel</button>}<button onClick={() => void load()} aria-label="Refresh campaign" className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)]"><RefreshCw size={14} /></button></div>
        </div>
      </header>
      {notice && <div role="status" className="flex justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs"><span>{notice}</span><button aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button></div>}
      {campaign.status === "Draft" && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">This campaign is saved but has not been sent. Use <strong>Start Campaign</strong> above. The app will recheck current documented consent, the approved template, Redis, and worker health before queueing any message.</div>}
      {campaign.errorMessage && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-xs text-rose-700 dark:text-rose-300"><strong>{campaign.errorCode || "Campaign error"}:</strong> {campaign.errorMessage}</div>}
      {campaign.operationalError && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">{campaign.operationalError}</div>}

      <section className="surface soft-shadow rounded-2xl p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">{metrics.map(([label, value])=><div key={label} className="rounded-xl bg-[var(--surface-muted)] p-3"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 text-xl font-semibold">{value.toLocaleString()}</p></div>)}</div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div><div className="flex justify-between text-[10px]"><span className="font-semibold">Queue processing</span><span className="text-[var(--muted)]">{processingProgress}% · {campaign.processingCount} processing</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-[#128c50] transition-all" style={{ width: `${processingProgress}%` }} /></div></div>
          <div><div className="flex justify-between text-[10px]"><span className="font-semibold">Delivery updates</span><span className="text-[var(--muted)]">{deliveryProgress}% of API-accepted</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-[#25a665] transition-all" style={{ width: `${deliveryProgress}%` }} /></div></div>
        </div>
        <p className="mt-4 text-[10px] text-[var(--muted)]">API acceptance is not delivery. Sent, delivered, read, and failed counts come from Meta webhook status updates.</p>
        {campaign.excludedRecipients > 0 && <p className="mt-2 text-[10px] text-[var(--muted)]">{campaign.excludedRecipients.toLocaleString()} contacts were excluded before sending.</p>}
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:px-5"><div><h2 className="text-sm font-semibold">Recipient results</h2><p className="mt-1 text-[10px] text-[var(--muted)]">{recipients?.total.toLocaleString() ?? "—"} records · auto-refreshes every 5 seconds</p></div><div className="flex items-center gap-2"><label htmlFor="recipient-filter" className="text-[10px] text-[var(--muted)]">Status</label><select id="recipient-filter" value={filter} onChange={(event) => setFilter(event.target.value as (typeof filters)[number])} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs">{filters.map((item)=><option key={item} value={item}>{item[0].toUpperCase()+item.slice(1)}</option>)}</select></div></div>
        {!recipients ? <div className="p-8 text-center text-xs text-[var(--muted)]">Recipient data is loading…</div> : recipients.recipients.length === 0 ? <div className="p-10 text-center text-xs text-[var(--muted)]">{campaign.status === "Draft" ? "Save and start the campaign to create recipient snapshots." : "No recipient records match this filter yet."}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-xs"><thead><tr className="bg-[var(--surface-muted)] text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"><th className="px-5 py-3">Business Name</th><th className="px-4 py-3">WhatsApp Number</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Final Message</th><th className="px-4 py-3">Eligibility</th><th className="px-4 py-3">Message Status</th><th className="px-4 py-3">Error</th><th className="px-5 py-3">Last Updated</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{recipients.recipients.map((recipient)=><tr key={recipient._id}><td className="px-5 py-3.5 font-medium">{recipient.businessName}</td><td className="px-4 py-3.5">{recipient.phoneNumber}</td><td className="px-4 py-3.5">{recipient.categoryName}<span className="block text-[9px] text-[var(--muted)]">{recipient.city || "—"}</span></td><td className="max-w-[280px] truncate px-4 py-3.5" title={recipient.renderedMessage || recipient.originalCsvMessage}>{recipient.renderedMessage || recipient.originalCsvMessage || "—"}</td><td className="px-4 py-3.5"><span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[9px]">{recipient.eligibilityStatus || "Ready to Send"}</span></td><td className="px-4 py-3.5"><span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-medium">{recipient.queueStatus === "excluded" ? "Excluded" : ["queued", "processing", "paused", "cancelled", "uncertain"].includes(recipient.queueStatus) ? recipient.queueStatus : recipient.deliveryStatus}</span></td><td className="max-w-[200px] truncate px-4 py-3.5 text-[10px] text-[var(--muted)]" title={recipient.errorMessage}>{recipient.exclusionReason || recipient.errorMessage || recipient.errorCode || "—"}</td><td className="px-5 py-3.5 text-[var(--muted)]">{new Date(recipient.updatedAt).toLocaleString()}</td></tr>)}</tbody></table></div>}
        {recipients && recipients.totalPages > 1 && <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-[11px] text-[var(--muted)]"><span>Page {page} of {recipients.totalPages}</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((value)=>value-1)} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 disabled:opacity-40">Previous</button><button disabled={page >= recipients.totalPages} onClick={() => setPage((value)=>value+1)} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 disabled:opacity-40">Next</button></div></div>}
      </section>
    </div>
  );
}
