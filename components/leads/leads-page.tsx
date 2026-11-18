"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  MessageSquareText,
  Search,
  Save,
  Trash2,
  UserRoundCheck,
  X
} from "lucide-react";

const leadStatuses = ["New", "Interested", "Not Interested", "Closed"] as const;
const followUpStatuses = ["Not Required", "Pending", "Completed"] as const;
type LeadStatus = (typeof leadStatuses)[number];
type FollowUpStatus = (typeof followUpStatuses)[number];
type Lead = {
  _id: string;
  contactId: string | null;
  businessName: string;
  contactPerson: string;
  phoneNumber: string;
  categoryId: string;
  categoryName: string;
  city: string;
  email: string;
  leadStatus: LeadStatus;
  followUpStatus: FollowUpStatus;
  followUpDate: string | null;
  followUpNotes: string;
  lastContactedAt: string | null;
  lastActivityAt: string | null;
  notes: string;
};
type LeadDetail = Omit<Lead, "categoryId" | "categoryName" | "lastActivityAt"> & { categoryName: string };
type CategoryOption = { _id: string; name: string };
type Stats = {
  interestedLeads: number;
  followUpsPending: number;
  closedLeads: number;
};
type Notice = { type: "success" | "error"; message: string };

function apiError(response: Response, body?: { error?: { message?: string } }) {
  return body?.error?.message || `Request failed (${response.status}).`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const dateOnly = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (dateOnly) {
    const [year, month, day] = dateOnly.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function localDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isOverdue(lead: Pick<Lead, "followUpStatus" | "followUpDate">) {
  return lead.followUpStatus === "Pending" && Boolean(lead.followUpDate) && String(lead.followUpDate).slice(0, 10) < localDateKey();
}

export function LeadsPage({ initialLeadId = "" }: { initialLeadId?: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>({ interestedLeads: 0, followUpsPending: 0, closedLeads: 0 });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [city, setCity] = useState("");
  const [leadStatus, setLeadStatus] = useState("Interested");
  const [followUpStatus, setFollowUpStatus] = useState("all");
  const [sortBy, setSortBy] = useState("lastActivity");
  const [sortOrder, setSortOrder] = useState("desc");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [details, setDetails] = useState<LeadDetail | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "20", leadStatus, followUpStatus, sortBy, sortOrder });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (categoryId) params.set("categoryId", categoryId);
    if (city) params.set("city", city);
    return params.toString();
  }, [categoryId, city, debouncedSearch, followUpStatus, leadStatus, page, sortBy, sortOrder]);

  const loadLeads = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/leads?${query}`, { cache: "no-store", signal });
      if (response.status === 401) {
        setUnauthorized(true);
        setLeads([]);
        return;
      }
      const result = await response.json() as {
        leads?: Lead[];
        categories?: CategoryOption[];
        cities?: string[];
        total?: number;
        totalPages?: number;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(apiError(response, result));
      setLeads(result.leads ?? []);
      setCategories(result.categories ?? []);
      setCities(result.cities ?? []);
      setTotal(result.total ?? 0);
      setTotalPages(result.totalPages ?? 0);
      setUnauthorized(false);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : "Leads could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadStats = useCallback(async () => {
    try {
      const response = await fetch("/api/leads/stats", { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(apiError(response, result ?? undefined));
      }
      const result = await response.json() as Stats;
      setStats(result);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Lead statistics could not be loaded." });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLeads(controller.signal);
    return () => controller.abort();
  }, [loadLeads]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (notice) {
      const timer = window.setTimeout(() => setNotice(null), 4200);
      return () => window.clearTimeout(timer);
    }
  }, [notice]);

  const openDetails = useCallback(async (id: string) => {
    setDetailsLoading(true);
    try {
      const response = await fetch(`/api/leads/${id}`, { cache: "no-store" });
      const result = await response.json() as { lead?: LeadDetail; error?: { message?: string } };
      if (!response.ok || !result.lead) throw new Error(apiError(response, result));
      setDetails(result.lead);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Lead details could not be loaded." });
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialLeadId) void openDetails(initialLeadId);
  }, [initialLeadId, openDetails]);

  async function updateLead(id: string, changes: Record<string, unknown>) {
    const response = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes)
    });
    const result = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(apiError(response, result));
  }

  async function updateQuickStatus(lead: Lead, status: LeadStatus) {
    try {
      await updateLead(lead._id, { leadStatus: status });
      setNotice({ type: "success", message: "Lead status updated." });
      await Promise.all([loadLeads(), loadStats()]);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Lead status could not be updated." });
    }
  }

  async function setDetailsStatus(status: LeadStatus) {
    if (!details) return;
    try {
      await updateLead(details._id, { leadStatus: status });
      setDetails({ ...details, leadStatus: status });
      setNotice({ type: "success", message: `Lead marked ${status.toLowerCase()}.` });
      await Promise.all([loadLeads(), loadStats()]);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Lead status could not be updated." });
    }
  }

  async function saveDetails() {
    if (!details) return;
    setSaving(true);
    try {
      await updateLead(details._id, {
        leadStatus: details.leadStatus,
        followUpStatus: details.followUpStatus,
        followUpDate: details.followUpDate || null,
        followUpNotes: details.followUpNotes,
        notes: details.notes
      });
      setNotice({ type: "success", message: "Lead details saved." });
      await Promise.all([loadLeads(), loadStats()]);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Lead details could not be saved." });
    } finally {
      setSaving(false);
    }
  }

  async function archiveLead(lead: Lead) {
    if (!window.confirm(`Remove ${lead.businessName} from the active leads list? Their contact and conversation history will be preserved.`)) return;
    try {
      const response = await fetch(`/api/leads/${lead._id}`, { method: "DELETE" });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(apiError(response, result));
      if (details?._id === lead._id) setDetails(null);
      setNotice({ type: "success", message: "Lead removed. Contact and conversation history were preserved." });
      await Promise.all([loadLeads(), loadStats()]);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Lead could not be removed." });
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ leadStatus, followUpStatus, sortBy, sortOrder });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (categoryId) params.set("categoryId", categoryId);
      if (city) params.set("city", city);
      const response = await fetch(`/api/leads/export?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json() as { error?: { message?: string } };
        throw new Error(apiError(response, result));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `brand-leads-${localDateKey()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "CSV export could not be generated." });
    } finally {
      setExporting(false);
    }
  }

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  const metricCards = [
    { title: "Interested Leads", value: stats.interestedLeads, hint: "Manually marked interested", icon: UserRoundCheck },
    { title: "Follow-ups Pending", value: stats.followUpsPending, hint: "Internal follow-up reminders", icon: CalendarClock },
    { title: "Closed Leads", value: stats.closedLeads, hint: "Active records marked closed", icon: CheckCircle2 }
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
            <UserRoundCheck size={12} /> Lead management
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.04em] sm:text-[26px]">Brand Leads</h1>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">Manage interested businesses and track your outreach.</p>
        </div>
        <button type="button" onClick={() => void exportCsv()} disabled={exporting} className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-xs font-semibold transition hover:bg-[var(--surface-muted)] disabled:opacity-50 sm:self-auto">
          {exporting ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowDownToLine size={15} />} Export CSV
        </button>
      </header>

      <section aria-label="Lead statistics" className="grid gap-3 sm:grid-cols-3">
        {metricCards.map(({ title, value, hint, icon: Icon }) => (
          <article key={title} className="surface soft-shadow rounded-2xl p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={17} /></span>
              <span className="text-[10px] text-[var(--muted)]">{hint}</span>
            </div>
            <p className="mt-4 text-[11px] font-medium text-[var(--muted)]">{title}</p>
            <p className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.04em]">{value.toLocaleString()}</p>
          </article>
        ))}
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="space-y-3 border-b border-[var(--border)] p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <label className="relative block w-full xl:max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search business, contact, or number" className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs outline-none transition focus:border-[var(--accent)]" />
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex">
              <select aria-label="Business category" value={categoryId} onChange={(event) => changeFilter(setCategoryId, event.target.value)} className="h-10 min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-[var(--accent)]">
                <option value="">All categories</option>{categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
              </select>
              <select aria-label="City" value={city} onChange={(event) => changeFilter(setCity, event.target.value)} className="h-10 min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-[var(--accent)]">
                <option value="">All cities</option>{cities.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select aria-label="Lead status" value={leadStatus} onChange={(event) => changeFilter(setLeadStatus, event.target.value)} className="h-10 min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-[var(--accent)]">
                <option value="all">All lead statuses</option>{leadStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <select aria-label="Follow-up status" value={followUpStatus} onChange={(event) => changeFilter(setFollowUpStatus, event.target.value)} className="h-10 min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-[var(--accent)]">
                <option value="all">All follow-ups</option>{followUpStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-[var(--muted)]">{total.toLocaleString()} matching lead{total === 1 ? "" : "s"}</p>
            <label className="inline-flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <span>Sort by</span>
              <select value={sortBy} onChange={(event) => changeFilter(setSortBy, event.target.value)} className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px] text-[var(--foreground)]">
                <option value="lastActivity">Last activity</option><option value="followUpDate">Follow-up date</option>
              </select>
              <select aria-label="Sort order" value={sortOrder} onChange={(event) => changeFilter(setSortOrder, event.target.value)} className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px] text-[var(--foreground)]">
                <option value="desc">Newest first</option><option value="asc">Oldest first</option>
              </select>
            </label>
          </div>
        </div>

        {unauthorized ? <div className="px-5 py-14 text-center"><p className="text-sm font-semibold">Admin sign-in required</p><Link href="/login" className="mt-2 inline-flex text-xs font-semibold text-[var(--accent)] hover:underline">Sign in</Link></div>
          : loadError ? <div role="alert" className="flex items-center justify-center gap-2 px-5 py-12 text-xs text-red-600"><AlertCircle size={15} />{loadError}</div>
            : <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left">
                <thead><tr className="bg-[var(--surface-muted)] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]">
                  <th className="px-5 py-3">Business Name</th><th className="px-4 py-3">WhatsApp Number</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">City</th><th className="px-4 py-3">Lead Status</th><th className="px-4 py-3">Follow-up</th><th className="px-4 py-3">Last Activity</th><th className="px-5 py-3">Actions</th>
                </tr></thead>
                <tbody>
                  {loading ? Array.from({ length: 5 }, (_, index) => <tr key={index} className="border-t border-[var(--border)]"><td colSpan={8} className="px-5 py-4"><div className="h-8 animate-pulse rounded-lg bg-[var(--surface-muted)]" /></td></tr>)
                    : leads.length ? leads.map((lead) => (
                      <tr key={lead._id} className="border-t border-[var(--border)] text-xs transition hover:bg-[var(--surface-muted)]/60">
                        <td className="px-5 py-3.5"><button type="button" onClick={() => void openDetails(lead._id)} className="text-left font-semibold hover:text-[var(--accent)]">{lead.businessName}</button><span className="mt-1 block text-[10px] text-[var(--muted)]">{lead.contactPerson || "Contact person not set"}</span></td>
                        <td className="px-4 py-3.5 whitespace-nowrap">{lead.phoneNumber}</td>
                        <td className="px-4 py-3.5">{lead.categoryName || "—"}</td>
                        <td className="px-4 py-3.5">{lead.city || "—"}</td>
                        <td className="px-4 py-3.5"><select aria-label={`Update status for ${lead.businessName}`} value={lead.leadStatus} onChange={(event) => void updateQuickStatus(lead, event.target.value as LeadStatus)} className="h-8 max-w-[130px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px] outline-none focus:border-[var(--accent)]">{leadStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></td>
                        <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${isOverdue(lead) ? "font-semibold text-red-600" : "text-[var(--muted)]"}`}><span className={`h-1.5 w-1.5 rounded-full ${isOverdue(lead) ? "bg-red-500" : lead.followUpStatus === "Pending" ? "bg-amber-500" : "bg-[var(--muted)]/50"}`} />{lead.followUpStatus}{lead.followUpDate ? ` · ${formatDate(lead.followUpDate)}` : ""}{isOverdue(lead) ? " · overdue" : ""}</span></td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-[var(--muted)]">{formatDate(lead.lastActivityAt)}</td>
                        <td className="px-5 py-3.5"><div className="flex items-center gap-2">
                          <button type="button" onClick={() => void openDetails(lead._id)} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[10px] font-semibold hover:bg-[var(--surface)]">Details</button>
                          <Link href={`/dashboard/inbox?conversationId=${lead._id}`} className="rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--accent)] hover:opacity-80">Open Chat</Link>
                          <button type="button" onClick={() => void archiveLead(lead)} aria-label={`Remove ${lead.businessName} from leads`} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 size={14} /></button>
                        </div></td>
                      </tr>
                    )) : <tr><td colSpan={8} className="px-5 py-16 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--muted)]"><UserRoundCheck size={19} /></div><p className="mt-3 text-sm font-semibold">No leads match these filters</p><p className="mt-1 text-xs text-[var(--muted)]">Businesses manually marked Interested in Inbox will appear here.</p><Link href="/dashboard/inbox" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline">Open Inbox <ArrowRight size={13} /></Link></td></tr>}
                </tbody>
              </table>
            </div>}

        <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span className="text-[10px] text-[var(--muted)]">Page {page} of {Math.max(totalPages, 1)}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[11px] disabled:opacity-40"><ChevronLeft size={14} />Previous</button>
            <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[11px] disabled:opacity-40">Next<ChevronRight size={14} /></button>
          </div>
        </div>
      </section>

      {notice && <div role={notice.type === "error" ? "alert" : "status"} className={`fixed bottom-5 right-5 z-[70] flex max-w-sm items-center gap-2 rounded-xl border px-4 py-3 text-xs shadow-lg ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200" : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/70 dark:text-red-200"}`}>{notice.type === "error" ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}{notice.message}</div>}

      {(details || detailsLoading) && <div className="fixed inset-0 z-[60]">
        <button type="button" aria-label="Close lead details" onClick={() => setDetails(null)} className="absolute inset-0 bg-black/35" />
        <aside role="dialog" aria-modal="true" aria-label="Lead details" className="absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div><p className="text-sm font-semibold">Lead details</p><p className="mt-1 text-[11px] text-[var(--muted)]">Update shared Inbox status and manual follow-up details.</p></div>
            <button type="button" onClick={() => setDetails(null)} aria-label="Close" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)]"><X size={17} /></button>
          </div>
          {detailsLoading || !details ? <div className="flex flex-1 items-center justify-center"><LoaderCircle size={22} className="animate-spin text-[var(--accent)]" /></div> : <>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="rounded-2xl bg-[var(--surface-muted)] p-4">
                <h2 className="text-base font-semibold">{details.businessName}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">{details.contactPerson || "Contact person not set"}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-[10px] text-[var(--muted)]">WhatsApp Number</p><p className="mt-1 break-all font-medium">{details.phoneNumber}</p></div>
                  <div><p className="text-[10px] text-[var(--muted)]">Business Category</p><p className="mt-1">{details.categoryName || "—"}</p></div>
                  <div><p className="text-[10px] text-[var(--muted)]">City</p><p className="mt-1">{details.city || "—"}</p></div>
                  <div><p className="text-[10px] text-[var(--muted)]">Email</p><p className="mt-1 break-all">{details.email || "—"}</p></div>
                  <div className="col-span-2"><p className="text-[10px] text-[var(--muted)]">Last Contact Date</p><p className="mt-1">{formatDate(details.lastContactedAt)}</p></div>
                </div>
              </div>

              <label className="block text-xs font-medium">Lead Status
                <select value={details.leadStatus} onChange={(event) => setDetails({ ...details, leadStatus: event.target.value as LeadStatus })} className="mt-1.5 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-[var(--accent)]">{leadStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select>
              </label>

              <div className="rounded-2xl border border-[var(--border)] p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold"><CalendarClock size={15} className="text-[var(--accent)]" /> Manual follow-up</div>
                <label className="block text-xs font-medium">Follow-up Status
                  <select value={details.followUpStatus} onChange={(event) => setDetails({ ...details, followUpStatus: event.target.value as FollowUpStatus })} className="mt-1.5 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-[var(--accent)]">{followUpStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select>
                </label>
                <label className="mt-3 block text-xs font-medium">Follow-up Date <span className="font-normal text-[var(--muted)]">optional</span>
                  <input type="date" value={details.followUpDate ?? ""} onChange={(event) => setDetails({ ...details, followUpDate: event.target.value || null })} className="mt-1.5 h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-[var(--accent)]" />
                </label>
                <label className="mt-3 block text-xs font-medium">Follow-up Notes
                  <textarea rows={3} maxLength={2000} value={details.followUpNotes} onChange={(event) => setDetails({ ...details, followUpNotes: event.target.value })} placeholder="Internal reminder only; no message will be sent automatically." className="mt-1.5 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[var(--accent)]" />
                </label>
              </div>

              <label className="block text-xs font-medium">Notes
                <textarea rows={4} maxLength={2000} value={details.notes} onChange={(event) => setDetails({ ...details, notes: event.target.value })} placeholder="Add internal notes about this business." className="mt-1.5 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[var(--accent)]" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-4">
              <Link href={`/dashboard/inbox?conversationId=${details._id}`} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)] hover:opacity-80"><MessageSquareText size={15} /> Open Chat</Link>
              <button type="button" onClick={() => void setDetailsStatus("Interested")} className="h-10 rounded-xl border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--surface-muted)]">Mark Interested</button>
              <button type="button" onClick={() => void setDetailsStatus("Closed")} className="h-10 rounded-xl border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--surface-muted)]">Mark Closed</button>
              <button type="button" disabled={saving} onClick={() => void saveDetails()} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#128c50] px-4 text-xs font-semibold text-white transition hover:bg-[#0f7944] disabled:opacity-50"><Save size={14} />{saving ? "Saving..." : "Save Changes"}</button>
            </div>
          </>}
        </aside>
      </div>}
    </div>
  );
}
