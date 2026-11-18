"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, ArrowLeft, MessageSquareText, Search } from "lucide-react";

type CampaignReport = {
  _id: string; name: string; categoryNames: string[]; cities: string[];
  templateName: string; templateLanguage: string; startedAt: string; status: string;
};
type Summary = {
  totalRecipients: number; accepted: number; sent: number; delivered: number; read: number; failed: number;
  uniqueResponders: number; replies: number; interestedLeads: number; deliveryRate: number | null;
  readRate: number | null; replyRate: number | null; interestedLeadRate: number | null;
};
type Recipient = {
  _id: string; businessName: string; phoneNumber: string; categoryName: string; messageStatus: string;
  replyReceived: boolean; leadStatus: string; conversationId: string;
};
type ReportData = { campaign: CampaignReport; summary: Summary; recipients: Recipient[]; page: number; totalPages: number; total: number; attributionNote: string };
const statusOptions = ["all", "pending", "accepted", "sent", "delivered", "read", "failed", "excluded", "uncertain"];
const summaryCards: { key: keyof Summary; label: string }[] = [
  { key: "totalRecipients", label: "Total recipients" },
  { key: "accepted", label: "Accepted by API" },
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "read", label: "Read" },
  { key: "failed", label: "Failed" },
  { key: "uniqueResponders", label: "Unique responders" },
  { key: "interestedLeads", label: "Interested leads" }
];

