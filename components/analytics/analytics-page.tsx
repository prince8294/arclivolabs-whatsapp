"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowRight, BarChart3, CheckCheck, Eye, MessageSquareText, Search, Send, UserRoundCheck, XCircle } from "lucide-react";

type DateRange = "today" | "7d" | "30d" | "custom";
type CategoryOption = { _id: string; name: string };
type Overview = { messagesSent: number; delivered: number; read: number; replies: number; interestedLeads: number; failed: number };
type CampaignRow = {
  _id: string; name: string; categoryNames: string[]; totalRecipients: number; sent: number;
  delivered: number; read: number; replied: number; interestedLeads: number; status: string; createdAt: string;
};
type CategoryRow = { categoryId: string; categoryName: string; contactsTargeted: number; messagesSent: number; delivered: number; replies: number; interestedLeads: number };
type CampaignResult = { campaigns: CampaignRow[]; page: number; totalPages: number; total: number };

const cards = [
  { key: "messagesSent", label: "Messages sent", icon: Send },
  { key: "delivered", label: "Delivered", icon: CheckCheck },
  { key: "read", label: "Read", icon: Eye },
  { key: "replies", label: "Replies", icon: MessageSquareText },
  { key: "interestedLeads", label: "Interested leads", icon: UserRoundCheck },
  { key: "failed", label: "Failed messages", icon: XCircle }
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export function AnalyticsPage() {
  const [range, setRange] = useState<DateRange>("30d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [exportType, setExportType] = useState("campaign_summary");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [availableCategories, setAvailableCategories] = useState<CategoryOption[]>([]);
  const [campaignResult, setCampaignResult] = useState<CampaignResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams({ range, page: String(page), pageSize: "20" });
    if (range === "custom" && start && end) {
      params.set("start", start);
      params.set("end", end);
    }
    if (categoryId) params.set("categoryId", categoryId);
    return params;
  }, [range, start, end, categoryId, page]);

  const load = useCallback(async () => {
    if (range === "custom" && (!start || !end)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const base = filterQuery.toString();
      const campaignParams = new URLSearchParams(base);
      if (search.trim()) campaignParams.set("search", search.trim());
      const [overviewResponse, campaignResponse, categoryResponse] = await Promise.all([
        fetch(`/api/analytics/overview?${base}`, { cache: "no-store" }),
        fetch(`/api/analytics/campaigns?${campaignParams}`, { cache: "no-store" }),
        fetch(`/api/analytics/categories?${base}`, { cache: "no-store" })
      ]);
      if ([overviewResponse, campaignResponse, categoryResponse].some((response) => response.status === 401)) {
        throw new Error("Admin sign-in is required to view analytics.");
      }
      if (!overviewResponse.ok || !campaignResponse.ok || !categoryResponse.ok) {
        throw new Error("Analytics could not be loaded. Please try again.");
      }
      const [overviewData, campaignData, categoryData] = await Promise.all([
        overviewResponse.json(), campaignResponse.json(), categoryResponse.json()
      ]);
      setOverview(overviewData.overview);
      setCampaignResult(campaignData);
      setCategories(categoryData.categories);
      setAvailableCategories(categoryData.availableCategories);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Analytics could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [filterQuery, range, start, end, search]);

  useEffect(() => { void load(); }, [load]);

  async function exportReport() {
    if (range === "custom" && (!start || !end)) {
      setError("Choose both dates before exporting a custom range.");
      return;
    }
    const params = new URLSearchParams(filterQuery);
    params.set("type", exportType);
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/analytics/export?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Report export failed. Please try again.");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = exportType.replaceAll("_", "-") + ".csv";
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Report export failed.");
    } finally {
      setExporting(false);
    }
  }

  const number = (value: number | undefined) => (value ?? 0).toLocaleString();
  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
            <BarChart3 size={12} /> Campaign reporting
          </div>
          <h1 className="text-[23px] font-semibold tracking-[-0.04em] sm:text-[27px]">Analytics &amp; Reports</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Track your WhatsApp campaigns and business leads.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="text-[10px] font-medium text-[var(--muted)]">
            Date range
            <select value={range} onChange={(event) => { setRange(event.target.value as DateRange); setPage(1); }} className="mt-1 block h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--foreground)] sm:w-36">
              <option value="today">Today (UTC)</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom range</option>
            </select>
          </label>
          {range === "custom" && <>
            <label className="text-[10px] font-medium text-[var(--muted)]">From (UTC)<input type="date" value={start} onChange={(event) => { setStart(event.target.value); setPage(1); }} className="mt-1 block h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--foreground)]" /></label>
            <label className="text-[10px] font-medium text-[var(--muted)]">To (UTC)<input type="date" value={end} onChange={(event) => { setEnd(event.target.value); setPage(1); }} className="mt-1 block h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--foreground)]" /></label>
          </>}
          <label className="text-[10px] font-medium text-[var(--muted)]">
            Category
            <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }} className="mt-1 block h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--foreground)] sm:w-44">
              <option value="">All categories</option>{availableCategories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-medium text-[var(--muted)]">
            Export
            <select value={exportType} onChange={(event) => setExportType(event.target.value)} className="mt-1 block h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--foreground)] sm:w-44">
              <option value="campaign_summary">Campaign summary</option><option value="category_performance">Category performance</option><option value="recipient_results">Recipient results</option>
            </select>
          </label>
          <button type="button" onClick={() => void exportReport()} disabled={exporting || (range === "custom" && (!start || !end))} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white transition hover:bg-[#0f7944] disabled:opacity-50">
            <ArrowDownToLine size={14} />{exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </header>

      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-600 dark:text-red-300"><span>{error}</span><button type="button" onClick={() => void load()} className="font-semibold underline">Retry</button></div>}

      <section aria-label="Analytics overview" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map(({ key, label, icon: Icon }) => (
          <article key={key} className="surface soft-shadow rounded-2xl p-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={16} /></div>
            <p className="mt-4 text-[11px] font-medium text-[var(--muted)]">{label}</p>
            {loading ? <div className="mt-2 h-7 w-16 animate-pulse rounded bg-[var(--surface-muted)]" /> : <p className="mt-1 text-[24px] font-semibold leading-none tracking-[-0.04em]">{number(overview?.[key])}</p>}
          </article>
        ))}
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <div><h2 className="text-sm font-semibold">Campaign performance</h2><p className="mt-1 text-[11px] text-[var(--muted)]">Campaigns created within the selected UTC date range. Latest recipient statuses are shown.</p></div>
          <label className="relative block sm:w-64"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search campaigns" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs outline-none focus:border-[var(--accent)]" /></label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left">
            <thead><tr className="bg-[var(--surface-muted)] text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
              {["Campaign Name", "Business Category", "Recipients", "Sent", "Delivered", "Read", "Replied", "Interested", "Status", "Date", ""].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={11} className="px-4 py-10"><div className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-8 animate-pulse rounded bg-[var(--surface-muted)]" />)}</div></td></tr>
                : campaignResult?.campaigns.length ? campaignResult.campaigns.map((campaign) => <tr key={campaign._id} className="border-t border-[var(--border)] text-[11px]">
                  <td className="max-w-48 truncate px-3 py-3 font-semibold">{campaign.name}</td>
                  <td className="max-w-56 truncate px-3 py-3 text-[var(--muted)]" title={campaign.categoryNames.join(", ")}>{campaign.categoryNames.join(", ") || "—"}</td>
                  <td className="px-3 py-3">{number(campaign.totalRecipients)}</td><td className="px-3 py-3">{number(campaign.sent)}</td><td className="px-3 py-3">{number(campaign.delivered)}</td><td className="px-3 py-3">{number(campaign.read)}</td><td className="px-3 py-3">{number(campaign.replied)}</td><td className="px-3 py-3">{number(campaign.interestedLeads)}</td>
                  <td className="px-3 py-3"><span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px]">{campaign.status}</span></td><td className="whitespace-nowrap px-3 py-3 text-[var(--muted)]">{formatDate(campaign.createdAt)}</td>
                  <td className="px-3 py-3"><Link href={`/dashboard/analytics/campaigns/${campaign._id}`} className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-[var(--accent)] hover:underline">View details <ArrowRight size={12} /></Link></td>
                </tr>) : <tr><td colSpan={11} className="px-4 py-12 text-center"><p className="text-sm font-semibold">No campaigns in this range</p><p className="mt-1 text-xs text-[var(--muted)]">Try another date range or create a campaign to see performance here.</p></td></tr>}
            </tbody>
          </table>
        </div>
        {!loading && campaignResult && campaignResult.totalPages > 1 && <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs"><span className="text-[var(--muted)]">{number(campaignResult.total)} campaigns</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 disabled:opacity-40">Previous</button><span className="px-2 py-1.5">Page {page} of {campaignResult.totalPages}</span><button disabled={page >= campaignResult.totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 disabled:opacity-40">Next</button></div></div>}
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--border)] px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold">Business Category Performance</h2><p className="mt-1 text-[11px] text-[var(--muted)]">Contacts are unique within each category. Category attribution uses the snapshot stored when the campaign was sent.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left">
          <thead><tr className="bg-[var(--surface-muted)] text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">{["Category", "Contacts Targeted", "Messages Sent", "Delivered", "Replies", "Interested Leads"].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr></thead>
          <tbody>{loading ? <tr><td colSpan={6} className="px-4 py-8"><div className="h-8 animate-pulse rounded bg-[var(--surface-muted)]" /></td></tr> : categories.length ? categories.map((item) => <tr key={`${item.categoryId}:${item.categoryName}`} className="border-t border-[var(--border)] text-xs"><td className="px-4 py-3 font-medium">{item.categoryName || "No category snapshot"}</td><td className="px-4 py-3">{number(item.contactsTargeted)}</td><td className="px-4 py-3">{number(item.messagesSent)}</td><td className="px-4 py-3">{number(item.delivered)}</td><td className="px-4 py-3">{number(item.replies)}</td><td className="px-4 py-3">{number(item.interestedLeads)}</td></tr>) : <tr><td colSpan={6} className="px-4 py-9 text-center text-xs text-[var(--muted)]">No category performance data in this range.</td></tr>}</tbody>
        </table></div>
      </section>

      <section className="surface flex flex-col gap-2 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div><h2 className="text-xs font-semibold">Estimated Messaging Cost</h2><p className="mt-1 text-[11px] text-[var(--muted)]">Cost unavailable — no configured pricing or Meta billing data is available.</p></div>
        <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] text-[var(--muted)]">No estimate provided</span>
      </section>
      <p className="text-[10px] leading-5 text-[var(--muted)]">Campaign totals use one current recipient record per contact and campaign. Sent includes sent, delivered, and read statuses; delivered includes delivered and read. Replies are attributed only through explicit stored campaign links. All dates use UTC. <Link href="/" className="font-semibold text-[var(--accent)] hover:underline">Back to dashboard</Link></p>
    </div>
  );
}