function percentage(value: number | null) {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

export function CampaignAnalyticsPage({ campaignId }: { campaignId: string }) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "50", status });
    if (search.trim()) params.set("search", search.trim());
    try {
      const response = await fetch(`/api/analytics/campaigns/${encodeURIComponent(campaignId)}?${params}`, { cache: "no-store" });
      if (response.status === 401) throw new Error("Admin sign-in is required to view this report.");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Campaign report could not be loaded.");
      setReport(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Campaign report could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, search, status]);

  useEffect(() => { void load(); }, [load]);

  async function exportRecipients() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/analytics/export?type=recipient_results&range=30d&campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Recipient report export failed.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${report?.campaign.name.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign"}-recipients.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Recipient report export failed.");
    } finally {
      setExporting(false);
    }
  }

  const number = (value: number) => value.toLocaleString();
  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <Link href="/dashboard/analytics" className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--accent)]"><ArrowLeft size={13} /> Analytics &amp; Reports</Link>
          {loading && !report ? <div className="h-7 w-60 animate-pulse rounded bg-[var(--surface-muted)]" /> : <h1 className="text-[23px] font-semibold tracking-[-0.04em] sm:text-[27px]">{report?.campaign.name ?? "Campaign report"}</h1>}
          {report && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
            <span>Started {dateTime(report.campaign.startedAt)}</span><span>Status: {report.campaign.status}</span>
            <span>Template: {report.campaign.templateName}{report.campaign.templateLanguage ? ` (${report.campaign.templateLanguage})` : ""}</span>
            <span>Categories: {report.campaign.categoryNames.join(", ") || "—"}</span><span>Cities: {report.campaign.cities.join(", ") || "All selected audience cities"}</span>
          </div>}
        </div>
        <button type="button" onClick={() => void exportRecipients()} disabled={exporting || !report} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-xs font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50"><ArrowDownToLine size={14} />{exporting ? "Exporting…" : "Export recipient CSV"}</button>
      </header>
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-600 dark:text-red-300"><span>{error}</span><button type="button" onClick={() => void load()} className="font-semibold underline">Retry</button></div>}

      <section aria-label="Campaign performance summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {summaryCards.map((card) => <article key={card.key} className="surface rounded-2xl p-4"><p className="text-[10px] font-medium text-[var(--muted)]">{card.label}</p>{loading && !report ? <div className="mt-2 h-7 w-12 animate-pulse rounded bg-[var(--surface-muted)]" /> : <p className="mt-2 text-[23px] font-semibold leading-none">{number((report?.summary[card.key] as number | undefined) ?? 0)}</p>}</article>)}
      </section>

      {report && <section className="surface rounded-2xl p-4 sm:px-5">
        <h2 className="text-xs font-semibold">Performance rates</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <p className="rounded-xl bg-[var(--surface-muted)] p-3"><span className="block text-[10px] text-[var(--muted)]">Delivery rate · Delivered / Sent</span><strong className="mt-1 block">{percentage(report.summary.deliveryRate)}</strong></p>
          <p className="rounded-xl bg-[var(--surface-muted)] p-3"><span className="block text-[10px] text-[var(--muted)]">Read rate · Read / Delivered</span><strong className="mt-1 block">{percentage(report.summary.readRate)}</strong></p>
          <p className="rounded-xl bg-[var(--surface-muted)] p-3"><span className="block text-[10px] text-[var(--muted)]">Reply rate · Unique responders / Delivered recipients</span><strong className="mt-1 block">{percentage(report.summary.replyRate)}</strong></p>
          <p className="rounded-xl bg-[var(--surface-muted)] p-3"><span className="block text-[10px] text-[var(--muted)]">Interested lead rate · Interested / Unique responders</span><strong className="mt-1 block">{percentage(report.summary.interestedLeadRate)}</strong></p>
        </div>
        <p className="mt-3 text-[10px] leading-5 text-[var(--muted)]">API acceptance means Meta accepted the send request; it does not confirm sending or delivery. {report.attributionNote}</p>
      </section>}

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <div><h2 className="text-sm font-semibold">Recipient results</h2><p className="mt-1 text-[11px] text-[var(--muted)]">Recipient data is the campaign-time snapshot.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search recipients" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs outline-none focus:border-[var(--accent)] sm:w-56" /></label>
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Filter recipient status" className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs">{statusOptions.map((option) => <option key={option} value={option}>{option === "all" ? "All statuses" : option[0].toUpperCase() + option.slice(1)}</option>)}</select>
          </div>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[790px] text-left">
          <thead><tr className="bg-[var(--surface-muted)] text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">{["Business Name", "WhatsApp Number", "Category", "Message Status", "Reply Received", "Lead Status", ""].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr></thead>
          <tbody>{loading ? <tr><td colSpan={7} className="px-4 py-9"><div className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-8 animate-pulse rounded bg-[var(--surface-muted)]" />)}</div></td></tr>
            : report?.recipients.length ? report.recipients.map((recipient) => <tr key={recipient._id} className="border-t border-[var(--border)] text-xs"><td className="px-4 py-3 font-medium">{recipient.businessName}</td><td className="px-4 py-3 text-[var(--muted)]">{recipient.phoneNumber}</td><td className="px-4 py-3">{recipient.categoryName}</td><td className="px-4 py-3 capitalize">{recipient.messageStatus}</td><td className="px-4 py-3">{recipient.replyReceived ? "Yes" : "No"}</td><td className="px-4 py-3">{recipient.leadStatus}</td><td className="px-4 py-3">{recipient.conversationId ? <Link href={`/dashboard/inbox?conversationId=${encodeURIComponent(recipient.conversationId)}`} className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-[var(--accent)] hover:underline"><MessageSquareText size={13} /> Open chat</Link> : <span className="text-[var(--muted)]">No chat</span>}</td></tr>)
              : <tr><td colSpan={7} className="px-4 py-12 text-center"><p className="text-sm font-semibold">{report?.total ? "No recipients match these filters" : "No recipient results yet"}</p><p className="mt-1 text-xs text-[var(--muted)]">Try a different search or status filter.</p></td></tr>}
          </tbody>
        </table></div>
        {report && report.totalPages > 1 && <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs"><span className="text-[var(--muted)]">{number(report.total)} matching recipients</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 disabled:opacity-40">Previous</button><span className="px-2 py-1.5">Page {page} of {report.totalPages}</span><button disabled={page >= report.totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 disabled:opacity-40">Next</button></div></div>}
      </section>
    </div>
  );
}
